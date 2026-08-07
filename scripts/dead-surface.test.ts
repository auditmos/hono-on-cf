import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");

function read(relPath: string): string {
	return readFileSync(join(ROOT, relPath), "utf8");
}

describe("no dead scheduled-handler surface", () => {
	it("the scheduled/ directory no longer exists", () => {
		expect(existsSync(join(ROOT, "apps/data-service/src/scheduled"))).toBe(false);
	});

	it("the entrypoint declares no scheduled export", () => {
		const entrypoint = read("apps/data-service/src/index.ts");
		expect(entrypoint).not.toMatch(/scheduled/i);
	});

	it("wrangler.jsonc declares no cron trigger", () => {
		const config = read("apps/data-service/wrangler.jsonc");
		expect(config).not.toMatch(/crons|triggers/i);
	});
});

describe("knip exclusions reference only paths that exist", () => {
	const knipConfig = JSON.parse(read("knip.json"));

	it("every ignore glob resolves to a real directory", () => {
		for (const [workspace, config] of Object.entries(knipConfig.workspaces ?? {})) {
			for (const pattern of (config as { ignore?: string[] }).ignore ?? []) {
				const base = pattern.replace(/\/?\*+$/, "");
				const candidate = join(ROOT, workspace, base);
				expect(
					existsSync(candidate),
					`${workspace}: ignore pattern "${pattern}" (${candidate})`,
				).toBe(true);
			}
		}
	});
});

describe("no JSX configuration in the data-service Worker", () => {
	it("tsconfig.json declares no jsx option", () => {
		const tsconfig = read("apps/data-service/tsconfig.json");
		expect(tsconfig).not.toMatch(/"jsx"/);
	});
});

describe("no empty submodule file", () => {
	it(".gitmodules is gone", () => {
		expect(existsSync(join(ROOT, ".gitmodules"))).toBe(false);
	});
});

describe("pinned Node version", () => {
	it(".nvmrc pins a specific Node major", () => {
		const nvmrc = read(".nvmrc").trim();
		expect(nvmrc).toMatch(/^\d+/);
	});

	it("every workflow's setup-node step reads the pinned version, none float on lts/*", () => {
		for (const workflow of ["checks.yml", "release.yml", "deps-update.yml", "compat-date.yml"]) {
			const content = read(`.github/workflows/${workflow}`);
			expect(content, `${workflow} should not float on lts/*`).not.toContain("node-version: lts/*");
			expect(content, `${workflow} should read the pinned .nvmrc`).toContain(
				"node-version-file: .nvmrc",
			);
		}
	});
});

describe("declared license metadata matches the shipped LICENSE file", () => {
	const licenseFile = read("LICENSE");
	const isMit = /^MIT License/.test(licenseFile);

	it("the shipped LICENSE file is MIT", () => {
		expect(isMit).toBe(true);
	});

	it("every package.json declares the same license", () => {
		for (const pkg of [
			"package.json",
			"apps/data-service/package.json",
			"packages/data-ops/package.json",
		]) {
			const { license } = JSON.parse(read(pkg));
			expect(license, `${pkg} license field`).toBe("MIT");
		}
	});
});
