import { resolve } from "node:path";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineProject } from "vitest/config";

// The Worker suite runs inside workerd, not Node, so tests reach the same
// bindings the deployed Worker does — the rate limiter is enforced by the
// platform rather than by a stub returning whatever a test author chose.
// Bindings come from wrangler.jsonc's dev environment; everything runs locally,
// with no credentials, no network and no container runtime.
export default defineProject({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: "./wrangler.jsonc", environment: "dev" },
		}),
	],
	resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
	test: {
		globals: true,
		include: ["src/**/*.test.ts"],
	},
});
