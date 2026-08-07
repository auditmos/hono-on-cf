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

**Auth routes** (`/api/auth/*`) already have `rateLimiter({ windowMs: 60_000, maxRequests: 20 })` applied in `app.ts` — don't add again.

</important>

## Dev

```bash
pnpm run dev                # local dev server (port 8788)
pnpm run deploy:staging     # wrangler deploy --env staging
pnpm run deploy:production  # wrangler deploy --env production
```

## Env vars

Required in `.dev.vars` (local) or Cloudflare dashboard (remote):
- `DATABASE_HOST`, `DATABASE_USERNAME`, `DATABASE_PASSWORD`
- `CLOUDFLARE_ENV` - dev | staging | production
- `ALLOWED_ORIGINS` - comma-separated origins (prod/staging only)
- `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` - Better Auth config

## Don't

- Put DB queries here - add to `@repo/data-ops/{domain}`
- Modify `worker-configuration.d.ts`, use `pnpm run cf-typegen`
