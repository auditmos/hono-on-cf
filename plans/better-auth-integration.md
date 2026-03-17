# Plan: Better Auth API Integration

> Source PRD: https://github.com/auditmos/hono-on-cf/issues/1

## Architectural decisions

- **Auth strategy**: Better Auth with bearer plugin for API-only contexts. Bearer plugin converts `Authorization: Bearer <token>` to session cookie internally — same session resolution for both header and cookie flows.
- **Two client paths**: External clients authenticate via HTTP (Better Auth). Internal services use Cloudflare Service Bindings (RPC, bypasses HTTP auth entirely).
- **Session policy**: No automatic expiry. Tokens are opaque, DB-backed (not JWTs). Revocation by deleting from `auth_session` table.
- **User approval**: `auth_user.approved` defaults to `false`. Manual DB approval. Middleware enforces `approved = true` — 403 otherwise.
- **Initialization pattern**: `setAuth()` follows same singleton guard as `initDatabase()` — `if (betterAuth) return betterAuth` prevents per-request re-initialization in Workers.
- **Migration**: Clean cutover. `API_TOKEN` removed entirely, no dual-auth phase.
- **Rate limiting**: 20 req/min per IP on all `/api/auth/*` endpoints.
- **CORS**: Already configured correctly (specific origins, `credentials: true`, `Authorization` header allowed). No changes needed.

---

## Phase 1: Auth bootstrap + sign-up/sign-in

**User stories**: 1, 2, 10

### What to build

End-to-end auth infrastructure: bearer plugin added to Better Auth config, initialization guard on `setAuth()`, auth bootstrapped in worker constructor, auth route handler mounted at `/api/auth/*`. A client can sign up with email+password, sign in to receive a session token, and validate their session via get-session — all through the bearer plugin path.

### Acceptance criteria

- [ ] Auth instance includes bearer plugin (header-to-cookie bridge active)
- [ ] `setAuth()` called twice returns same instance without recreating
- [ ] `getAuth()` before `setAuth()` throws
- [ ] Worker constructor initializes both database and auth without error
- [ ] `POST /api/auth/sign-up/email` with `{ email, password, name }` returns 200 with `{ session, user }` — user has `approved: false`
- [ ] `POST /api/auth/sign-in/email` with valid credentials returns 200 with session token
- [ ] `POST /api/auth/sign-in/email` with invalid credentials returns error
- [ ] `GET /api/auth/get-session` with valid `Authorization: Bearer <token>` returns session data
- [ ] `GET /api/auth/get-session` without token returns null/error
- [ ] New env vars `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` added to `.dev.vars`

---

## Phase 2: Session auth middleware + protected endpoints

**User stories**: 3, 4, 5, 6, 14, 15

### What to build

Replace static token auth with session-based middleware. `requireAuth()` resolves session from bearer token, checks `user.approved`, sets typed session data on Hono context. All mutation endpoints (POST/PUT/DELETE) switch from `authMiddleware(API_TOKEN)` to `requireAuth()`. Old auth middleware and `API_TOKEN` removed.

### Acceptance criteria

- [ ] Protected endpoint with no `Authorization` header returns 401
- [ ] Protected endpoint with invalid/unknown token returns 401
- [ ] Protected endpoint with valid token but `approved = false` returns 403 `{ error: "Account not approved" }`
- [ ] Protected endpoint with valid token and `approved = true` returns success
- [ ] `c.get("session")` in handler contains typed `{ session, user }` with `id`, `email`, `name`, `approved`
- [ ] `requireAuth()` takes no arguments — clean one-liner middleware
- [ ] Old `authMiddleware` function removed
- [ ] `API_TOKEN` removed from env types, `.dev.vars`, and all code references
- [ ] Full flow works: sign-up → set `approved = true` in DB → sign-in → bearer token → POST to protected endpoint → 201

---

## Phase 3: Rate limiting + sign-out + cleanup

**User stories**: 8, 9, 16

### What to build

Rate limiting applied to auth endpoints. Sign-out endpoint invalidates session. Env var cleanup across all environment configs. Verify no session expiry is configured (Better Auth defaults left alone or explicitly set to no-expiry).

### Acceptance criteria

- [ ] `POST /api/auth/sign-out` with valid bearer token invalidates session — subsequent requests with that token return 401
- [ ] Auth endpoints (`/api/auth/*`) return 429 after 20 requests per minute from same IP
- [ ] Rate limiting does not affect non-auth endpoints
- [ ] Sessions do not expire automatically (token valid indefinitely until revoked)
- [ ] `API_TOKEN` removed from `.staging.vars`, `.production.vars`, and `sync-secrets.sh` if present
- [ ] `pnpm run cf-typegen` produces clean `Env` without `API_TOKEN`

---

## Phase 4: Documentation + template guidance

**User stories**: 7, 11, 12, 13, 17, 18

### What to build

Update the design doc (`docs/001-better-auth-api-integration.md`) with all decisions from discovery and implementation. Add template guidance for future developers: when to use bearer vs cookies, how Service Bindings bypass auth, public vs protected endpoint patterns, manual approval and revocation via DB.

### Acceptance criteria

- [ ] Design doc updated with: approval check in middleware, init guard, rate limiting thresholds, clean cutover (no phased migration), no session expiry
- [ ] Document explains bearer path (server-to-server) vs cookie path (browser clients) with guidance on when to use which
- [ ] Document explicitly states Service Bindings bypass HTTP auth and middleware — no auth needed on RPC methods
- [ ] Document shows both public GET and protected GET examples so devs can choose per-resource
- [ ] Document describes manual approval flow (set `approved = true` in `auth_user`)
- [ ] Document describes manual revocation flow (delete row from `auth_session`)
- [ ] All open questions from original doc resolved inline
