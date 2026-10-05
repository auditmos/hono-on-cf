import { defineProject } from "vitest/config";

export default defineProject({
	test: {
		globals: true,
		include: ["src/**/*.test.ts", "config/**/*.test.ts"],
		exclude: ["src/drizzle/migrations/**"],
	},
});
