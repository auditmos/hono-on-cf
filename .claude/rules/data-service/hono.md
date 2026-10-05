---
paths:
  - "apps/data-service/**/*.ts"
---

# Hono Framework Rules

## App Setup

- Type bindings via `Hono<{ Bindings: Env }>` (`Env` is ambient — no import)
- Access env via `c.env`, not `process.env`
- `App` in `apps/data-service/src/hono/app.ts` is not the Worker's default export: the `WorkerEntrypoint` class in `apps/data-service/src/index.ts` forwards `fetch()` to `App.fetch` (see `cloudflare-workers.md`)

## Middleware Chain

Global, in `app.ts`: `requestId()` → `App.onError(onErrorHandler)` → CORS. Auth, rate limiting and validation are per route, in that order — not mounted on a path prefix:

```ts
App.use("*", requestId());
App.onError(onErrorHandler);
App.use("*", createCorsMiddleware());

clients.post("/", requireAuth(), zValidator("json", ClientCreateRequestSchema), handler);
```

## Route Structure

- Handlers: thin wrappers, call services
- Services: business logic, call data-ops queries
- Keep handlers focused on HTTP concerns

```ts
// handlers/client-handlers.ts
clients.get("/:id", requireAuth(), zValidator("param", IdParamSchema), async (c) => {
  const { id } = c.req.valid("param");
  return resultToResponse(c, await clientService.getClientById(id));
});
```

## Request Validation

**ALWAYS** use `zValidator` from `@hono/zod-validator` — never raw `z.parse()`, `z.safeParse()`, or manual `c.req.json()` parsing in handlers.

**ALWAYS** import named schemas from `@repo/data-ops/{domain}` — never write inline `z.object()` inside `zValidator()`. If a schema doesn't exist yet, create it in the appropriate `data-ops` package first.

```ts
// CORRECT — named schema from data-ops
import { zValidator } from '@hono/zod-validator'
import { UserCreateSchema, UserIdParamSchema } from '@repo/data-ops/user'

app.post('/users',
  zValidator('json', UserCreateSchema),
  async (c) => {
    const data = c.req.valid('json') // typed!
  }
)

app.get('/users/:id',
  zValidator('param', UserIdParamSchema),
  async (c) => {
    const { id } = c.req.valid('param')
  }
)

// WRONG — inline z.object()
zValidator('param', z.object({ id: z.string().uuid() }))

// WRONG — raw Zod parsing
const body = await c.req.json()
const data = UserCreateSchema.parse(body)
```

## Error Handling

- Services return `Result<T>` (see `error-handling.md`) — never throw
- Handlers map `Result<T>` to responses via the local `resultToResponse` helper
- For middleware short-circuits (auth, rate limit, validation), throw `HTTPException` from `hono/http-exception` — the global `onErrorHandler` formats it
- Don't introduce a new error class; the two surfaces above cover every case in this service

## Response Patterns

- Success: the service's data as-is — `c.json(result.data, status)`; a delete returns `c.body(null, 204)`
- Lists: `{ data, pagination: { total, limit, offset, hasMore } }` (`ClientListResponseSchema`)
- Service errors: `{ error, code }` with the `AppError` status, via `resultToResponse`
- Thrown errors, written by `onErrorHandler`: `{ error, requestId }` for an `HTTPException`, `{ error }` with 500 for anything else
