# Hono-on-CF

Modular API template on Cloudflare Workers.

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

From `packages/data-ops/` directory:

```bash
pnpm run drizzle:dev:generate  # Generate migration
pnpm run drizzle:dev:migrate   # Apply to database
```

Replace `dev` with `staging` or `production`.

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
