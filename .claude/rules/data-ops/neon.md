---
paths:
  - "packages/data-ops/**/*.ts"
---

# Neon Database Rules

## Connection Setup

- Singleton pattern: `initDatabase()` once in Worker entry, `getDb()` everywhere else
- Connection string built internally from host/username/password, with username and password URL-encoded
- Uses `drizzle-orm/neon-http` adapter (Neon HTTP driver implicit), passing the auth schema and relations so `db.query.*` works
- `getDb()` before `initDatabase()` throws `DatabaseNotInitializedError`

```ts
// packages/data-ops/src/database/setup.ts (abridged)
export function initDatabase(connection: { host: string; username: string; password: string }) {
  if (db) return db
  const username = encodeURIComponent(connection.username)
  const password = encodeURIComponent(connection.password)
  db = drizzle(`postgres://${username}:${password}@${connection.host}`, { schema })
  return db
}

export function getDb() {
  if (!db) throw new DatabaseNotInitializedError()
  return db
}
```

## Initialization

- Call `initDatabase()` in Worker constructor/entry point
- DB env vars set via `.*.vars` file on **data-service** (sync with `sync-secrets.sh`), not wrangler.jsonc

```ts
// Worker entry (data-service)
initDatabase({
  host: env.DATABASE_HOST,
  username: env.DATABASE_USERNAME,
  password: env.DATABASE_PASSWORD,
})
```

## Environment Variables

```bash
DATABASE_HOST="ep-xxx.region.aws.neon.tech/neondb?sslmode=require"
DATABASE_USERNAME="neondb_owner"
DATABASE_PASSWORD="npg_xxx"
```

- HOST includes DB name, SSL params, and pooler config
- Separate values per environment (dev/staging/production)

## Query Layer

- All queries call `getDb()` — never accept DB as parameter
- Use Drizzle query builder (`select`, `insert`, `update`, `delete`)
- Use `.returning()` for mutations

```ts
// packages/data-ops/src/client/queries.ts
import { eq } from 'drizzle-orm'
import { getDb } from '../database/setup'
import { clients } from './table'

export async function getClient(clientId: string) {
  const db = getDb()
  const result = await db.select().from(clients).where(eq(clients.id, clientId))
  return result[0] ?? null
}
```

## Migrations

- Drizzle Kit with env-specific configs: `drizzle-{env}.config.ts`
- Separate migration output dirs per env: `migrations/dev`, `migrations/staging`, `migrations/production`
- Schema sources (the `schema` list in each `drizzle-{env}.config.ts`): `src/drizzle/auth-schema.ts`, each domain's `table.ts`, `src/drizzle/relations.ts`

## Serverless Patterns

- Neon pooler endpoint in HOST — no manual pool config
- Singleton `db` cached per Worker isolate lifetime
- Stateless per-request query execution at edge

## Best Practices

- Avoid long-running transactions in serverless
- Use `Promise.all()` for independent parallel queries
- Use `.returning()` on insert/update/delete to avoid extra round trips
- Use `.onConflictDoNothing()` for idempotent inserts (seeds)
