# Hono-on-CF

*AI agent index: [llms.txt](./llms.txt)*

Modular API template on Cloudflare Workers.

## Using this Template

1. Click **Use this template** on GitHub (or `gh repo create --template`).
2. `pnpm install`.
3. `pnpm run init-project` — prompts for a kebab-case project name and a custom domain, then:
   - renames `apps/data-service/wrangler.jsonc` + root `package.json`
   - binds `api-staging.<domain>` and `api.<domain>` as **custom domains** (which create their own DNS records and certificates, unlike route patterns) and points `ALLOWED_ORIGINS` at the same domain
   - fans out the `*.example` templates into per-env files (`apps/data-service/.{dev,staging,production}.vars`, `packages/data-ops/.env.{dev,staging,production}`)

   Idempotent — re-runnable, never overwrites filled-in files. Leave the domain blank to decide later; deploys stay blocked until one is bound. The script's "Next steps" output lists every field that still needs a value.
4. Provision a Neon database and fill `DATABASE_HOST/USERNAME/PASSWORD` in the env files created above. Set `BETTER_AUTH_SECRET` (`openssl rand -base64 32`) and `BETTER_AUTH_URL` per environment in `apps/data-service/.{dev,staging,production}.vars`.
5. Run `pnpm run setup && pnpm run db:generate:dev && pnpm run db:migrate:dev`.
6. Start dev: `pnpm run dev:data-service` (port 8788).
7. *(Optional, when you're done with the demo)* delete the example `client` domain: `packages/data-ops/src/client/`, `apps/data-service/src/hono/handlers/client-handlers.ts` + matching service/test. Then start modelling your own domain.

See [Setup](#setup) and [Deployment](#deployment) below for the full dev/deploy loop.

## Architecture

Monorepo using [pnpm workspace](https://pnpm.io/workspaces):

- [apps/data-service](./apps/data-service/) - REST API (Hono on Cloudflare Workers)
- [packages/data-ops](./packages/data-ops/) - Shared DB layer (schemas, queries, auth)

Stack: [Hono](https://hono.dev), [Better Auth](https://www.better-auth.com/docs/introduction), [Drizzle ORM](https://orm.drizzle.team/docs/overview), [Cloudflare Workers](https://developers.cloudflare.com/workers/), [Neon Postgres](https://neon.tech).

## Setup

```bash
pnpm run setup
```

Installs all dependencies. `packages/data-ops` has no compile step — it is consumed directly from TypeScript source.

## Development

```bash
pnpm run dev:data-service      # Hono API (port 8788)
```

### Database Migrations

From the repo root (proxies to `packages/data-ops`):

```bash
pnpm run db:generate:dev   # Generate migration
pnpm run db:migrate:dev    # Apply to database
pnpm run db:pull:dev       # Pull schema from DB
pnpm run db:seed:dev       # Seed sample data
pnpm run db:studio         # Open Drizzle Studio (dev only)
```

Replace `dev` with `staging` or `production` (except `db:studio`, which is dev-only).

### Environment Variables

- `packages/data-ops/` — `.env.dev`, `.env.staging`, `.env.production` (see [.env.example](./packages/data-ops/.env.example))
- `apps/data-service/` — `.dev.vars` (local), Cloudflare dashboard (remote)

## Authentication

```bash
# Sign up
curl -X POST http://localhost:8788/api/auth/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"...","name":"User"}'

# Sign in — returns session token
curl -X POST http://localhost:8788/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"..."}'
# → { "session": { "token": "abc123..." }, "user": { ... } }

# Use token on protected endpoints
curl http://localhost:8788/clients/123 \
  -H "Authorization: Bearer abc123..."
```

New accounts have `approved = false`. An admin must approve before protected endpoints are accessible:

```sql
UPDATE auth_user SET approved = true WHERE email = 'user@example.com';
```

Sessions don't expire automatically. Revoke by deleting from `auth_session`.

## Testing

```bash
pnpm run test              # run all tests
pnpm run test:watch        # watch mode
pnpm run test:coverage     # with coverage report
```

Uses [Vitest](https://vitest.dev) with workspace projects. Each package can also run tests independently via `pnpm --filter <package> test`.

## Deployment

Deploys run in CI ([.github/workflows/deploy.yml](./.github/workflows/deploy.yml)), not from a laptop.

| Trigger | Deploys to |
|---------|-----------|
| Push to `main` | staging |
| Push a `v*.*.*` tag | production |
| Manual run (**Actions → Deploy → Run workflow**) | whichever you pick |

A merge alone never reaches production — that rule lives in [scripts/deploy-target.ts](./scripts/deploy-target.ts) and is covered by tests.

Each deploy uploads a version, sends 10% of traffic to it, then runs a readiness gate: it probes `GET /health/ready` — the endpoint that opens a real database connection, unlike `/health/live` — with the request pinned to the new version. Only a passing gate promotes it to 100%; a failing one halts the rollout and returns all traffic to the previous version.

### Enabling deploys

Until it is configured the deploy job **skips with a notice and the workflow stays green** — a fresh clone is never handed a red build it did not ask for. To turn it on:

1. Add repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
2. Create GitHub environments `staging` and `production`, and give `production` a required reviewer.
3. Bind a custom domain in `apps/data-service/wrangler.jsonc` — `pnpm run init-project` prompts for one. Without it there is nothing to probe, so the pipeline refuses to deploy rather than promote a version nobody is watching.

No code change is needed at any point.

Secrets for the Worker itself (database credentials, auth secret) are pushed separately: `bash apps/data-service/sync-secrets.sh {env}`.

## Package Docs

Each package has its own `AGENTS.md` with detailed structure, patterns, and workflows (`CLAUDE.md` symlinks to `AGENTS.md`).

## Brainstormer

Planning skills ([brainstormer](https://github.com/auditmos/brainstormer)) are pre-configured via `extraKnownMarketplaces` and `enabledPlugins` in `.claude/settings.json`. They install automatically on first open.

To update to the latest brainstormer skills:

```bash
/plugin marketplace update brainstormer
```
