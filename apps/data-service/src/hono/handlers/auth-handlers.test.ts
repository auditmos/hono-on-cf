import { Hono } from "hono";

const mockHandler = vi.fn();

vi.mock("@repo/data-ops/auth/server", () => ({
	getAuth: () => ({
		handler: mockHandler,
	}),
}));

describe("auth handlers", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("delegates POST /api/auth/sign-up/email to Better Auth handler", async () => {
		const { default: auth } = await import("./auth-handlers");
		const app = new Hono().route("/api/auth", auth);

		mockHandler.mockResolvedValueOnce(
			new Response(JSON.stringify({ user: { id: "1" } }), { status: 200 }),
		);

		const res = await app.request("/api/auth/sign-up/email", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				email: "test@example.com",
				password: "password123",
				name: "Test",
			}),
		});

		expect(res.status).toBe(200);
		expect(mockHandler).toHaveBeenCalledOnce();
		const passedRequest = mockHandler.mock.calls[0]?.[0];
		expect(passedRequest).toBeInstanceOf(Request);
		expect(passedRequest.url).toContain("/api/auth/sign-up/email");
	});

	it("delegates POST /api/auth/sign-in/email to Better Auth handler", async () => {
		const { default: auth } = await import("./auth-handlers");
		const app = new Hono().route("/api/auth", auth);

		mockHandler.mockResolvedValueOnce(
			new Response(JSON.stringify({ session: { token: "abc" } }), {
				status: 200,
			}),
		);

		const res = await app.request("/api/auth/sign-in/email", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				email: "test@example.com",
				password: "password123",
			}),
		});

		expect(res.status).toBe(200);
		expect(mockHandler).toHaveBeenCalledOnce();
		const passedRequest = mockHandler.mock.calls[0]?.[0];
		expect(passedRequest).toBeInstanceOf(Request);
		expect(passedRequest.url).toContain("/api/auth/sign-in/email");
	});

	it("delegates GET /api/auth/get-session with bearer token to Better Auth handler", async () => {
		const { default: auth } = await import("./auth-handlers");
		const app = new Hono().route("/api/auth", auth);

		mockHandler.mockResolvedValueOnce(
			new Response(JSON.stringify({ session: { userId: "1" } }), {
				status: 200,
			}),
		);

		const res = await app.request("/api/auth/get-session", {
			method: "GET",
			headers: { Authorization: "Bearer test-token-123" },
		});

		expect(res.status).toBe(200);
		expect(mockHandler).toHaveBeenCalledOnce();
		const passedRequest = mockHandler.mock.calls[0]?.[0];
		expect(passedRequest).toBeInstanceOf(Request);
		expect(passedRequest.url).toContain("/api/auth/get-session");
		expect(passedRequest.headers.get("Authorization")).toBe("Bearer test-token-123");
	});

	it("preserves Better Auth error responses", async () => {
		const { default: auth } = await import("./auth-handlers");
		const app = new Hono().route("/api/auth", auth);

		mockHandler.mockResolvedValueOnce(
			new Response(JSON.stringify({ error: "Invalid credentials" }), {
				status: 401,
			}),
		);

		const res = await app.request("/api/auth/sign-in/email", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				email: "bad@example.com",
				password: "wrong",
			}),
		});

		expect(res.status).toBe(401);
	});
});
