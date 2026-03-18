import { Hono } from "hono";

const mockGetSession = vi.fn();

vi.mock("@repo/data-ops/auth/server", () => ({
	getAuth: () => ({
		api: {
			getSession: mockGetSession,
		},
	}),
}));

describe("requireAuth", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns 401 when no Authorization header is present", async () => {
		const { requireAuth } = await import("./require-auth");
		const app = new Hono();
		app.use("/*", requireAuth());
		app.get("/protected", (c) => c.json({ ok: true }));

		mockGetSession.mockResolvedValueOnce(null);

		const res = await app.request("/protected");

		expect(res.status).toBe(401);
	});

	it("returns 401 when token is invalid/unknown", async () => {
		const { requireAuth } = await import("./require-auth");
		const app = new Hono();
		app.use("/*", requireAuth());
		app.get("/protected", (c) => c.json({ ok: true }));

		mockGetSession.mockResolvedValueOnce(null);

		const res = await app.request("/protected", {
			headers: { Authorization: "Bearer invalid-token" },
		});

		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body).toEqual({ error: "Unauthorized" });
	});

	it("returns 403 when user is not approved", async () => {
		const { requireAuth } = await import("./require-auth");
		const app = new Hono();
		app.use("/*", requireAuth());
		app.get("/protected", (c) => c.json({ ok: true }));

		mockGetSession.mockResolvedValueOnce({
			session: { id: "sess-1", userId: "user-1", token: "tok" },
			user: {
				id: "user-1",
				email: "test@example.com",
				name: "Test",
				approved: false,
			},
		});

		const res = await app.request("/protected", {
			headers: { Authorization: "Bearer valid-token" },
		});

		expect(res.status).toBe(403);
		const body = await res.json();
		expect(body).toEqual({ error: "Account not approved" });
	});

	it("passes through and sets session on context when user is approved", async () => {
		const { requireAuth } = await import("./require-auth");
		const app = new Hono();
		app.use("/*", requireAuth());

		const sessionData = {
			session: { id: "sess-1", userId: "user-1", token: "tok" },
			user: {
				id: "user-1",
				email: "test@example.com",
				name: "Test User",
				approved: true,
			},
		};
		mockGetSession.mockResolvedValueOnce(sessionData);

		let capturedSession: unknown;
		app.get("/protected", (c) => {
			capturedSession = c.get("session");
			return c.json({ ok: true });
		});

		const res = await app.request("/protected", {
			headers: { Authorization: "Bearer valid-token" },
		});

		expect(res.status).toBe(200);
		expect(capturedSession).toEqual(sessionData);
	});
});
