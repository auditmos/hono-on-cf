# [1.4.0](https://github.com/auditmos/hono-on-cf/compare/v1.3.0...v1.4.0) (2026-03-18)


### Features

* **data-service:** rate limit /api/auth/* at 20 req/min per IP ([e8d5cf2](https://github.com/auditmos/hono-on-cf/commit/e8d5cf2f89d3c7eee59a635ca3ba34a52b82add8)), closes [#6](https://github.com/auditmos/hono-on-cf/issues/6)

# [1.3.0](https://github.com/auditmos/hono-on-cf/compare/v1.2.0...v1.3.0) (2026-03-18)


### Features

* **data-service:** protect GET /:id + add client handler tests ([7b98c52](https://github.com/auditmos/hono-on-cf/commit/7b98c526ae788e1a26321434cb0b953c5edaa1b9))

# [1.2.0](https://github.com/auditmos/hono-on-cf/compare/v1.1.0...v1.2.0) (2026-03-18)


### Bug Fixes

* biome formatting + use pnpm exec in hook ([c3bab50](https://github.com/auditmos/hono-on-cf/commit/c3bab50489d0f9d2c26443dcc064e07c7f6dbea8))


### Features

* **data-service:** add requireAuth middleware, remove static API_TOKEN auth ([f1a9d8b](https://github.com/auditmos/hono-on-cf/commit/f1a9d8b00b4ab85c199d76c4a753df3bf7bee08d)), closes [#4](https://github.com/auditmos/hono-on-cf/issues/4)
* **data-service:** bootstrap auth + mount auth route handler ([d8a664c](https://github.com/auditmos/hono-on-cf/commit/d8a664c8e39f9b463957894910894f43cc6c2971)), closes [#3](https://github.com/auditmos/hono-on-cf/issues/3)

# [1.1.0](https://github.com/auditmos/hono-on-cf/compare/v1.0.0...v1.1.0) (2026-03-17)


### Features

* **data-ops:** add bearer plugin + setAuth singleton guard ([139dc59](https://github.com/auditmos/hono-on-cf/commit/139dc5977eefc752a2adafeb869287084be0c899)), closes [#2](https://github.com/auditmos/hono-on-cf/issues/2)

# 1.0.0 (2026-03-17)


### Features

* convert to API-only monorepo template ([8e245b0](https://github.com/auditmos/hono-on-cf/commit/8e245b060a14eb845b11b6e4674f2b458976e312))
