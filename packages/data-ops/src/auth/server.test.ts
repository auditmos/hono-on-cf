vi.mock("better-auth", () => ({
	betterAuth: vi.fn((config: unknown) => ({ _config: config, _id: Math.random() })),
}));

vi.mock("better-auth/adapters/drizzle", () => ({
	drizzleAdapter: vi.fn((_db: unknown, opts: unknown) => ({
		_adapter: true,
		...(opts as Record<string, unknown>),
	})),
}));

const fakeDb = {} as ReturnType<typeof import("@/database/setup").getDb>;

function makeConfig() {
	return {
		secret: "test-secret",
		baseURL: "http://localhost",
		adapter: {
			drizzleDb: fakeDb,
			provider: "pg" as const,
		},
	};
}

describe("auth server", () => {
	beforeEach(() => {
		vi.resetModules();
	});

	it("getAuth throws when auth not initialized", async () => {
		const { getAuth } = await import("./server");
		expect(() => getAuth()).toThrow("Auth not initialized");
	});

	it("setAuth creates and returns auth instance", async () => {
		const { setAuth, getAuth } = await import("./server");
		const auth = setAuth(makeConfig());
		expect(auth).toBeDefined();
		expect(getAuth()).toBe(auth);
	});

	it("second setAuth returns same cached instance", async () => {
		const { setAuth } = await import("./server");
		const first = setAuth(makeConfig());
		const second = setAuth(makeConfig());
		expect(second).toBe(first);
	});
});
