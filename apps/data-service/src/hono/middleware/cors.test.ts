import { assertCorsConfig } from "./cors";

const env = (overrides: Partial<Env>): Env => overrides as Env;

describe("assertCorsConfig", () => {
	it("throws when CLOUDFLARE_ENV is staging and ALLOWED_ORIGINS is missing", () => {
		expect(() => assertCorsConfig(env({ CLOUDFLARE_ENV: "staging" }))).toThrow(/ALLOWED_ORIGINS/);
	});

	it("throws when CLOUDFLARE_ENV is production and ALLOWED_ORIGINS is missing", () => {
		expect(() => assertCorsConfig(env({ CLOUDFLARE_ENV: "production" }))).toThrow(
			/ALLOWED_ORIGINS/,
		);
	});

	it("throws when ALLOWED_ORIGINS is whitespace-only in non-dev", () => {
		expect(() =>
			assertCorsConfig(env({ CLOUDFLARE_ENV: "staging", ALLOWED_ORIGINS: "   " })),
		).toThrow(/ALLOWED_ORIGINS/);
	});

	it("does not throw when ALLOWED_ORIGINS is set in non-dev", () => {
		expect(() =>
			assertCorsConfig(
				env({ CLOUDFLARE_ENV: "production", ALLOWED_ORIGINS: "https://app.example.com" }),
			),
		).not.toThrow();
	});

	it("does not throw in dev regardless of ALLOWED_ORIGINS", () => {
		expect(() => assertCorsConfig(env({ CLOUDFLARE_ENV: "dev" }))).not.toThrow();
	});
});
