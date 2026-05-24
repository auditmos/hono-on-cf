import { Hono } from "hono";
import { rateLimiter } from "./rate-limiter";

type LimitFn = (opts: { key: string }) => Promise<{ success: boolean }>;
type StubEnv = { RATE_LIMIT_AUTH: { limit: LimitFn } };

const makeBinding = (maxRequests: number, windowMs = 60_000) => {
	const counts = new Map<string, { count: number; resetAt: number }>();
	const limit: LimitFn = async ({ key }) => {
		const now = Date.now();
		const record = counts.get(key);
		if (!record || now > record.resetAt) {
			counts.set(key, { count: 1, resetAt: now + windowMs });
			return { success: true };
		}
		if (record.count >= maxRequests) return { success: false };
		record.count++;
		return { success: true };
	};
	return { limit };
};

const makeApp = (mw: ReturnType<typeof rateLimiter>) => {
	const app = new Hono<{ Bindings: StubEnv }>();
	app.use("/*", mw);
	app.get("/test", (c) => c.json({ ok: true }));
	return app;
};

const req = (app: Hono<{ Bindings: StubEnv }>, env: StubEnv, ip: string) =>
	app.request("/test", { headers: { "cf-connecting-ip": ip } }, env);

describe("rateLimiter", () => {
	it("returns 429 when the binding reports the request was over-limit", async () => {
		const env: StubEnv = { RATE_LIMIT_AUTH: makeBinding(2) };
		const app = makeApp(rateLimiter("RATE_LIMIT_AUTH", { windowSeconds: 60 }));

		await req(app, env, "10.0.0.1");
		await req(app, env, "10.0.0.1");
		const res = await req(app, env, "10.0.0.1");

		expect(res.status).toBe(429);
		expect(await res.json()).toEqual({ error: "Too many requests" });
	});

	it("allows requests the binding accepts", async () => {
		const env: StubEnv = { RATE_LIMIT_AUTH: makeBinding(3) };
		const app = makeApp(rateLimiter("RATE_LIMIT_AUTH", { windowSeconds: 60 }));

		const r1 = await req(app, env, "10.0.0.2");
		const r2 = await req(app, env, "10.0.0.2");
		const r3 = await req(app, env, "10.0.0.2");

		expect(r1.status).toBe(200);
		expect(r2.status).toBe(200);
		expect(r3.status).toBe(200);
	});

	it("different IPs are rate-limited independently", async () => {
		const env: StubEnv = { RATE_LIMIT_AUTH: makeBinding(2) };
		const app = makeApp(rateLimiter("RATE_LIMIT_AUTH", { windowSeconds: 60 }));

		await req(app, env, "10.0.0.3");
		await req(app, env, "10.0.0.3");

		const res = await req(app, env, "10.0.0.4");

		expect(res.status).toBe(200);
	});

	it("resets after window expires", async () => {
		vi.useFakeTimers();
		const env: StubEnv = { RATE_LIMIT_AUTH: makeBinding(2) };
		const app = makeApp(rateLimiter("RATE_LIMIT_AUTH", { windowSeconds: 60 }));

		await req(app, env, "10.0.0.5");
		await req(app, env, "10.0.0.5");

		vi.advanceTimersByTime(61_000);

		const res = await req(app, env, "10.0.0.5");
		expect(res.status).toBe(200);

		vi.useRealTimers();
	});

	it("calls the binding with the connecting IP as the key", async () => {
		const limit = vi.fn<LimitFn>(async () => ({ success: true }));
		const env: StubEnv = { RATE_LIMIT_AUTH: { limit } };
		const app = makeApp(rateLimiter("RATE_LIMIT_AUTH", { windowSeconds: 60 }));

		await req(app, env, "10.0.0.6");

		expect(limit).toHaveBeenCalledWith({ key: "10.0.0.6" });
	});

	it("sets Retry-After header on 429 with seconds matching the configured window", async () => {
		const windowSeconds = 45;
		const env: StubEnv = { RATE_LIMIT_AUTH: makeBinding(1, windowSeconds * 1000) };
		const app = makeApp(rateLimiter("RATE_LIMIT_AUTH", { windowSeconds }));

		await req(app, env, "10.0.0.8");
		const res = await req(app, env, "10.0.0.8");

		expect(res.status).toBe(429);
		const retryAfter = res.headers.get("Retry-After");
		expect(retryAfter).not.toBeNull();
		const parsed = Number(retryAfter);
		expect(Number.isInteger(parsed)).toBe(true);
		expect(parsed).toBeGreaterThan(0);
		expect(parsed).toBeLessThanOrEqual(windowSeconds);
	});

	it("survives module-cache eviction (state lives on the env binding, not the module)", async () => {
		// Same env crosses the "isolate restart" boundary. State on env survives;
		// module-level state would be wiped by resetModules and let the bucket reset.
		const env: StubEnv = { RATE_LIMIT_AUTH: makeBinding(2) };

		const first = await import("./rate-limiter");
		const app1 = makeApp(first.rateLimiter("RATE_LIMIT_AUTH", { windowSeconds: 60 }));
		await req(app1, env, "10.0.0.7");
		await req(app1, env, "10.0.0.7");

		vi.resetModules();

		const second = await import("./rate-limiter");
		const app2 = makeApp(second.rateLimiter("RATE_LIMIT_AUTH", { windowSeconds: 60 }));
		const res = await req(app2, env, "10.0.0.7");

		expect(res.status).toBe(429);
	});
});
