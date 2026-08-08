# Cloudflare Deployment Rules

## Hostname Separation

- Each Worker MUST have its own subdomain. Never put two Workers on the same hostname via routes + custom_domain
- API: `api-staging.example.com` (custom_domain) / `api.example.com` (custom_domain)

## Custom Domains vs Routes

- Prefer `custom_domain: true` over `routes` with `zone_name` — custom domains auto-create DNS records and SSL certs; routes require manual DNS setup
- Routes with `zone_name` need a pre-existing proxied DNS record or requests fail with `ERR_NAME_NOT_RESOLVED`

```jsonc
// Good: auto-creates DNS + SSL
"routes": [{ "pattern": "api.example.com", "custom_domain": true }]

// Fragile: requires manual DNS record
"routes": [{ "pattern": "api.example.com/*", "zone_name": "example.com" }]
```

## HTTP→HTTPS Enforcement

- NEVER use Cloudflare "Redirect from HTTP to HTTPS" redirect rule template — it intercepts requests before Workers and causes 301 self-redirect loops on Worker custom domains
- USE "Always Use HTTPS" toggle in SSL/TLS → Edge Certificates instead — operates at TLS layer, doesn't conflict with Workers

## SSL/TLS Mode

- Zone SSL/TLS encryption mode MUST be **Full** or **Full (strict)**, never Flexible
- Flexible + any HTTPS redirect = infinite redirect loop

## Deploys Go Through CI

Never add a `deploy` script to a package. `wrangler deploy` replaces the running Worker in place, which skips the versioned upload, the canary and the readiness gate.

The pipeline in `.github/workflows/deploy.yml` is the only supported path:

```
versions upload → versions deploy <id>@10 → gate on /health/ready → versions deploy <id>@100
```

- Trigger→environment routing lives in `scripts/deploy-target.ts` so it can be unit-tested, not in workflow YAML
- Gate on the readiness probe, never liveness — liveness answers 200 from a Worker whose database is unreachable
- Pin gate requests to the version under test with `Cloudflare-Workers-Version-Overrides`; at a 10% split an unpinned probe usually reaches the old version
- Any capability needing credentials degrades to a skip with a notice, never a failure

## Debugging "Too Many Redirects"

1. `curl -sI https://domain/path` — check if response is 301 to same URL
2. If `server: cloudflare` with no app headers → request never reached Worker
3. Check: Redirect Rules > Page Rules > SSL mode > Worker binding
4. Disable redirect rules first — most common culprit with Workers
