import { betterAuth } from "better-auth";
import { createBetterAuth } from "./setup";

vi.mock("better-auth", () => ({
	betterAuth: vi.fn(() => ({ _mock: true })),
}));

vi.mock("better-auth/plugins", () => ({
	bearer: vi.fn(() => ({ id: "bearer" })),
}));

describe("createBetterAuth", () => {
	it("includes bearer plugin", () => {
		createBetterAuth({
			database: {} as never,
			secret: "test",
			baseURL: "http://localhost",
		});

		const config = vi.mocked(betterAuth).mock.calls[0]?.[0];
		expect(config).toBeDefined();
		const bearerPlugin = config?.plugins?.find(
			(p: { id: string }) => p.id === "bearer",
		);
		expect(bearerPlugin).toBeDefined();
	});
});
