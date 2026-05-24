---
paths:
  - "apps/data-service/**/*.ts"
---

# Hono Framework Rules

## App Setup

- Type bindings via `Hono<{ Bindings: Env }>`
- Access env via `c.env`, not `process.env`
- Export `app.fetch` for Workers

```ts
import { Hono } from 'hono'
import type { Env } from './types'

const app = new Hono<{ Bindings: Env }>()

export default {
  fetch: app.fetch,
}
```

## Middleware Chain

Apply in order: requestId → errorHandler → cors → auth → rateLimiter → validator

```ts
app.use('*', requestId())
app.use('*', errorHandler())
app.use('*', cors())
app.use('/api/*', requireAuth())
app.use('/api/*', rateLimiter())
```

## Route Structure

- Handlers: thin wrappers, call services
- Services: business logic, call data-ops queries
- Keep handlers focused on HTTP concerns

```ts
// handlers/users.ts
export const getUser = async (c: Context) => {
  const { id } = c.req.param()
  const result = await userService.getById(c.env, id)
  if (!result) return c.json({ error: 'Not found' }, 404)
  return c.json(result)
}
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

```ts
// Success
return c.json({ data: user })
return c.json({ data: users, meta: { total, page } })

// Error
return c.json({ error: 'Not found' }, 404)
return c.json({ error: 'Validation failed', details: errors }, 400)
```
