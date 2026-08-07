import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * `worker-configuration.d.ts` is generated, and nothing about it fails loudly
 * when it falls behind: the Worker keeps compiling against runtime types
 * describing a compatibility date the runtime no longer uses. This compares the
 * banner Wrangler writes into that file against the config it was supposed to
 * be generated from, so the gap becomes a failing check rather than a slow
 * divergence nobody is watching.
 */

export type RuntimeTypesIssueKind =
	| "missing"
	| "unreadable"
	| "compatibility_date"
	| "compatibility_flags"
	| "workerd";

export type RuntimeTypesIssue = {
	/** Repository-relative path of the app whose types drifted. */
	app: string;
	kind: RuntimeTypesIssueKind;
	message: string;
	/** The command that regenerates the definitions. */
	remedy: string;
};

type WranglerConfig = {
	compatibility_date?: string;
	compatibility_flags?: string[];
};

/** The line Wrangler stamps at the top of the file it generates. */
const BANNER = /^\/\/ Runtime types generated with workerd@(\S+)\s+(\d{4}-\d{2}-\d{2})([^\n]*)$/m;

type Banner = {
	workerdVersion: string;
	compatibilityDate: string;
	compatibilityFlags: string[];
};

export function parseBanner(source: string): Banner | null {
	const match = BANNER.exec(source);
	if (!match?.[1] || !match[2]) return null;
	return {
		workerdVersion: match[1],
		compatibilityDate: match[2],
		compatibilityFlags: (match[3] ?? "").split(/\s+/).filter(Boolean),
	};
}

function readJsonc<T>(path: string): T {
	const { config, error } = ts.parseConfigFileTextToJson(path, readFileSync(path, "utf8"));
	if (error) {
		throw new Error(`${path}: ${ts.flattenDiagnosticMessageText(error.messageText, " ")}`);
	}
	return config as T;
}

/**
 * The workerd build Wrangler would generate types with today. Resolved through
 * Wrangler rather than read from a lockfile, so it reflects what is actually
 * installed and would actually run.
 */
function resolveWorkerdVersion(appDir: string): string | null {
	try {
		const fromApp = createRequire(join(appDir, "package.json"));
		const wrangler = fromApp.resolve("wrangler/package.json");
		const fromWrangler = createRequire(wrangler);
		const workerd = fromWrangler.resolve("workerd/package.json");
		const { version } = JSON.parse(readFileSync(workerd, "utf8")) as { version?: string };
		return version ?? null;
	} catch {
		return null;
	}
}

function appDirectories(root: string): string[] {
	const appsDir = join(root, "apps");
	if (!existsSync(appsDir)) return [];
	return readdirSync(appsDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => join(appsDir, entry.name))
		.filter((dir) => existsSync(join(dir, "wrangler.jsonc")));
}

function packageNameOf(appDir: string): string {
	try {
		const { name } = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8")) as {
			name?: string;
		};
		if (name) return name;
	} catch {
		// Fall through to the directory name.
	}
	return appDir.split("/").pop() ?? appDir;
}

export function findRuntimeTypesDrift(root: string): RuntimeTypesIssue[] {
	const issues: RuntimeTypesIssue[] = [];

	for (const appDir of appDirectories(root)) {
		const app = appDir.slice(root.length + 1);
		const remedy = `pnpm --filter ${packageNameOf(appDir)} cf-typegen`;
		const add = (kind: RuntimeTypesIssueKind, message: string) =>
			issues.push({ app, kind, message, remedy });

		const typesPath = join(appDir, "worker-configuration.d.ts");
		if (!existsSync(typesPath)) {
			add("missing", "worker-configuration.d.ts does not exist");
			continue;
		}

		const banner = parseBanner(readFileSync(typesPath, "utf8"));
		if (!banner) {
			add(
				"unreadable",
				"worker-configuration.d.ts carries no `Runtime types generated with ...` banner",
			);
			continue;
		}

		const config = readJsonc<WranglerConfig>(join(appDir, "wrangler.jsonc"));

		const configuredDate = config.compatibility_date;
		if (configuredDate && configuredDate !== banner.compatibilityDate) {
			add(
				"compatibility_date",
				`types were generated for compatibility_date ${banner.compatibilityDate}, but wrangler.jsonc configures ${configuredDate}`,
			);
		}

		const configuredFlags = [...(config.compatibility_flags ?? [])].sort();
		const generatedFlags = [...banner.compatibilityFlags].sort();
		if (configuredFlags.join(" ") !== generatedFlags.join(" ")) {
			add(
				"compatibility_flags",
				`types were generated with compatibility_flags [${generatedFlags.join(", ")}], but wrangler.jsonc configures [${configuredFlags.join(", ")}]`,
			);
		}

		const installedWorkerd = resolveWorkerdVersion(appDir);
		if (installedWorkerd === null) {
			add("workerd", "cannot resolve workerd through wrangler — run `pnpm install` first");
		} else if (installedWorkerd !== banner.workerdVersion) {
			add(
				"workerd",
				`types were generated with workerd@${banner.workerdVersion}, but the installed toolchain is workerd@${installedWorkerd}`,
			);
		}
	}

	return issues;
}

function main(): void {
	const moduleDir = dirname(fileURLToPath(import.meta.url));
	const root = process.argv[2] ? resolve(process.argv[2]) : resolve(moduleDir, "..");
	const issues = findRuntimeTypesDrift(root);

	if (issues.length === 0) {
		console.log("✓ generated runtime types match every Worker's compatibility date and toolchain");
		return;
	}

	console.error(`✗ ${issues.length} runtime-type definition(s) are stale:\n`);
	for (const issue of issues) console.error(`  ${issue.app}: ${issue.message}`);

	const remedies = [...new Set(issues.map((issue) => issue.remedy))];
	console.error("\nRegenerate and commit the result:");
	for (const remedy of remedies) console.error(`  ${remedy}`);
	process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main();
}
