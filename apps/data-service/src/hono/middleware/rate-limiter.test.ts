import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { rateLimiter } from "./rate-limiter";

// The dev environment in wrangler.jsonc configures RATE_LIMIT_AUTH at 20 requests
// per 60s. Every assertion below drives that real binding — there is no stub in
// the path, so the numbers here are the platform's, not a test author's choice.
const AUTH_LIMIT = 20;

const makeApp = () => {
	const app = new Hono<{ Bindings: Env }>();
	app.use("/*", rateLimiter("RATE_LIMIT_AUTH", { windowSeconds: 60 }));
	app.get("/test", (c) => c.json({ ok: true }));
	return app;
};

const req = (app: Hono<{ Bindings: Env }>, ip: string) =>
	app.request("/test", { headers: { "cf-connecting-ip": ip } }, env);

describe("rateLimiter", () => {
	it("executes inside the Workers runtime, not Node", () => {
		// Every assertion below is only worth anything if a real RateLimit binding
		// is enforcing it, and that binding only exists in workerd.
		expect(navigator.userAgent).toBe("Cloudflare-Workers");
		expect(env.RATE_LIMIT_AUTH).toBeInstanceOf(Object);
	});

	it("rejects with 429 once the real binding's configured limit is exceeded", async () => {
		const app = makeApp();
		const ip = "203.0.113.1";

		for (let i = 0; i < AUTH_LIMIT; i++) {
			const allowed = await req(app, ip);
			expect(allowed.status).toBe(200);
		}

		const res = await req(app, ip);

		expect(res.status).toBe(429);
		expect(await res.json()).toEqual({ error: "Too many requests" });
	});

	it("gives every unidentifiable caller its own bucket in dev", async () => {
		// No edge sits in front of the local runtime, so nothing stamps a client
		// address. Sharing one bucket here would make concurrent tests throttle
		// each other rather than exercise the limiter they care about.
		const app = makeApp();

		for (let i = 0; i <= AUTH_LIMIT; i++) {
			const res = await app.request("/test", {}, env);
			expect(res.status).toBe(200);
		}
	});

	it("collapses unidentifiable callers into one bucket outside dev", async () => {
		// Beyond dev the edge always stamps an address, so a request without one
		// skipped the edge. Those share a bucket deliberately — the alternative is
		// an unmetered path around the limiter.
		const app = makeApp();
		const production: Env = { ...env, CLOUDFLARE_ENV: "production" };

		for (let i = 0; i < AUTH_LIMIT; i++) {
			expect((await app.request("/test", {}, production)).status).toBe(200);
		}

		expect((await app.request("/test", {}, production)).status).toBe(429);
	});

	it("meters each client address independently", async () => {
		const app = makeApp();
		const exhausted = "203.0.113.2";

		for (let i = 0; i <= AUTH_LIMIT; i++) {
			await req(app, exhausted);
		}
		expect((await req(app, exhausted)).status).toBe(429);

		expect((await req(app, "203.0.113.3")).status).toBe(200);
	});

	it("falls back to x-forwarded-for when cf-connecting-ip is absent", async () => {
		const app = makeApp();
		const forwarded = (ip: string) =>
			app.request("/test", { headers: { "x-forwarded-for": ip } }, env);

		for (let i = 0; i < AUTH_LIMIT; i++) {
			expect((await forwarded("203.0.113.4")).status).toBe(200);
		}

		expect((await forwarded("203.0.113.4")).status).toBe(429);
		expect((await forwarded("203.0.113.5")).status).toBe(200);
	});

	it("tells a rejected caller when to retry, in seconds", async () => {
		const app = makeApp();
		const ip = "203.0.113.6";

		for (let i = 0; i <= AUTH_LIMIT; i++) {
			await req(app, ip);
		}
		const res = await req(app, ip);

		expect(res.status).toBe(429);
		expect(res.headers.get("Retry-After")).toBe("60");
	});
});
