const mockAuthHandler = vi.fn();

vi.mock("@repo/data-ops/auth/server", () => ({
	getAuth: () => ({ handler: mockAuthHandler }),
}));

const mockEnv = { CLOUDFLARE_ENV: "dev" } as unknown as Env;

describe("App middleware wiring", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockAuthHandler.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
	});

	it("rate limits /api/auth/* after 20 requests from same IP", async () => {
		const { App } = await import("./app");

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
				mockEnv,
			);

		for (let i = 0; i < 20; i++) {
			await authReq();
		}
		const res = await authReq();

		expect(res.status).toBe(429);
	});

	it("does not rate limit non-auth endpoints", async () => {
		const { App } = await import("./app");

		for (let i = 0; i < 21; i++) {
			const res = await App.request(
				"/health/live",
				{ headers: { "cf-connecting-ip": "30.0.0.2" } },
				mockEnv,
			);
			expect(res.status).toBe(200);
		}
	});
});
