import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const DATA_OPS = join(ROOT, "packages/data-ops");
const DATA_SERVICE = join(ROOT, "apps/data-service");

function read(relPath: string): string {
	return readFileSync(join(ROOT, relPath), "utf8");
}

function readJsonc<T>(relPath: string): T {
	// tsconfig/wrangler configs carry comments, so parse them the way tsc does.
	const { config, error } = ts.parseConfigFileTextToJson(relPath, read(relPath));
	if (error)
		throw new Error(`${relPath}: ${ts.flattenDiagnosticMessageText(error.messageText, " ")}`);
	return config as T;
}

function collectTsFiles(dir: string, acc: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "node_modules" || entry.name === "migrations") continue;
			collectTsFiles(full, acc);
		} else if (entry.name.endsWith(".ts")) {
			acc.push(full);
		}
	}
	return acc;
}

type PackageJson = {
	exports?: Record<string, string | Record<string, string>>;
	scripts?: Record<string, string>;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
};

type TsConfig = {
	compilerOptions?: {
		paths?: Record<string, string[]>;
		outDir?: string;
		declaration?: boolean;
		noEmit?: boolean;
		types?: string[];
	};
};

const dataOpsPkg = readJsonc<PackageJson>("packages/data-ops/package.json");
const dataOpsTsconfig = readJsonc<TsConfig>("packages/data-ops/tsconfig.json");
const dataServiceTsconfig = readJsonc<TsConfig>("apps/data-service/tsconfig.json");
const rootPkg = readJsonc<PackageJson>("package.json");

describe("the shared package resolves from source", () => {
	it("points every export entry at TypeScript source under src/", () => {
		const targets = Object.values(dataOpsPkg.exports ?? {}).flatMap((entry) =>
			typeof entry === "string" ? [entry] : Object.values(entry),
		);
		expect(targets.length).toBeGreaterThan(0);
		for (const target of targets) {
			expect(target, `export target "${target}" should resolve to src/*.ts`).toMatch(
				/^\.\/src\/.+\.ts$/,
			);
		}
	});

	it("declares no build script", () => {
		expect(dataOpsPkg.scripts?.build).toBeUndefined();
	});

	it("depends on no alias-rewriting tool", () => {
		expect(JSON.stringify(dataOpsPkg)).not.toContain("tsc-alias");
	});

	it("has no compiled output directory", () => {
		expect(existsSync(join(DATA_OPS, "dist"))).toBe(false);
	});

	it("emits nothing from its own TypeScript configuration", () => {
		expect(dataOpsTsconfig.compilerOptions?.noEmit).toBe(true);
		expect(dataOpsTsconfig.compilerOptions?.outDir).toBeUndefined();
		expect(dataOpsTsconfig.compilerOptions?.declaration).toBeFalsy();
	});

	it("declares no internal path aliases in its TypeScript configuration", () => {
		expect(dataOpsTsconfig.compilerOptions?.paths).toBeUndefined();
	});

	it("declares no internal path aliases in its test configuration", () => {
		expect(read("packages/data-ops/vitest.config.ts")).not.toContain("alias");
	});

	it("imports through no internal path alias in any source file", () => {
		const files = collectTsFiles(join(DATA_OPS, "src"));
		expect(files.length).toBeGreaterThan(0);
		for (const file of files) {
			const content = readFileSync(file, "utf8");
			expect(content, `${file} should not import through the "@/" alias`).not.toMatch(
				/["']@\/[^"']*["']/,
			);
		}
	});

	it("points no relative import at a compiled .js file that no longer exists", () => {
		for (const file of collectTsFiles(join(DATA_OPS, "src"))) {
			const content = readFileSync(file, "utf8");
			expect(content, `${file} should not import a relative .js path`).not.toMatch(
				/from\s+["']\.\.?\/[^"']*\.js["']/,
			);
		}
	});
});

describe("both packages draw platform runtime types from a single source", () => {
	it("keeps the platform types package out of the shared package", () => {
		expect(JSON.stringify(dataOpsPkg)).not.toContain("@cloudflare/workers-types");
		expect(dataOpsTsconfig.compilerOptions?.types ?? []).not.toContain("@cloudflare/workers-types");
	});

	it("leaves the Worker's generated runtime types as the only source", () => {
		expect(dataServiceTsconfig.compilerOptions?.types).toContain("./worker-configuration.d.ts");
		expect(existsSync(join(DATA_SERVICE, "worker-configuration.d.ts"))).toBe(true);
	});
});

describe("no workflow, script, or hook rebuilds the shared package", () => {
	it("declares no build script at the repository root", () => {
		expect(JSON.stringify(rootPkg.scripts ?? {})).not.toContain("build");
	});

	it("removes the rebuild reminder hook", () => {
		expect(read(".claude/settings.json")).not.toContain("build:data-ops");
	});
});

describe("documentation references no removed build command", () => {
	const DOCS = [
		"AGENTS.md",
		"README.md",
		"llms.txt",
		"apps/data-service/AGENTS.md",
		"packages/data-ops/AGENTS.md",
	];

	it("names no build command and no compiled output directory", () => {
		for (const doc of DOCS) {
			const content = read(doc);
			expect(content, `${doc} should not reference build:data-ops`).not.toContain("build:data-ops");
			expect(content, `${doc} should not reference a data-ops build`).not.toMatch(
				/data-ops\s+build|pnpm run build\b|rebuild/i,
			);
			expect(content, `${doc} should not reference dist/`).not.toContain("dist/");
		}
	});
});

describe("a schema edit is observable in an application typecheck", () => {
	function typecheckWorker(): void {
		execFileSync(join(DATA_SERVICE, "node_modules/.bin/tsc"), ["--noEmit"], {
			cwd: DATA_SERVICE,
			stdio: "pipe",
		});
	}

	it("surfaces a deliberate error in the shared schema with no intervening build", () => {
		const probeFile = join(DATA_OPS, "src/client/schema.ts");
		const original = readFileSync(probeFile, "utf8");
		try {
			writeFileSync(probeFile, `${original}\nexport const PROBE: number = "not a number";\n`);
			expect(() => typecheckWorker()).toThrow();
		} finally {
			writeFileSync(probeFile, original);
		}
		expect(() => typecheckWorker()).not.toThrow();
	}, 180_000);
});
