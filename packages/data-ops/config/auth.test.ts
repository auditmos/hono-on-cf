describe("better-auth CLI config", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.stubEnv("DATABASE_HOST", "h");
		vi.stubEnv("DATABASE_USERNAME", "u");
		vi.stubEnv("DATABASE_PASSWORD", "p");
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it.each([
		"DATABASE_HOST",
		"DATABASE_USERNAME",
		"DATABASE_PASSWORD",
	])("rejects with MissingDatabaseEnvError when %s is unset", async (name) => {
		vi.stubEnv(name, "");

		await expect(import("./auth")).rejects.toMatchObject({
			name: "MissingDatabaseEnvError",
			message: "Missing required DATABASE_* environment variables",
		});
	});
});
