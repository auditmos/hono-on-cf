import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const WORKSPACE_DIRS = ["apps", "packages"] as const;

interface PackageJson {
	name?: string;
	packageManager?: string;
}

function readPackageJson(relDir: string): PackageJson {
	return JSON.parse(readFileSync(join(ROOT, relDir, "package.json"), "utf8")) as PackageJson;
}

function workspacePackageDirs(): string[] {
	return WORKSPACE_DIRS.flatMap((dir) =>
		readdirSync(join(ROOT, dir), { withFileTypes: true })
			.filter(
				(entry) => entry.isDirectory() && existsSync(join(ROOT, dir, entry.name, "package.json")),
			)
			.map((entry) => `${dir}/${entry.name}`),
	);
}

/**
 * CI's pnpm/action-setup reads the root `packageManager` pin. A different pin
 * in a subpackage makes corepack run another pnpm major inside that directory,
 * which reads workspace settings (e.g. `allowBuilds`) differently.
 */
describe("package manager pin", () => {
	const rootPin = readPackageJson(".").packageManager;

	it("is pinned to an exact pnpm version at the root", () => {
		expect(rootPin).toMatch(/^pnpm@\d+\.\d+\.\d+$/);
	});

	it.each(workspacePackageDirs())("%s declares no pin or the root one", (dir) => {
		const pin = readPackageJson(dir).packageManager;
		if (pin !== undefined) expect(pin).toBe(rootPin);
	});
});
