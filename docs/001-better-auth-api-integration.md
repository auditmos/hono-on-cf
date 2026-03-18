# Better Auth Integration for data-service

## Overview

Replace the static `API_TOKEN` bearer auth in data-service with Better Auth session-based authentication. Better Auth's bearer plugin converts `Authorization: Bearer <session-token>` headers into session lookups, making it work in API-only (no browser/cookie) contexts while using the same session infrastructure as cookie-based flows.

## Context & Background

Previous state:
- `packages/data-ops` already had Better Auth configured (`src/auth/setup.ts`, `src/auth/server.ts`) with email+password, custom `approved` field, Drizzle adapter, and auth DB tables
- `apps/data-service` used `hono/bearer-auth` with a single `API_TOKEN` env var — all clients shared one static token
- Auth middleware was applied per-route: `(c, next) => authMiddleware(c.env.API_TOKEN)(c, next)`

Problems with static token:
- No per-user identity — all requests look the same
- Token rotation requires redeployment/secret update
- No session expiry, revocation, or audit trail
- Cannot implement user-scoped authorization

## Goals & Non-Goals

**Goals:**
- Wire `setAuth()` from data-ops into worker constructor
- Mount Better Auth handler routes (`/api/auth/*`) in Hono
- Replace static bearer middleware with session-based auth middleware
- Enable the bearer plugin so API clients can authenticate via `Authorization` header
- Maintain public (unauthenticated) endpoints alongside protected ones

**Non-Goals:**
- OAuth/social login providers (email+password only for now)
- Role-based access control (future doc)
- Frontend auth client integration (this is API-only)

## Design

### Auth Paths: Bearer vs Cookie

| Path | Use case | How it works |
|------|----------|--------------|
| **Bearer** (server-to-server) | API clients, scripts, service integrations | Client stores session token; sends `Authorization: Bearer <token>` on each request; bearer plugin converts to internal cookie lookup |
| **Cookie** (browser clients) | Web frontends | Browser sends `Cookie: better-auth.session_token=...` automatically; Better Auth reads it natively |

**Guidance:**
- Use bearer for server-to-server and API-client scenarios — token stored in env var or config
- Use cookie for browser clients — Better Auth sets it on sign-in response, browser sends it automatically
- Both paths hit the same session DB and use the same `getSession()` call — no code changes needed to support both simultaneously

### Service Bindings Bypass

Workers communicating via **Service Bindings** call RPC methods directly without HTTP. These calls **bypass all HTTP middleware including `requireAuth()`**. No auth is needed on RPC methods — the caller is a trusted Worker in the same Cloudflare account.

```ts
// Caller (another Worker via Service Binding)
const result = await env.DATA_SERVICE.someRpcMethod(args)
// No Authorization header — bypasses HTTP auth entirely

// data-service RPC method — no requireAuth() needed
async someRpcMethod(args: Args): Promise<Result> {
  // called only by trusted service binding callers
}
```

Only `fetch()` requests go through the Hono middleware chain.

### How Better Auth Works in API-Only Context

Better Auth is primarily cookie-based: on sign-in it sets `better-auth.session_token` cookie. The **bearer plugin** adds a hook that reads `Authorization: Bearer <token>` and converts it into that cookie header before the request reaches Better Auth's session resolution. This means:

1. Client calls `POST /api/auth/sign-in/email` with `{ email, password }`
2. Response body contains `{ session: { token: "..." }, user: { ... } }`
3. Client stores the session token
4. Subsequent requests send `Authorization: Bearer <session-token>`
5. Bearer plugin converts this to a session cookie internally
6. `auth.api.getSession()` resolves the session + user from DB

The session token in the response body is the same value Better Auth would set as a cookie. The bearer plugin just bridges the header-to-cookie gap.

### Architecture

```
Request with Authorization: Bearer <token>
  |
  v
Hono middleware chain
  |-- requestId
  |-- onError
  |-- cors
  |-- /api/auth/* --> rateLimiter (20 req/min per IP)
  |-- /api/auth/* --> Better Auth handler (sign-up, sign-in, sign-out, get-session)
  |-- /health/*   --> public (no auth)
  |-- /clients/   --> GET / public (no auth)
  |-- /clients/*  --> requireAuth() (GET /:id, POST, PUT, DELETE)
```

### Worker Initialization

`setAuth()` must be called in the worker constructor alongside `initDatabase()`. `setAuth()` has an **init guard** — if called again (e.g., from a second request hitting the same Worker instance), it returns the existing instance without reinitializing.

```ts
// apps/data-service/src/index.ts
import { WorkerEntrypoint } from "cloudflare:workers";
import { setAuth } from "@repo/data-ops/auth/server";
import { getDb, initDatabase } from "@repo/data-ops/database/setup";
import { App } from "@/hono/app";

export default class DataService extends WorkerEntrypoint<Env> {
  constructor(ctx: ExecutionContext, env: Env) {
    super(ctx, env);
    initDatabase({
      host: env.DATABASE_HOST,
      username: env.DATABASE_USERNAME,
      password: env.DATABASE_PASSWORD,
    });
    setAuth({
      secret: env.BETTER_AUTH_SECRET,
      baseURL: env.BETTER_AUTH_URL,
      adapter: {
        drizzleDb: getDb(),
        provider: "pg",
      },
    });
  }
  // ...
}
```

