# Better Auth Integration for data-service

## Overview

Replace the static `API_TOKEN` bearer auth in data-service with Better Auth session-based authentication. Better Auth's bearer plugin converts `Authorization: Bearer <session-token>` headers into session lookups, making it work in API-only (no browser/cookie) contexts while using the same session infrastructure as cookie-based flows.

## Context & Background

Current state:
- `packages/data-ops` already has Better Auth configured (`src/auth/setup.ts`, `src/auth/server.ts`) with email+password, custom `approved` field, Drizzle adapter, and auth DB tables
- `apps/data-service` uses `hono/bearer-auth` with a single `API_TOKEN` env var -- all clients share one static token
- Auth middleware is applied per-route: `(c, next) => authMiddleware(c.env.API_TOKEN)(c, next)`

Problems with static token:
- No per-user identity -- all requests look the same
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
- Rate limiting on auth endpoints (already have rate-limiter middleware, can apply separately)

## Design

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
  |-- /api/auth/* --> Better Auth handler (sign-up, sign-in, sign-out, get-session)
  |-- /health/*   --> public (no auth)
  |-- /clients/*  --> betterAuthMiddleware (GET public, mutations protected)
```

### Worker Initialization

`setAuth()` must be called in the worker constructor alongside `initDatabase()`, since Better Auth needs the Drizzle DB instance.

```ts
// apps/data-service/src/index.ts
import { WorkerEntrypoint } from "cloudflare:workers";
import { initDatabase } from "@repo/data-ops/database/setup";
import { setAuth } from "@repo/data-ops/auth/server";
import { App } from "@/hono/app";

export default class DataService extends WorkerEntrypoint<Env> {
  constructor(ctx: ExecutionContext, env: Env) {
    super(ctx, env);
    const db = initDatabase({
      host: env.DATABASE_HOST,
      username: env.DATABASE_USERNAME,
      password: env.DATABASE_PASSWORD,
    });
    setAuth({
      secret: env.BETTER_AUTH_SECRET,
      baseURL: env.BETTER_AUTH_URL,
      adapter: {
        drizzleDb: db,
        provider: "pg",
      },
    });
  }
  // ... rest unchanged
}
```

`initDatabase()` returns the db instance (it already does -- see `database/setup.ts` line 8-12), so we can pass it directly to `setAuth()`.

### Better Auth Setup Changes (data-ops)

Add the bearer plugin to `createBetterAuth` in `packages/data-ops/src/auth/setup.ts`:

```ts
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins/bearer";

export const createBetterAuth = (config: {
  database: BetterAuthOptions["database"];
  secret?: BetterAuthOptions["secret"];
  baseURL?: BetterAuthOptions["baseURL"];
}) => {
  return betterAuth({
    database: config.database,
    secret: config.secret,
    baseURL: config.baseURL,
    emailAndPassword: {
      enabled: true,
    },
    plugins: [bearer()],
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
    },
    verification: {
      modelName: "auth_verification",
    },
    account: {
      modelName: "auth_account",
    },
  });
};
```

No schema changes needed -- bearer plugin has no additional tables.

### Mounting Auth Routes in Hono

Better Auth exposes `auth.handler(request): Promise<Response>` which handles all `/api/auth/*` routes internally. Mount it as a catch-all in Hono:

```ts
// apps/data-service/src/hono/handlers/auth-handlers.ts
import { getAuth } from "@repo/data-ops/auth/server";
import { Hono } from "hono";

const auth = new Hono<{ Bindings: Env }>();

auth.all("/*", async (c) => {
  const betterAuth = getAuth();
  return betterAuth.handler(c.req.raw);
});

export default auth;
```

```ts
// apps/data-service/src/hono/app.ts
import auth from "./handlers/auth-handlers";

// Mount BEFORE other routes
App.route("/api/auth", auth);
App.route("/health", health);
App.route("/clients", clients);
```

Better Auth expects its routes under `/api/auth` by default. The `baseURL` env var tells it the full origin (e.g., `http://localhost:8788`) so it can construct callback URLs. The route prefix `/api/auth` is Better Auth's default and does not need configuration.

### Auth Middleware Replacement

Replace `authMiddleware` (static token check) with a middleware that calls `auth.api.getSession()`:

```ts
// apps/data-service/src/hono/middleware/auth.ts
import type { Context, MiddlewareHandler, Next } from "hono";
import { getAuth } from "@repo/data-ops/auth/server";

// Augment Hono context with session data
declare module "hono" {
  interface ContextVariableMap {
    session: {
      session: { id: string; userId: string; token: string; expiresAt: Date };
      user: { id: string; email: string; name: string; approved: boolean };
    };
  }
}

export const requireAuth = (): MiddlewareHandler => {
  return async (c: Context, next: Next) => {
    const auth = getAuth();
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    c.set("session", session);
    await next();
  };
};
```

`auth.api.getSession()` accepts `{ headers }` -- it reads the session token from the `Authorization` header (via bearer plugin) or `Cookie` header, looks it up in the DB, and returns `{ session, user }` or `null`.

### Handler Changes

Replace `authMiddleware(c.env.API_TOKEN)` with `requireAuth()`:

```ts
// apps/data-service/src/hono/handlers/client-handlers.ts
import { requireAuth } from "../middleware/auth";

// Public: no auth
clients.get("/", zValidator("query", PaginationRequestSchema), async (c) => {
  const query = c.req.valid("query");
  return resultToResponse(c, await clientService.getClients(query));
});

// Protected: requires session
clients.post(
  "/",
  requireAuth(),
  zValidator("json", ClientCreateRequestSchema),
  async (c) => {
    const { user } = c.get("session");
    const data = c.req.valid("json");
    return resultToResponse(c, await clientService.createClient(data), 201);
  },
);
```

Pattern: `requireAuth()` is a Hono middleware factory (no args needed, unlike the old `authMiddleware(token)`). After it runs, `c.get("session")` provides typed user+session data.

### Auth Endpoints (provided by Better Auth)

These are automatically available under `/api/auth/*`:

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/sign-up/email` | Register with `{ email, password, name }` |
| POST | `/api/auth/sign-in/email` | Login, returns `{ session, user }` |
| POST | `/api/auth/sign-out` | Invalidate session |
| GET | `/api/auth/get-session` | Get current session (for validation) |
| POST | `/api/auth/list-sessions` | List active sessions for user |
| POST | `/api/auth/revoke-session` | Revoke specific session |

### Client Authentication Flow

```
1. Sign up
   POST /api/auth/sign-up/email
   Body: { "email": "user@example.com", "password": "...", "name": "User" }
   Response: { "session": { "token": "abc123...", ... }, "user": { ... } }

2. Store token client-side (env var, config, memory)

3. Make authenticated requests
   GET /clients
   Authorization: Bearer abc123...

4. Sign out (optional -- or let session expire)
   POST /api/auth/sign-out
   Authorization: Bearer abc123...
```

### Sample: Public vs Protected Endpoint

```ts
// Public -- no middleware
clients.get("/:id", zValidator("param", IdParamSchema), async (c) => {
  const { id } = c.req.valid("param");
  return resultToResponse(c, await clientService.getClientById(id));
});

// Protected -- requireAuth() middleware, session available on context
clients.delete(
  "/:id",
  requireAuth(),
  zValidator("param", IdParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const { user } = c.get("session");
    // user.id, user.email, user.approved available here
    const result = await clientService.deleteClient(id);
    if (!result.ok)
      return c.json(
        { error: result.error.message, code: result.error.code },
        result.error.status as ContentfulStatusCode,
      );
    return c.body(null, 204);
  },
);
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
| `API_TOKEN` | Replaced by per-user sessions |

### Update worker-configuration.d.ts

After updating `.dev.vars`, run `pnpm run cf-typegen` to regenerate `Env`:

```ts
interface Env {
  // ... existing
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  // API_TOKEN removed
}
```

## Migration Path

### Phase 1: Add Better Auth alongside API_TOKEN

1. Add `bearer()` plugin to `createBetterAuth` in data-ops
2. Rebuild data-ops: `pnpm --filter @repo/data-ops build`
3. Add `setAuth()` call to worker constructor
4. Mount auth routes at `/api/auth`
5. Add `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` to `.dev.vars`
6. Create `requireAuth()` middleware (new file or replace existing)
7. Keep `authMiddleware` working -- both can coexist temporarily

### Phase 2: Switch endpoints

1. Replace `authMiddleware(c.env.API_TOKEN)` with `requireAuth()` on each protected route
2. Update CORS `allowHeaders` to include `Authorization` (already present)
3. Test: sign up via `/api/auth/sign-up/email`, use returned token for protected endpoints

### Phase 3: Cleanup

1. Remove `API_TOKEN` from `.dev.vars`, `.staging.vars`, `.production.vars`
2. Remove old `authMiddleware` function
3. Run `pnpm run cf-typegen` to drop `API_TOKEN` from `Env`
4. Remove `API_TOKEN` from `sync-secrets.sh` / Cloudflare dashboard

## Security Considerations

- `BETTER_AUTH_SECRET` must be unique per environment and kept secret -- it signs session tokens
- Session tokens are opaque DB-backed tokens, not JWTs -- revocation is immediate (delete from `auth_session` table)
- Bearer plugin does not encrypt tokens in transit -- always use HTTPS in staging/production
- The `approved` field on `auth_user` defaults to `false` -- consider adding an approval check in `requireAuth()` if unapproved users should be blocked:

```ts
if (!session.user.approved) {
  return c.json({ error: "Account not approved" }, 403);
}
```

- Better Auth handles password hashing (bcrypt/argon2 via its internal crypto)
- Rate limit `/api/auth/sign-in/email` to prevent brute force (apply `rateLimiter` middleware to auth routes)

## File Changes Summary

| File | Change |
|------|--------|
| `packages/data-ops/src/auth/setup.ts` | Add `bearer()` plugin import + config |
| `apps/data-service/src/index.ts` | Add `setAuth()` call in constructor |
| `apps/data-service/src/hono/app.ts` | Mount auth route, remove old auth import |
| `apps/data-service/src/hono/handlers/auth-handlers.ts` | **New** -- catch-all to Better Auth handler |
| `apps/data-service/src/hono/middleware/auth.ts` | Replace `authMiddleware` with `requireAuth` |
| `apps/data-service/src/hono/handlers/client-handlers.ts` | Switch to `requireAuth()` |
| `apps/data-service/.dev.vars` | Add `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`; remove `API_TOKEN` |

## Open Questions

- Should GET endpoints (list/detail) require auth or stay public? Current design keeps them public matching existing behavior, but this is a policy decision.
- Should `requireAuth()` also check `user.approved === true`? If so, need a separate `requireApproved()` or combine into one middleware with options.
- Do we need an admin route to approve users, or is that a direct DB operation for now?
- Session expiry/`updateAge` defaults from Better Auth are sensible (7 days / 1 day refresh) -- do we want to customize?
- Should auth routes (`/api/auth/*`) have rate limiting applied, and at what thresholds?
