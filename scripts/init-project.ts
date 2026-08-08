#!/usr/bin/env tsx
/**
 * One-shot project bootstrap. Idempotent — safe to re-run.
 *
 * 1. Prompt once for kebab-case project name.
 * 2. Rename root package.json + apps/data-service/wrangler.jsonc (skip if already renamed).
 * 3. Warn if wrangler.jsonc lacks env.staging / env.production blocks.
 * 4. Fan out *.example templates into per-environment files (skip if exists).
 * 5. Print a next-steps checklist.
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGINAL_PKG_NAME = "hono-on-cf";

type RenameTarget =
	| { file: string; mode: "package-name" }
	| { file: string; mode: "all-occurrences"; needle: string };
type EnvTemplate = { template: string; targets: string[] };
type RenameResult = "renamed" | "skipped" | "missing";
type FanoutResult = "copied" | "skipped" | "no-template";

const RENAME_TARGETS: RenameTarget[] = [
	{ file: "package.json", mode: "package-name" },
	{ file: "apps/data-service/wrangler.jsonc", mode: "all-occurrences", needle: ORIGINAL_PKG_NAME },
];

const ENV_TEMPLATES: EnvTemplate[] = [
	{
		template: "apps/data-service/.example.vars",
		targets: [
			"apps/data-service/.dev.vars",
			"apps/data-service/.staging.vars",
			"apps/data-service/.production.vars",
		],
	},
	{
		template: "packages/data-ops/.env.example",
		targets: [
			"packages/data-ops/.env.dev",
			"packages/data-ops/.env.staging",
			"packages/data-ops/.env.production",
		],
	},
];

const WRANGLER_FILES = ["apps/data-service/wrangler.jsonc"];
const REQUIRED_WRANGLER_ENVS = ["staging", "production"];

const NEXT_STEPS = [
	"Fill DB credentials in apps/data-service/.{dev,staging,production}.vars",
	"  and packages/data-ops/.env.{dev,staging,production}",
	"  Get from https://console.neon.tech (DATABASE_HOST/USERNAME/PASSWORD).",
	"Set BETTER_AUTH_SECRET in apps/data-service/.{dev,staging,production}.vars",
	"  Generate with: openssl rand -base64 32",
	"Set BETTER_AUTH_URL to the deployed data-service URL per env.",
	"(optional) Delete the example `client` domain when ready — see README Step 6.",
	"Run migrations: pnpm run setup && pnpm run db:generate:dev && pnpm run db:migrate:dev",
	"Start dev: pnpm run dev:data-service",
];

// ── helpers ──────────────────────────────────────────────────────────

function abs(...segments: string[]): string {
	return path.join(ROOT, ...segments);
}

/**
 * One interface for the whole run. Closing and recreating it between questions
 * discards whatever stdin had already buffered, which silently swallows the
 * second answer when the run is piped rather than typed.
 */
let rl: readline.Interface | undefined;

async function prompt(question: string): Promise<string> {
	rl ??= readline.createInterface({ input: process.stdin, output: process.stdout });
	const answer = await rl.question(question);
	return answer.trim();
}

function closePrompt(): void {
	rl?.close();
	rl = undefined;
}

function readJson<T = unknown>(file: string): T {
	return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
}

function writeJson(file: string, value: unknown): void {
	fs.writeFileSync(file, `${JSON.stringify(value, null, "\t")}\n`, "utf-8");
}

function renamePackageJson(file: string, name: string): "renamed" | "skipped" {
	const pkg = readJson<{ name?: string }>(file);
	if (pkg.name === name) return "skipped";
	pkg.name = name;
	writeJson(file, pkg);
	return "renamed";
}

function renameAllOccurrences(file: string, name: string, needle: string): "renamed" | "skipped" {
	const content = fs.readFileSync(file, "utf-8");
	const replaced = content.replaceAll(needle, name);
	if (replaced === content) return "skipped";
	fs.writeFileSync(file, replaced, "utf-8");
	return "renamed";
}

function applyRename(target: RenameTarget, name: string): RenameResult {
	const file = abs(target.file);
	if (!fs.existsSync(file)) return "missing";
	if (target.mode === "package-name") return renamePackageJson(file, name);
	return renameAllOccurrences(file, name, target.needle);
}

// ── custom domain ────────────────────────────────────────────────────

/** The token every placeholder host in wrangler.jsonc is built from. */
const DOMAIN_PLACEHOLDER = "YOUR_DOMAIN.COM";

/** A hostname, at least two labels, no scheme and no path. */
const DOMAIN_PATTERN =
	/^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export function isValidDomain(domain: string): boolean {
	return DOMAIN_PATTERN.test(domain);
}

/**
 * True while the Worker config still carries placeholder hosts. Once a real
 * domain is in place this is false, which is what stops a re-run from
 * overwriting a value someone has already filled in.
 */
export function needsCustomDomain(content: string): boolean {
	return content.includes(DOMAIN_PLACEHOLDER);
}

/**
 * Uncomments the `routes` blocks the template ships commented out and puts the
 * given domain in them, along with the matching allowed origins.
 *
 * The route lines are shipped commented rather than absent so that this only has
 * to substitute, never invent JSON — the shape, position and formatting are
 * already correct in the file.
 */
export function wireCustomDomain(content: string, domain: string): string {
	if (!needsCustomDomain(content)) return content;
	return uncommentRoutes(content).replaceAll(DOMAIN_PLACEHOLDER, domain);
}

/**
 * Strips the comment marker from a commented-out `"routes": [...]` block,
 * keeping the indentation so the result stays formatted like its neighbours.
 */
