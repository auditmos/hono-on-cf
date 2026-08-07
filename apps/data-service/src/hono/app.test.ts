import { env } from "cloudflare:workers";
import { App } from "./app";

// wrangler.jsonc, dev environment: RATE_LIMIT_AUTH is 20 requests per 60s.
const AUTH_LIMIT = 20;

// Auth is never initialized here, so the handler behind the limiter fails with a
// 500. That is the point: these assertions are about which middleware the route
// is wired to, and a 500 proves the request reached the handler rather than
// being turned away by the limiter.
const signIn = (ip: string) =>
	App.request(
		"/api/auth/sign-in/email",
		{
			method: "POST",
			headers: { "Content-Type": "application/json", "cf-connecting-ip": ip },
			body: JSON.stringify({ email: "a@example.com", password: "pass" }),
		},
		env,
	);

describe("App middleware wiring", () => {
	it("rate limits /api/auth/* once the configured limit is exceeded", async () => {
		const ip = "198.51.100.1";

		for (let i = 0; i < AUTH_LIMIT; i++) {
			expect((await signIn(ip)).status).not.toBe(429);
		}

		const res = await signIn(ip);

		expect(res.status).toBe(429);
		expect(res.headers.get("Retry-After")).toBe("60");
	});

	it("leaves the liveness probe unmetered", async () => {
		const ip = "198.51.100.2";

		for (let i = 0; i <= AUTH_LIMIT; i++) {
			const res = await App.request("/health/live", { headers: { "cf-connecting-ip": ip } }, env);
			expect(res.status).toBe(200);
		}
	});
});
