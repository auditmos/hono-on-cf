/**
 * Documentation-truth check.
 *
 * Verifies that agent-facing documents reference only directories, files,
 * endpoints, commands, and links that actually exist. Every other correction in
 * a documentation audit is one-time; this is the part that stops the audit from
 * being necessary again.
 *
 * Reads the filesystem only — no network, no credentials.
 *
 * Usage: `pnpm run check:docs` (or `tsx scripts/doc-drift.ts [root]`)
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type DocIssueKind = "directory" | "file" | "script" | "link" | "endpoint";

export type DocIssue = {
	doc: string;
	kind: DocIssueKind;
	reference: string;
	message: string;
};

const IGNORED_DIRECTORIES = new Set([
	".git",
	".wrangler",
	"coverage",
	"dist",
	"migrations",
	"node_modules",
]);

/** pnpm's own subcommands, which are never package scripts. */
const PNPM_SUBCOMMANDS = new Set([
	"add",
	"audit",
	"bin",
	"config",
	"create",
	"dedupe",
	"dlx",
	"doctor",
	"env",
	"exec",
	"fetch",
	"i",
	"import",
	"init",
	"install",
	"licenses",
	"link",
	"list",
	"ls",
	"outdated",
	"pack",
	"patch",
	"prune",
	"publish",
	"rebuild",
	"remove",
	"root",
	"run",
	"store",
	"unlink",
	"up",
	"update",
	"why",
]);

/** Braces, angle brackets and globs mark a placeholder rather than a real path. */
const PLACEHOLDER = /[{}<>*|\s]/;

function walk(dir: string, onFile: (fullPath: string) => void): void {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (IGNORED_DIRECTORIES.has(entry.name)) continue;
		const full = join(dir, entry.name);
		// isFile()/isDirectory() are false for symlinks, which keeps the CLAUDE.md
		// links to AGENTS.md from being checked twice.
		if (entry.isDirectory()) walk(full, onFile);
		else if (entry.isFile()) onFile(full);
	}
}

function collectDocs(root: string): string[] {
	const docs: string[] = [];
	const rulesDir = join(".claude", "rules");
	walk(root, (full) => {
		const rel = relative(root, full);
		const name = basename(full);
		if (name === "AGENTS.md" || name === "llms.txt") docs.push(rel);
		else if (rel.startsWith(rulesDir) && name.endsWith(".md")) docs.push(rel);
	});
	return docs.sort();
}

function collectScriptNames(root: string): Set<string> {
	const names = new Set<string>();
	walk(root, (full) => {
		if (basename(full) !== "package.json") return;
		for (const name of readScriptNames(full)) names.add(name);
	});
	return names;
}

function readScriptNames(packageJsonPath: string): string[] {
	try {
		const parsed: unknown = JSON.parse(readFileSync(packageJsonPath, "utf8"));
		if (typeof parsed !== "object" || parsed === null) return [];
		const { scripts } = parsed as { scripts?: unknown };
		if (typeof scripts !== "object" || scripts === null) return [];
		return Object.keys(scripts);
	} catch {
		return [];
	}
}

