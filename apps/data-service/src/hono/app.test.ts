const mockAuthHandler = vi.fn();

vi.mock("@repo/data-ops/auth/server", () => ({
	getAuth: () => ({ handler: mockAuthHandler }),
}));

const makeRateLimitBinding = (maxRequests: number, windowMs = 60_000): RateLimit => {
	const counts = new Map<string, { count: number; resetAt: number }>();
	return {
		limit: async ({ key }) => {
			const now = Date.now();
			const record = counts.get(key);
			if (!record || now > record.resetAt) {
				counts.set(key, { count: 1, resetAt: now + windowMs });
				return { success: true };
			}
			if (record.count >= maxRequests) return { success: false };
			record.count++;
			return { success: true };
		},
	};
};

const makeEnv = (): Env =>
	({
		CLOUDFLARE_ENV: "dev",
		RATE_LIMIT_AUTH: makeRateLimitBinding(20),
		RATE_LIMIT_HEALTH: makeRateLimitBinding(10),
	}) as unknown as Env;

describe("App middleware wiring", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockAuthHandler.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
	});

	it("rate limits /api/auth/* after 20 requests from same IP", async () => {
		const { App } = await import("./app");
		const env = makeEnv();

		const authReq = () =>
			App.request(
				"/api/auth/sign-in/email",
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"cf-connecting-ip": "30.0.0.1",
					},
					body: JSON.stringify({ email: "a@example.com", password: "pass" }),
				},
				env,
			);

		for (let i = 0; i < 20; i++) {
			await authReq();
		}
		const res = await authReq();

		expect(res.status).toBe(429);
	});

	it("does not rate limit non-auth endpoints", async () => {
		const { App } = await import("./app");
		const env = makeEnv();

		for (let i = 0; i < 21; i++) {
			const res = await App.request(
				"/health/live",
				{ headers: { "cf-connecting-ip": "30.0.0.2" } },
				env,
			);
			expect(res.status).toBe(200);
		}
	});
});
