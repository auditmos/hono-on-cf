import { Hono } from "hono";
import { rateLimiter } from "./rate-limiter";

const makeApp = (maxRequests: number) => {
	const app = new Hono();
	app.use("/*", rateLimiter({ windowMs: 60_000, maxRequests }));
	app.get("/test", (c) => c.json({ ok: true }));
	return app;
};

const req = (app: Hono, ip: string) =>
	app.request("/test", { headers: { "cf-connecting-ip": ip } });

describe("rateLimiter", () => {
	it("returns 429 on request exceeding maxRequests from same IP", async () => {
		const app = makeApp(2);

		await req(app, "10.0.0.1");
		await req(app, "10.0.0.1");
		const res = await req(app, "10.0.0.1");

		expect(res.status).toBe(429);
		expect(await res.json()).toEqual({ error: "Too many requests" });
	});

	it("allows requests under the limit", async () => {
		const app = makeApp(3);

		const r1 = await req(app, "10.0.0.2");
		const r2 = await req(app, "10.0.0.2");
		const r3 = await req(app, "10.0.0.2");

		expect(r1.status).toBe(200);
		expect(r2.status).toBe(200);
		expect(r3.status).toBe(200);
	});

	it("different IPs are rate-limited independently", async () => {
		const app = makeApp(2);

		await req(app, "10.0.0.3");
		await req(app, "10.0.0.3");

		const res = await req(app, "10.0.0.4");

		expect(res.status).toBe(200);
	});

	it("resets after window expires", async () => {
		vi.useFakeTimers();
		const app = makeApp(2);

		await req(app, "10.0.0.5");
		await req(app, "10.0.0.5");

		vi.advanceTimersByTime(61_000);

		const res = await req(app, "10.0.0.5");
		expect(res.status).toBe(200);

		vi.useRealTimers();
	});
});