/** Route prefixes the application mounts, e.g. `App.route("/health", health)`. */
function collectRouteMounts(root: string): string[] {
	const mounts: string[] = [];
	walk(root, (full) => {
		if (!full.endsWith(".ts") || full.endsWith(".d.ts")) return;
		for (const match of readFileSync(full, "utf8").matchAll(/\.route\(\s*["'`]([^"'`]+)["'`]/g)) {
			if (match[1]) mounts.push(match[1]);
		}
	});
	return mounts;
}

function splitFences(content: string): { prose: string; fences: string[] } {
	const fences: string[] = [];
	const prose = content.replace(/```[^\n]*\n([\s\S]*?)```/g, (_full, body: string) => {
		fences.push(body);
		return "\n";
	});
	return { prose, fences };
}

function inlineCodeSpans(text: string): string[] {
	return [...text.matchAll(/`([^`\n]+)`/g)].map((match) => match[1] ?? "");
}

function nearestPackageDir(root: string, startDir: string): string {
	let current = startDir;
	for (;;) {
		if (existsSync(join(root, current, "package.json"))) return current;
		if (current === "") return "";
		const parent = dirname(current);
		current = parent === "." ? "" : parent;
	}
}

/**
 * A path in a package's document may be written relative to the repository root,
 * to the package, or to the package's `src/` — all three read naturally to a
 * human, so all three count as resolving.
 */
function resolutionBases(root: string, doc: string): string[] {
	const parent = dirname(doc);
	const docDir = parent === "." ? "" : parent;
	const packageDir = nearestPackageDir(root, docDir);
	return [...new Set(["", packageDir, join(packageDir, "src"), docDir])];
}

function resolves(root: string, bases: string[], reference: string, kind: "directory" | "file") {
	return bases.some((base) => {
		const candidate = join(root, base, reference);
		if (!existsSync(candidate)) return false;
		const stats = statSync(candidate);
		return kind === "directory" ? stats.isDirectory() : stats.isFile();
	});
}

function directoryReferences(prose: string): string[] {
	return inlineCodeSpans(prose).filter(
		(span) =>
			span.endsWith("/") &&
			!span.startsWith("/") &&
			!span.startsWith("@") &&
			!span.startsWith("http") &&
			!PLACEHOLDER.test(span),
	);
}

type TreeEntry = { reference: string; kind: "directory" | "file" };

type TreeLine = { depth: number; name: string; isDirectory: boolean };

/** One `├── name` / `└── name/` line; four spaces of indentation is one level. */
function parseTreeLine(line: string): TreeLine | undefined {
	const match = line.match(/^([\s│]*)[├└]──\s+(\S+)/);
	if (!match) return undefined;
	const name = match[2] ?? "";
	return {
		depth: Math.floor((match[1] ?? "").length / 4) + 1,
		name,
		isDirectory: name.endsWith("/"),
	};
}

/**
 * Resolves one tree line against the parent path recorded for the level above,
 * and records its own path for the level below. Returns nothing when the entry
 * sits under a placeholder, since such a path cannot be resolved.
 */
function consumeTreeLine(line: string, parents: Map<number, string | null>): TreeEntry | undefined {
	const parsed = parseTreeLine(line);
	if (!parsed) return undefined;
	const { depth, name, isDirectory } = parsed;
	const parent = parents.get(depth - 1) ?? null;
	const resolvable = parent !== null && !PLACEHOLDER.test(name);
	const reference = `${parent ?? ""}${name}`;
	if (isDirectory) parents.set(depth, resolvable ? reference : null);
	if (!resolvable) return undefined;
	return { reference, kind: isDirectory ? "directory" : "file" };
}

/** Parses a `├──`/`└──` directory tree, tracking nesting by indentation. */
function treeEntries(fence: string): TreeEntry[] {
	if (!/[├└]──/.test(fence)) return [];
	const lines = fence.split("\n");
	const first = lines[0]?.trim() ?? "";
	const rooted = first.endsWith("/");
	// A null parent marks a placeholder subtree, whose paths cannot be resolved.
	const parents = new Map<number, string | null>([[0, rooted ? first : ""]]);
	const entries: TreeEntry[] = [];

	for (const line of lines.slice(rooted ? 1 : 0)) {
		const entry = consumeTreeLine(line, parents);
		if (entry) entries.push(entry);
	}
	return entries;
}

function scriptReferences(content: string): string[] {
	return [...content.matchAll(/\bpnpm(?:\s+run)?\s+([a-z][\w:.-]*)/g)]
		.map((match) => match[1] ?? "")
		.filter((name) => !PNPM_SUBCOMMANDS.has(name));
}

function endpointReferences(prose: string): string[] {
	const references: string[] = [];
	for (const span of inlineCodeSpans(prose)) {
		for (const match of span.matchAll(/\b(?:GET|POST|PUT|DELETE|PATCH)\s+(\/\S*)/g)) {
			const path = (match[1] ?? "").replace(/\*+$/, "").replace(/\/+$/, "");
			references.push(path === "" ? "/" : path);
		}
	}
	return references;
}

function isMounted(path: string, mounts: string[]): boolean {
	return mounts.some((mount) => {
		const base = mount.replace(/\/+$/, "");
		return base === "" || path === base || path.startsWith(`${base}/`);
	});
}

function linkReferences(content: string): string[] {
	return [...content.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)]
		.map((match) => match[1] ?? "")
		.filter((target) => !/^(https?:|mailto:|#)/.test(target));
}

type DocContext = {
	root: string;
	doc: string;
	content: string;
	prose: string;
	fences: string[];
	bases: string[];
	scripts: Set<string>;
	mounts: string[];
};

function checkPaths(context: DocContext): DocIssue[] {
	const { root, doc, bases } = context;
	const references: TreeEntry[] = [
		...directoryReferences(context.prose).map(
			(reference): TreeEntry => ({ reference, kind: "directory" }),
		),
		...context.fences.flatMap(treeEntries),
	];
	return references
		.filter(({ reference, kind }) => !resolves(root, bases, reference, kind))
		.map(({ reference, kind }) => ({
			doc,
			kind,
			reference,
			message: `references ${kind} "${reference}", which does not exist`,
		}));
}

function checkScripts(context: DocContext): DocIssue[] {
	return scriptReferences(context.content)
		.filter((name) => !context.scripts.has(name))
		.map((reference) => ({
			doc: context.doc,
			kind: "script" as const,
			reference,
			message: `references script "${reference}", which no package.json defines`,
		}));
}

function checkEndpoints(context: DocContext): DocIssue[] {
	return endpointReferences(context.prose)
		.filter((path) => !isMounted(path, context.mounts))
		.map((reference) => ({
			doc: context.doc,
			kind: "endpoint" as const,
			reference,
			message: `documents endpoint "${reference}", which no route mounts`,
		}));
}

function checkLinks(context: DocContext): DocIssue[] {
	const parent = dirname(context.doc);
	const docDir = parent === "." ? "" : parent;
	return linkReferences(context.content)
		.filter((target) => {
			const [path = ""] = target.split("#");
			return path !== "" && !existsSync(join(context.root, docDir, path));
		})
		.map((reference) => ({
			doc: context.doc,
			kind: "link" as const,
			reference,
			message: `links to "${reference}", which does not exist`,
		}));
}

export function findDocDrift(root: string): DocIssue[] {
	const scripts = collectScriptNames(root);
	const mounts = collectRouteMounts(root);
	const issues: DocIssue[] = [];

	for (const doc of collectDocs(root)) {
		const content = readFileSync(join(root, doc), "utf8");
		const { prose, fences } = splitFences(content);
		const context: DocContext = {
			root,
			doc,
			content,
			prose,
			fences,
			bases: resolutionBases(root, doc),
			scripts,
			mounts,
		};
		issues.push(
			...checkPaths(context),
			...checkScripts(context),
			...checkEndpoints(context),
			...checkLinks(context),
		);
	}

	const seen = new Set<string>();
	return issues.filter((issue) => {
		const key = `${issue.doc}|${issue.kind}|${issue.reference}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function main(): void {
	const moduleDir = dirname(fileURLToPath(import.meta.url));
	const root = process.argv[2] ? resolve(process.argv[2]) : resolve(moduleDir, "..");
	const issues = findDocDrift(root);

	if (issues.length === 0) {
		console.log("✓ every documented directory, file, endpoint, command and link resolves");
		return;
	}

	console.error(`✗ ${issues.length} documentation reference(s) do not resolve:\n`);
	for (const issue of issues) console.error(`  ${issue.doc}: ${issue.message}`);
	console.error("\nUpdate the documentation, or add what it describes.");
	process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main();
}
