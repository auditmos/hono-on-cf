---
paths:
  - "apps/data-service/**/*.ts"
---

# Cloudflare Workers Rules

## Worker Entry

- Use ES module syntax with default export
- Extend `WorkerEntrypoint` for typed bindings
- Initialize resources (DB, auth) once in the constructor, not per-request in `fetch()`

```ts
import { WorkerEntrypoint } from 'cloudflare:workers'

export default class extends WorkerEntrypoint<Env> {
  constructor(ctx: ExecutionContext, env: Env) {
    super(ctx, env)
    initDatabase({
      host: env.DATABASE_HOST,
      username: env.DATABASE_USERNAME,
      password: env.DATABASE_PASSWORD,
    })
  }

  fetch(request: Request): Promise<Response> {
    return app.fetch(request, this.env, this.ctx)
  }
}
```

## Env Bindings

- Run `pnpm cf-typegen` to generate types from wrangler.jsonc and environment variables
- Above script modifies `Env` interface in **worker-configuration.d.ts**
- Access via `this.env` or `c.env` (Hono)

```ts
interface Env {
  DATABASE_URL: string
  MY_KV: KVNamespace
  MY_BUCKET: R2Bucket
  MY_QUEUE: Queue
  MY_DO: DurableObjectNamespace
}
```

## Secrets Management

- Never hardcode secrets
- Configure via `sync-secrets.sh`
- Access same as env vars: `env.SECRET_NAME`
- Use `.dev.vars` for local dev (gitignored)

## Request Handling

- Workers are stateless—no global state
- Use `waitUntil()` for async work after response
- Respect CPU time limits (50ms on free, 30s on paid)

```ts
ctx.waitUntil(logAnalytics(request)) // non-blocking
return response
```

## Deployment

- Deploy via `pnpm deploy:staging` / `pnpm deploy:production`
- Configure environments in `wrangler.jsonc`
- Use preview deployments for testing

## Testing

- Use `@cloudflare/vitest-pool-workers` for integration tests
- Mock bindings in unit tests
- Test with `wrangler dev` locally