function uncommentRoutes(content: string): string {
	const lines = content.split("\n");
	const output: string[] = [];
	let insideRoutes = false;

	for (const line of lines) {
		const commented = line.match(/^(\s*)\/\/\s?(.*)$/);
		if (!commented) {
			output.push(line);
			continue;
		}
		const [, indent = "", body = ""] = commented;
		if (body.startsWith('"routes"')) insideRoutes = true;
		if (!insideRoutes) {
			output.push(line);
			continue;
		}
		// A commented JSON block is indented two spaces per level inside the
		// comment; the file itself is tab-indented, so convert before splicing in.
		output.push(
			`${indent}${body.replace(/^ +/, (run) => "\t".repeat(Math.floor(run.length / 2)))}`,
		);
		if (body.startsWith("],")) insideRoutes = false;
	}
	return output.join("\n");
}

export function checkWranglerEnvs(file: string, required: string[]): string[] {
	if (!fs.existsSync(file)) return [`${file}: file not found`];
	// Parsed with TypeScript's JSONC reader rather than by stripping comments
	// with a regular expression: the config's own values contain `//`, inside
	// origins like `https://staging.example.com`, and a regex cannot tell those
	// from a comment — it cut them in half and reported the valid config as
	// unparseable.
	const { config, error } = ts.parseConfigFileTextToJson(file, fs.readFileSync(file, "utf-8"));
	if (error) {
		return [`${file}: parse failed (${ts.flattenDiagnosticMessageText(error.messageText, " ")})`];
	}
	const envs = (config as { env?: Record<string, unknown> } | undefined)?.env ?? {};
	return required.filter((e) => !envs[e]).map((e) => `${file}: missing env.${e}`);
}

function fanoutEnv(template: string, target: string): FanoutResult {
	const templatePath = abs(template);
	const targetPath = abs(target);
	if (!fs.existsSync(templatePath)) return "no-template";
	if (fs.existsSync(targetPath)) return "skipped";
	fs.mkdirSync(path.dirname(targetPath), { recursive: true });
	fs.copyFileSync(templatePath, targetPath);
	return "copied";
}

function symbolFor(result: RenameResult | FanoutResult): string {
	if (result === "renamed" || result === "copied") return "✓";
	if (result === "skipped") return "·";
	return "✗";
}

// ── steps ────────────────────────────────────────────────────────────

function stepRename(name: string): void {
	console.log("[1/5] Rename project references");
	for (const target of RENAME_TARGETS) {
		const result = applyRename(target, name);
		console.log(`      ${symbolFor(result)} ${target.file} (${result})`);
	}
}

/**
 * Prompts for the domain the deployed API answers on, and binds it. Left
 * unanswered, the Worker keeps its placeholders — and the deploy pipeline
 * refuses to promote an environment it cannot probe, rather than silently
 * serving production from a platform subdomain.
 */
async function stepCustomDomain(): Promise<void> {
	console.log("\n[2/5] Bind a custom domain");
	const file = abs(WRANGLER_FILES[0] ?? "");
	if (!fs.existsSync(file)) {
		console.log(`      ✗ ${WRANGLER_FILES[0]} (missing)`);
		return;
	}

	const content = fs.readFileSync(file, "utf-8");
	if (!needsCustomDomain(content)) {
		console.log("      · already configured (re-run leaves it alone)");
		return;
	}

	const domain = await prompt("      Custom domain (e.g. example.com), blank to skip: ");
	if (domain === "") {
		console.log("      · skipped — staging and production keep their placeholder hosts");
		console.log("        Deploys stay blocked until a domain is bound; re-run to set one.");
		return;
	}
	if (!isValidDomain(domain)) {
		console.log(`      ✗ "${domain}" is not a bare hostname — no scheme, no path. Skipped.`);
		return;
	}

	fs.writeFileSync(file, wireCustomDomain(content, domain), "utf-8");
	console.log(`      ✓ api-staging.${domain} and api.${domain} bound as custom domains`);
	console.log(`      ✓ allowed origins set to https://staging.${domain} and https://${domain}`);
}

function stepVerifyWrangler(): void {
	console.log("\n[3/5] Verify wrangler env blocks");
	const warnings = WRANGLER_FILES.flatMap((w) => checkWranglerEnvs(abs(w), REQUIRED_WRANGLER_ENVS));
	if (warnings.length === 0) {
		console.log(`      ✓ all wrangler.jsonc declare ${REQUIRED_WRANGLER_ENVS.join(", ")}`);
		return;
	}
	for (const w of warnings) console.log(`      ⚠ ${w}`);
	console.log("      (warn-only — script does not modify wrangler structure)");
}

function stepFanoutEnv(): void {
	console.log("\n[4/5] Create per-environment env files");
	for (const { template, targets } of ENV_TEMPLATES) {
		for (const target of targets) {
			const result = fanoutEnv(template, target);
			const detail = result === "copied" ? `from ${template}` : result;
			console.log(`      ${symbolFor(result)} ${target} (${detail})`);
		}
	}
}

function stepNextSteps(name: string): void {
	console.log("\n[5/5] Next steps:\n");
	for (const step of NEXT_STEPS) console.log(`  ${step}`);
	console.log(
		`\n✓ Project "${name}" initialized. Re-run anytime — already-applied steps are skipped.`,
	);
}

// ── main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const name = await prompt("Project name (kebab-case): ");
	if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) {
		console.error("✗ Invalid name. Must be kebab-case (e.g. my-app).");
		process.exit(1);
	}

	console.log(`\n→ Initializing project: ${name}\n`);
	stepRename(name);
	await stepCustomDomain();
	stepVerifyWrangler();
	stepFanoutEnv();
	stepNextSteps(name);
	closePrompt();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
