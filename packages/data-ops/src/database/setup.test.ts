import { drizzle } from "drizzle-orm/neon-http";

vi.mock("drizzle-orm/neon-http", () => ({
	drizzle: vi.fn(() => ({ _mock: true })),
}));

describe("initDatabase", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.mocked(drizzle).mockClear();
	});

	it("URL-encodes username and password so reserved characters survive into the connection string", async () => {
		const { initDatabase } = await import("./setup");

		const host = "ep-foo.us-east-2.aws.neon.tech/neondb?sslmode=require";
		const username = "user:name@dev";
		const password = "p@ss:wo%rd";

		initDatabase({ host, username, password });

		const connectionString = vi.mocked(drizzle).mock.calls[0]?.[0];
		expect(typeof connectionString).toBe("string");

		const url = new URL(connectionString as string);
		expect(url.protocol).toBe("postgres:");
		expect(decodeURIComponent(url.username)).toBe(username);
		expect(decodeURIComponent(url.password)).toBe(password);
	});

	it("leaves host untouched (path and query already URL-shaped)", async () => {
		const { initDatabase } = await import("./setup");

		const host = "ep-foo.us-east-2.aws.neon.tech/neondb?sslmode=require";
		initDatabase({ host, username: "u", password: "p" });

		const connectionString = vi.mocked(drizzle).mock.calls[0]?.[0] as string;
		expect(connectionString).toContain(host);
	});

	it("passes schema (auth tables + relations) to drizzle so db.query.* is available", async () => {
		const { initDatabase } = await import("./setup");

		initDatabase({ host: "h", username: "u", password: "p" });

		const options = vi.mocked(drizzle).mock.calls[0]?.[1] as { schema?: Record<string, unknown> };
		expect(options).toBeDefined();
		expect(options.schema).toBeDefined();
		const schema = options.schema as Record<string, unknown>;
		expect(schema.auth_user).toBeDefined();
		expect(schema.auth_session).toBeDefined();
		expect(schema.userRelations).toBeDefined();
		expect(schema.sessionRelations).toBeDefined();
	});
});
