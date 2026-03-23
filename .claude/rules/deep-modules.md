# Deep Modules

Small interface, large implementation (Ousterhout). Absorb complexity inside modules — don't spread it across many tiny files.

## Decision Checks

- Before creating a file: does this deepen an existing module or just widen its interface?
- Before exporting: does the caller need this or is it internal?
- Shallow modules (many tiny files doing little) increase system complexity

## Module Boundaries

| Layer | Module boundary | Interface (narrow) | Hides |
|-------|----------------|-----------|-------|
| DB domain | `data-ops/src/{domain}/index.ts` | Exported queries + Zod schemas | Table defs, query builders, Drizzle internals |
| API handler | `data-service/src/hono/handlers/{name}.ts` | Hono routes | Request validation, response mapping |
| API service | `data-service/src/hono/services/{name}.ts` | Service functions returning `Result<T>` | Business rules, data-ops calls, error mapping |
| Middleware | `data-service/src/hono/middleware/{name}.ts` | Hono middleware export | Auth checks, rate limit logic, header parsing |
| Durable Object | `data-service/src/durable-objects/{name}.ts` | DO class + alarm/fetch | Internal state, storage ops |
| Workflow | `data-service/src/workflows/{name}.ts` | Workflow class | Step orchestration, retries |

## data-ops Domain Pattern

Each domain folder (`client/`, `health/`, etc.) is one deep module:

- `table.ts` — Drizzle table definition (internal)
- `schema.ts` — Zod schemas (internal unless needed by consumers)
- `queries.ts` — query functions (internal)
- `index.ts` — barrel export: only what consumers need

Don't export `table.ts` internals. If a consumer needs a column type, expose it via a Zod schema or TypeScript type from `index.ts`.

## data-service Handler→Service Split

One handler file + one service file per domain is fine. Don't split further unless a service exceeds 500 lines — then split by subdomain, not by function count.

- Handlers: thin — parse request, call service, map `Result<T>` to response
- Services: deep — all business logic, validation, data-ops calls

## Testing at the Boundary

- **data-ops domains**: test exported query functions against real DB
- **API handlers**: test via HTTP requests (`app.request()`)
- **Middleware**: test via HTTP requests with appropriate fixtures
- If you need to test an internal function → the module should probably split
