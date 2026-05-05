# Hono-on-CF

*AI agent index: [llms.txt](./llms.txt)*

Modular API template on Cloudflare Workers.

## Using this Template

1. Click **Use this template** on GitHub (or `gh repo create --template`).
2. Rename the worker in `apps/data-service/wrangler.jsonc` (`name`) and `apps/data-service/package.json` (`name`).
3. Provision a Neon database and fill in `packages/data-ops/.env.dev` (see [.env.example](./packages/data-ops/.env.example)) and `apps/data-service/.dev.vars`.
4. Run `pnpm run setup && pnpm run db:migrate:dev`.
5. Start dev: `pnpm run dev:data-service` (port 8788).
6. Delete the example `client` domain (`packages/data-ops/src/client/`, `apps/data-service/src/hono/handlers/client-handlers.ts` + related service/test) when you no longer need the demo, and start modelling your own domain.

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

Installs all dependencies and builds data-ops package.

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

```bash
pnpm run deploy:staging:data-service
pnpm run deploy:production:data-service
```

Secrets sync: `bash apps/data-service/sync-secrets.sh {env}`

### Cloudflare Account Override

To deploy to a different CF account, copy `.env.example` to `.env` and fill in `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`.

## Package Docs

Each package has its own `AGENTS.md` with detailed structure, patterns, and workflows (`CLAUDE.md` symlinks to `AGENTS.md`).

## Brainstormer

Planning skills ([brainstormer](https://github.com/auditmos/brainstormer)) are pre-configured via `extraKnownMarketplaces` and `enabledPlugins` in `.claude/settings.json`. They install automatically on first open.

To update to the latest brainstormer skills:

```bash
/plugin marketplace update brainstormer
```
