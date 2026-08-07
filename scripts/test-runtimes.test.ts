import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");

function read(relPath: string): string {
	return readFileSync(join(ROOT, relPath), "utf8");
}

const WORKERS_POOL = "@cloudflare/vitest-pool-workers";

/**
 * The Worker suite runs in workerd so it reaches real bindings; the data-layer
 * suite stays in Node because it has none to reach and workerd would only cost
 * startup time. Both are reachable from one command. That split is a decision,
 * not an accident, so it is asserted rather than left to whoever edits a config
 * next.
 */
describe("test runtimes", () => {
	it("runs the Worker suite in workerd", () => {
		const config = read("apps/data-service/vitest.config.mts");

		expect(config).toContain(WORKERS_POOL);
		expect(config).toMatch(/cloudflareTest\(/);
		// Bindings must come from the committed Worker config, so the limits the
		// suite asserts against are the limits that ship.
		expect(config).toMatch(/configPath:\s*"\.\/wrangler\.jsonc"/);
	});

	it("keeps the data-layer suite in Node", () => {
		expect(read("packages/data-ops/vitest.config.ts")).not.toContain(WORKERS_POOL);
	});

	it("reaches both suites from the single test command", () => {
		const projects = read("vitest.config.ts");

		expect(projects).toContain('"apps/data-service"');
		expect(projects).toContain('"packages/data-ops"');

		const scripts = JSON.parse(read("package.json")).scripts as Record<string, string>;
		expect(scripts.test).toBe("vitest run");
	});
});