Note: `initDatabase()` sets the DB on a module-level variable; `getDb()` retrieves it. `setAuth()` then takes that instance.

### Better Auth Setup (data-ops)

```ts
// packages/data-ops/src/auth/setup.ts
export const createBetterAuth = (config: {
  database: BetterAuthOptions["database"];
  secret?: BetterAuthOptions["secret"];
  baseURL?: BetterAuthOptions["baseURL"];
}) => {
  return betterAuth({
    database: config.database,
    secret: config.secret,
    baseURL: config.baseURL,
    plugins: [bearer()],
    emailAndPassword: { enabled: true },
    user: {
      modelName: "auth_user",
      additionalFields: {
        approved: {
          type: "boolean",
          required: true,
          defaultValue: false,
          input: false,
        },
      },
    },
    session: {
      modelName: "auth_session",
      expiresIn: 60 * 60 * 24 * 400, // 400 days — RFC 6265 cookie Max-Age limit (better-call@1.3.2+)
      updateAge: 60 * 60 * 24,       // refresh daily on active use
    },
    verification: { modelName: "auth_verification" },
    account: { modelName: "auth_account" },
  });
};
```

**Session policy:** `expiresIn` set to 400 days (RFC 6265 cookie Max-Age limit enforced by `better-call@1.3.2+` — 10-year value caused 500 on sign-up). `updateAge: 86400` rolls expiry daily on active use, so sessions are effectively permanent for active users. Revocation is manual (delete from `auth_session`). Server-to-server clients using Bearer tokens are unaffected by cookie expiry.

No schema changes needed for the bearer plugin.

### Init Guard in setAuth

```ts
// packages/data-ops/src/auth/server.ts
let betterAuth: ReturnType<typeof createBetterAuth>;

export function setAuth(config: ...) {
  if (betterAuth) return betterAuth; // guard: idempotent
  betterAuth = createBetterAuth({ ... });
  return betterAuth;
}

export function getAuth() {
  if (!betterAuth) throw new Error("Auth not initialized");
  return betterAuth;
}
```

The guard makes `setAuth()` safe to call on every Worker constructor invocation without reinitializing or leaking instances across requests.

### Rate Limiting on Auth Routes

`/api/auth/*` is rate-limited at **20 requests/minute per IP** to prevent brute-force attacks:

```ts
// apps/data-service/src/hono/app.ts
App.use("/api/auth/*", rateLimiter({ windowMs: 60_000, maxRequests: 20 }));
App.route("/api/auth", auth);
```

The rate limiter runs before the auth handler. Exceeded requests return `429 Too Many Requests`.

### Auth Middleware (require-auth.ts)

`requireAuth()` checks session validity **and** account approval in one middleware:

```ts
// apps/data-service/src/hono/middleware/require-auth.ts
export const requireAuth = (): MiddlewareHandler => {
  return async (c, next) => {
    const auth = getAuth();
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    if (!session.user.approved) {
      return c.json({ error: "Account not approved" }, 403);
    }

    c.set("session", session);
    await next();
  };
};
```

- 401 = no valid session (missing/expired/invalid token)
- 403 = valid session but `approved === false` (unapproved account)

After `requireAuth()` runs, `c.get("session")` provides typed `{ session, user }` data.

### Mounting Auth Routes

```ts
// apps/data-service/src/hono/handlers/auth-handlers.ts
auth.all("/*", async (c) => {
  const betterAuth = getAuth();
  return betterAuth.handler(c.req.raw);
});
```

```ts
// apps/data-service/src/hono/app.ts
App.use("/api/auth/*", rateLimiter({ windowMs: 60_000, maxRequests: 20 }));
App.route("/api/auth", auth);
App.route("/health", health);
App.route("/clients", clients);
```

### Public vs Protected Endpoint Examples

```ts
// apps/data-service/src/hono/handlers/client-handlers.ts

// Public — no auth middleware
clients.get("/", zValidator("query", PaginationRequestSchema), async (c) => {
  const query = c.req.valid("query");
  return resultToResponse(c, await clientService.getClients(query));
});

// Protected — requireAuth() before handler
clients.get("/:id", requireAuth(), zValidator("param", IdParamSchema), async (c) => {
  const { id } = c.req.valid("param");
  return resultToResponse(c, await clientService.getClientById(id));
});

clients.post("/", requireAuth(), zValidator("json", ClientCreateRequestSchema), async (c) => {
  const data = c.req.valid("json");
  return resultToResponse(c, await clientService.createClient(data), 201);
});
```

Pattern: `GET /` (list) is public; `GET /:id`, mutations (`POST`, `PUT`, `DELETE`) require auth.

### Manual Approval Flow

New users have `approved = false` by default. Approval is a **direct DB operation** — no admin API endpoint:

```sql
UPDATE auth_user SET approved = true WHERE email = 'user@example.com';
```

