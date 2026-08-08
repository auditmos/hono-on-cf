# data-service

Cloudflare Worker API exposing data-ops queries via Hono REST endpoints.

## Stack

- Hono (Cloudflare Workers adapter)
- WorkerEntrypoint class pattern
- Consumes `@repo/data-ops` for DB queries and Zod schemas

## Structure

```
src/
├── index.ts              # Worker entrypoint, initializes DB
└── hono/
    ├── app.ts            # Hono app, middleware chain, routes
    ├── handlers/         # Route handlers (thin, delegate to services)
    ├── services/         # Business logic, calls data-ops queries
    ├── middleware/       # request-id, cors, auth, rate-limiter, error-handler
    └── utils/            # error helpers (createErrorResponse, isError)
```

## Patterns

See `hono.md` and `error-handling.md` rules for handler/service/query patterns and Result/AppError details.

**Middleware order** (in app.ts):
1. `requestId()` - generates/passes correlation ID
2. `onError` - global error handler
3. `cors` - CORS headers
4. Route-specific: `requireAuth()`, `rateLimiter`, `zValidator`

## Endpoints

- `GET /health/live` - liveness (instant 200)
- `GET /health/ready` - readiness (checks DB)
- `GET /clients` - public list
- `GET|POST|PUT|DELETE /clients/*` - CRUD (GET /:id + mutations require auth)
- `POST /api/auth/*` - Better Auth routes (sign-up, sign-in, sign-out, get-session)

<important if="you are adding or modifying routes, handlers, or middleware">

## Auth Patterns

`requireAuth()` from `middleware/require-auth.ts` — checks session validity + `approved` flag:
- `401` — no valid session
- `403` — valid session but `approved === false`
- On success, `c.get("session")` → `{ session, user }` typed

```ts
// Public — no middleware
clients.get("/", zValidator(...), handler)

// Protected — requireAuth() before validators
clients.post("/", requireAuth(), zValidator(...), handler)
```

**Service Bindings:** RPC methods on `WorkerEntrypoint` bypass HTTP entirely — no `requireAuth()` needed on them. Only `fetch()` goes through Hono middleware.

**Auth routes** (`/api/auth/*`) already have `rateLimiter("RATE_LIMIT_AUTH", { windowSeconds: 60 })` applied in `app.ts` — don't add again. The middleware names a binding; the actual limit lives in `wrangler.jsonc` under `ratelimits`, per environment.

</important>

## Dev

```bash
pnpm run dev                # local dev server (port 8788)
```

Deployment is CI-only — see the Deployment section of the root `AGENTS.md`. This package intentionally has no `deploy` script: a local `wrangler deploy` replaces the running Worker in place, skipping the versioned upload, the canary and the readiness gate the pipeline is built around.

## Testing

```bash
pnpm run test               # vitest run, inside workerd
```

This suite runs in the Workers runtime (`vitest.config.mts` wires `@cloudflare/vitest-pool-workers`), not Node. Bindings are the real ones from `wrangler.jsonc`'s dev environment — `import { env } from "cloudflare:workers"` and use them directly rather than stubbing. Rate-limit assertions therefore track whatever `ratelimits` says, so changing a limit there changes what the tests enforce.

Everything runs locally: no credentials, no network, no container runtime. `.dev.vars` is loaded when present but nothing in the suite depends on it.

## Env vars

Split by sensitivity, not by convenience.

**Versioned config** — `wrangler.jsonc`, under `env.<name>.vars`, so a change is reviewable in the pull request that makes it:
- `CLOUDFLARE_ENV` - dev | staging | production
- `ALLOWED_ORIGINS` - comma-separated origins (staging/production; dev uses a fixed localhost list)

**Secrets** — `.dev.vars` (local) or pushed with `./sync-secrets.sh <env>` (remote), never committed:
- `DATABASE_HOST`, `DATABASE_USERNAME`, `DATABASE_PASSWORD`
- `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` - Better Auth config

`sync-secrets.sh` pushes the whole file in one `wrangler secret bulk` call and refuses any key that belongs in versioned config.

After editing `env.<name>.vars`, run `pnpm run cf-typegen`. Wrangler types the dev environment's vars as literals, which `service-bindings.d.ts` widens back to `string` — the same code runs in every environment.

The same applies to `compatibility_date` and `compatibility_flags`: they decide which runtime types get generated, so changing one without regenerating leaves the Worker compiling against a runtime it no longer targets. `pnpm run check:runtime-types` fails the build on that gap, in CI and locally.

## Placement

`staging` and `production` run with `"placement": { "mode": "smart" }` so the Worker runs near the single-region Postgres rather than near an arbitrary visitor. `dev` is excluded — the local runtime has no placement decision to make.

## Don't

- Put DB queries here - add to `@repo/data-ops/{domain}`
- Modify `worker-configuration.d.ts`, use `pnpm run cf-typegen`
