---
paths:
  - "apps/data-service/**/*.ts"
---

# Cloudflare Workers Rules

## Worker Entry

- Use ES module syntax with default export
- Extend `WorkerEntrypoint` for typed bindings
- Initialize resources (DB, auth) once in the constructor, not per-request in `fetch()`

```ts
import { WorkerEntrypoint } from 'cloudflare:workers'

export default class extends WorkerEntrypoint<Env> {
  constructor(ctx: ExecutionContext, env: Env) {
    super(ctx, env)
    initDatabase({
      host: env.DATABASE_HOST,
      username: env.DATABASE_USERNAME,
      password: env.DATABASE_PASSWORD,
    })
  }

  fetch(request: Request): Promise<Response> {
    return app.fetch(request, this.env, this.ctx)
  }
}
```

## Env Bindings

- Run `pnpm cf-typegen` to generate types from wrangler.jsonc and environment variables
- Above script modifies `Env` interface in **worker-configuration.d.ts**
- Access via `this.env` or `c.env` (Hono)

```ts
interface Env {
  DATABASE_URL: string
  MY_KV: KVNamespace
  MY_BUCKET: R2Bucket
  MY_QUEUE: Queue
  MY_DO: DurableObjectNamespace
}
```

## Secrets Management

- Never hardcode secrets
- Configure via `sync-secrets.sh`
- Access same as env vars: `env.SECRET_NAME`
- Use `.dev.vars` for local dev (gitignored)

## Request Handling

- Workers are stateless—no global state
- Use `waitUntil()` for async work after response
- Respect CPU time limits (50ms on free, 30s on paid)

```ts
ctx.waitUntil(logAnalytics(request)) // non-blocking
return response
```

## Deployment

- Deploys run in CI only — see `.claude/rules/cloudflare-deployment.md`. This package has no `deploy` script by design
- Configure environments in `wrangler.jsonc`; bind hosts as custom domains, which `pnpm run init-project` prompts for
- Test locally with `pnpm run dev`, and against a real version with a preview URL rather than a deploy

## Testing

- The Worker suite runs inside workerd via `@cloudflare/vitest-pool-workers`, configured in `vitest.config.mts`
- Bindings come from `wrangler.jsonc`'s dev environment — reach them with `import { env } from "cloudflare:workers"`
- Don't hand-roll a stub for a binding the runtime provides: a stub returns whatever you chose, which proves nothing about the platform's semantics
- Rate limits, and other binding-shaped configuration, are asserted against the values that ship — change `wrangler.jsonc` and the test moves with it
- Test with `wrangler dev` locally
