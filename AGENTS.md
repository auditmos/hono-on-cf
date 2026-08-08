# hono-on-cf

Monorepo: Hono API on Cloudflare Workers.

## Packages

| Package | Purpose |
|---------|---------|
| `packages/data-ops` | Shared DB layer (Drizzle, Zod, Better Auth) |
| `apps/data-service` | REST API (Hono on CF Workers) |

Each has its own `AGENTS.md` with package-specific patterns (`CLAUDE.md` symlinks to `AGENTS.md`).

## Architecture

`apps/data-service` depends on `packages/data-ops` for DB queries, Zod schemas, and auth — never the reverse. `data-ops` has no compile step: its package exports point straight at TypeScript source, so a schema or query change is visible to `data-service` immediately, in both type-checks and tests.

## Commands

```bash
pnpm run setup                    # install dependencies
pnpm run dev:data-service         # API dev (port 8788)
pnpm run init-project             # bootstrap: name, custom domain, env files
pnpm run db:seed:dev / db:seed:staging / db:seed:production
pnpm run lint                     # check all (formatting + linting)
pnpm run lint:fix                 # auto-fix all
pnpm run test                     # run all tests
pnpm run test:watch               # watch mode
pnpm run test:coverage            # with coverage report
```

## Verification

Lint auto-runs via PostToolUse hook on Edit/Write (biome check --write).

After completing changes, run manually:
1. `pnpm run types` — type-check all packages
2. `pnpm run test` — run all tests
3. `pnpm run check:docs` — fail if any doc names a directory, file, endpoint, script or link that does not exist
4. `pnpm run check:runtime-types` — fail if a Worker's generated `worker-configuration.d.ts` no longer matches the compatibility date, flags and workerd version it would be generated from today

All four run on every pull request, so documentation drift and stale generated types block a merge the same way a failing test does.

- Max 500 lines per source file — split if exceeding
- Biome config: `biome.json` (root), plugins: `.biome-plugins/*.grit`

## Deployment

Deploys run in CI (`.github/workflows/deploy.yml`), never from a local command — there is no `deploy` script in any package, deliberately.

- Push to `main` → staging. A `v*.*.*` tag → production. A manual run picks either.
- The trigger→environment rule lives in `scripts/deploy-target.ts`, not in workflow YAML, so it is unit-tested.
- Every deploy uploads a version, canaries 10% of traffic, gates on `GET /health/ready` pinned to that version, then promotes to 100%. A failed gate halts and rolls back.
- Absent `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` the job skips with a notice and stays green.
- An environment binding no custom domain cannot be probed, so the pipeline refuses it rather than deploying blind.

## Rules

Cross-cutting rules auto-load by file path from `.claude/rules/`:
- [General TypeScript & Cloudflare](.claude/rules/general.md) — type safety, error handling, naming, bug-fix workflow
- [Error Handling](.claude/rules/error-handling.md) — layered Result/AppError approach
- [Deep Modules](.claude/rules/deep-modules.md) — module boundaries, where new files belong
- [Cloudflare Deployment](.claude/rules/cloudflare-deployment.md) — hostname separation, custom domains, SSL/TLS
- [Atomic Imports](.claude/rules/atomic-imports.md) — combine import + usage in one edit to survive lint auto-fix

Package-specific rules live under `.claude/rules/data-ops/` and `.claude/rules/data-service/` — see [llms.txt](./llms.txt) for the full index.

## Docs Server

`.mcp.json` wires the official Cloudflare documentation MCP server (`docs.mcp.cloudflare.com`) so agents can consult current platform docs instead of relying on training data.

## Design Docs

- `/docs` is the single source of truth for business requirements
- Apply review notes/status updates directly in the corresponding design doc
- Never create separate md files for reviews/audits/analyses unless explicitly asked
- Flag implementation deviations inline in the doc

## Don't

- Edit `apps/data-service/worker-configuration.d.ts` by hand — regenerate with `pnpm run cf-typegen`
- Edit `packages/data-ops/src/drizzle/auth-schema.ts` by hand — regenerate with `better-auth:generate`
- Reference or scaffold webhooks, queues, Durable Objects, or Workflows — none are wired in this template; document them only once actually built