Until approved, `requireAuth()` returns `403 Account not approved` even with a valid session. This prevents unapproved users from accessing protected endpoints without revoking their session.

### Manual Session Revocation

Sessions do not expire automatically (10-year TTL). To revoke a session:

```sql
-- Revoke specific session
DELETE FROM auth_session WHERE token = '<session-token>';

-- Revoke all sessions for a user
DELETE FROM auth_session WHERE user_id = '<user-id>';
```

Revocation is immediate — the next request with that token will get `401 Unauthorized`. The user must sign in again to get a new session.

### Auth Endpoints (provided by Better Auth)

These are automatically available under `/api/auth/*`:

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/sign-up/email` | Register with `{ email, password, name }` |
| POST | `/api/auth/sign-in/email` | Login, returns `{ session, user }` |
| POST | `/api/auth/sign-out` | Invalidate session |
| GET | `/api/auth/get-session` | Get current session |
| POST | `/api/auth/list-sessions` | List active sessions for user |
| POST | `/api/auth/revoke-session` | Revoke specific session via API |

### Client Authentication Flow (Bearer)

```
1. Sign up
   POST /api/auth/sign-up/email
   Body: { "email": "user@example.com", "password": "...", "name": "User" }
   Response: { "session": { "token": "abc123...", ... }, "user": { ... } }

2. (Admin approves the user)
   UPDATE auth_user SET approved = true WHERE email = 'user@example.com';

3. Store token (env var, config, secrets manager)

4. Make authenticated requests
   GET /clients/123
   Authorization: Bearer abc123...

5. Revoke when decommissioning
   DELETE FROM auth_session WHERE token = 'abc123...';
   -- or via API: POST /api/auth/sign-out with Authorization: Bearer abc123...
```

## Env Var Changes

### Add

| Var | Purpose | Example |
|-----|---------|---------|
| `BETTER_AUTH_SECRET` | Signs session tokens, HMAC key | `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | Base URL for auth callbacks | `http://localhost:8788` (dev), `https://api.example.com` (prod) |

### Remove

| Var | Reason |
|-----|--------|
| `API_TOKEN` | Replaced by per-user sessions — clean cutover, no dual operation |

## Migration Path (Completed)

The migration was done as a clean cutover — no dual-token phase:

1. Added `bearer()` plugin to `createBetterAuth` in data-ops
2. Added `setAuth()` call to worker constructor (after `initDatabase()`)
3. Mounted auth routes at `/api/auth` with 20/min rate limiter
4. Added `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` env vars
5. Replaced `authMiddleware(c.env.API_TOKEN)` with `requireAuth()` on all protected routes
6. Removed `API_TOKEN` from all env files and Cloudflare dashboard secrets

## Security Considerations

- `BETTER_AUTH_SECRET` must be unique per environment — it signs session tokens
- Session tokens are opaque DB-backed tokens, not JWTs — revocation is immediate
- Bearer plugin does not encrypt tokens in transit — always use HTTPS in staging/production
- Better Auth handles password hashing internally (bcrypt/argon2)
- `/api/auth/*` rate-limited at 20 req/min per IP to prevent brute force
- `approved` field gates access — unapproved users get 403 even with valid sessions

## File Changes Summary

| File | Change |
|------|--------|
| `packages/data-ops/src/auth/setup.ts` | Added `bearer()` plugin; `session.expiresIn` = 400 days; `session.updateAge` = 1 day |
| `packages/data-ops/src/auth/server.ts` | `setAuth()` init guard; `getAuth()` throw if uninitialized |
| `apps/data-service/src/index.ts` | `setAuth()` call in constructor after `initDatabase()` + `getDb()` |
| `apps/data-service/src/hono/app.ts` | Rate limiter on `/api/auth/*`; auth route mounted |
| `apps/data-service/src/hono/handlers/auth-handlers.ts` | Catch-all delegating to Better Auth handler |
| `apps/data-service/src/hono/middleware/require-auth.ts` | New — session check + approval check; replaces `authMiddleware` |
| `apps/data-service/src/hono/handlers/client-handlers.ts` | `GET /` public; `GET /:id` + mutations use `requireAuth()` |
| `apps/data-service/.dev.vars` | Added `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`; removed `API_TOKEN` |

## Open Questions (Resolved)

| Question | Resolution |
|----------|------------|
| Should GET endpoints require auth? | `GET /` (list) is public; `GET /:id` requires auth — matches use case where listing is discovery but detail access is gated |
| Should `requireAuth()` check `user.approved`? | Yes — combined into `requireAuth()`, returns 403 if not approved |
| Do we need an admin route to approve users? | No — direct DB operation (`UPDATE auth_user SET approved = true`) for now |
| Session expiry — customize defaults? | Yes — `expiresIn: 400 days` (RFC 6265 limit) + `updateAge: 86400` (daily roll); effectively no expiry for active users; revoke manually via `auth_session` deletion |
| Rate limit auth routes? | Yes — 20 req/min per IP via `rateLimiter` middleware on `/api/auth/*` |
