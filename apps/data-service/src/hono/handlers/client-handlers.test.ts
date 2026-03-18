import { Hono } from "hono";

const mockGetSession = vi.fn();
const mockGetClients = vi.fn();
const mockGetClientById = vi.fn();
const mockCreateClient = vi.fn();
const mockUpdateClient = vi.fn();
const mockDeleteClient = vi.fn();

vi.mock("@repo/data-ops/auth/server", () => ({
	getAuth: () => ({
		api: { getSession: mockGetSession },
	}),
}));

vi.mock("../services/client-service", () => ({
	getClients: mockGetClients,
	getClientById: mockGetClientById,
	createClient: mockCreateClient,
	updateClient: mockUpdateClient,
	deleteClient: mockDeleteClient,
}));

const APPROVED_SESSION = {
	session: { id: "sess-1", userId: "user-1", token: "tok" },
	user: { id: "user-1", email: "a@example.com", name: "A", approved: true },
};

const UNAPPROVED_SESSION = {
	session: { id: "sess-2", userId: "user-2", token: "tok2" },
	user: { id: "user-2", email: "b@example.com", name: "B", approved: false },
};

const VALID_UUID = "00000000-0000-0000-0000-000000000001";

describe("client handlers", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("GET / returns 200 without auth", async () => {
		const { default: clients } = await import("./client-handlers");
		const app = new Hono().route("/clients", clients);

		mockGetClients.mockResolvedValueOnce({
			ok: true,
			data: { items: [], meta: { total: 0, limit: 10, offset: 0, hasMore: false } },
		});

		const res = await app.request("/clients");

		expect(res.status).toBe(200);
	});

	it("GET /:id returns 401 without auth", async () => {
		const { default: clients } = await import("./client-handlers");
		const app = new Hono().route("/clients", clients);

		mockGetSession.mockResolvedValueOnce(null);

		const res = await app.request(`/clients/${VALID_UUID}`);

		expect(res.status).toBe(401);
	});

	it("POST / returns 401 without auth", async () => {
		const { default: clients } = await import("./client-handlers");
		const app = new Hono().route("/clients", clients);

		mockGetSession.mockResolvedValueOnce(null);

		const res = await app.request("/clients", { method: "POST" });

		expect(res.status).toBe(401);
	});

	it("POST / returns 403 with unapproved user", async () => {
		const { default: clients } = await import("./client-handlers");
		const app = new Hono().route("/clients", clients);

		mockGetSession.mockResolvedValueOnce(UNAPPROVED_SESSION);

		const res = await app.request("/clients", {
			method: "POST",
			headers: { Authorization: "Bearer tok2", "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Test", surname: "User", email: "t@example.com" }),
		});

		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: "Account not approved" });
	});

	it("POST / returns 201 with approved user and valid body", async () => {
		const { default: clients } = await import("./client-handlers");
		const app = new Hono().route("/clients", clients);

		mockGetSession.mockResolvedValueOnce(APPROVED_SESSION);
		mockCreateClient.mockResolvedValueOnce({
			ok: true,
			data: { id: VALID_UUID, name: "Test", surname: "User", email: "t@example.com" },
		});

		const res = await app.request("/clients", {
			method: "POST",
			headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Test", surname: "User", email: "t@example.com" }),
		});

		expect(res.status).toBe(201);
	});

	it("PUT /:id returns 401 without auth", async () => {
		const { default: clients } = await import("./client-handlers");
		const app = new Hono().route("/clients", clients);

		mockGetSession.mockResolvedValueOnce(null);

		const res = await app.request(`/clients/${VALID_UUID}`, { method: "PUT" });

		expect(res.status).toBe(401);
	});

	it("DELETE /:id returns 401 without auth", async () => {
		const { default: clients } = await import("./client-handlers");
		const app = new Hono().route("/clients", clients);

		mockGetSession.mockResolvedValueOnce(null);

		const res = await app.request(`/clients/${VALID_UUID}`, { method: "DELETE" });

		expect(res.status).toBe(401);
	});
});
