import { betterAuth } from "better-auth";
import { createBetterAuth } from "./setup";

vi.mock("better-auth", () => ({
	betterAuth: vi.fn(() => ({ _mock: true })),
}));

vi.mock("better-auth/plugins", () => ({
	bearer: vi.fn(() => ({ id: "bearer" })),
}));

const RFC_COOKIE_MAX_AGE = 60 * 60 * 24 * 400; // 34560000s — better-call hard limit

describe("createBetterAuth", () => {
	it("includes bearer plugin", () => {
		createBetterAuth({
			database: {} as never,
			secret: "test",
			baseURL: "http://localhost",
		});

		const config = vi.mocked(betterAuth).mock.calls[0]?.[0];
		expect(config).toBeDefined();
		const bearerPlugin = config?.plugins?.find((p: { id: string }) => p.id === "bearer");
		expect(bearerPlugin).toBeDefined();
	});

	it("sets expiresIn within RFC cookie Max-Age limit (≤400 days)", () => {
		createBetterAuth({
			database: {} as never,
			secret: "test",
			baseURL: "http://localhost",
		});

		const config = vi.mocked(betterAuth).mock.calls[0]?.[0];
		expect(config?.session?.expiresIn).toBeLessThanOrEqual(RFC_COOKIE_MAX_AGE);
	});

	it("sets updateAge to refresh sessions daily", () => {
		createBetterAuth({
			database: {} as never,
			secret: "test",
			baseURL: "http://localhost",
		});

		const config = vi.mocked(betterAuth).mock.calls[0]?.[0];
		expect(config?.session?.updateAge).toBe(60 * 60 * 24);
	});
});
