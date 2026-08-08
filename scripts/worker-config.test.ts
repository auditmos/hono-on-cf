import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const DATA_SERVICE = join(ROOT, "apps/data-service");

function read(relPath: string): string {
	return readFileSync(join(ROOT, relPath), "utf8");
}

function readJsonc<T>(relPath: string): T {
	const { config, error } = ts.parseConfigFileTextToJson(relPath, read(relPath));
	if (error) {
		throw new Error(`${relPath}: ${ts.flattenDiagnosticMessageText(error.messageText, " ")}`);
	}
	return config as T;
}

type WranglerEnv = {
	name?: string;
	placement?: { mode?: string };
	vars?: Record<string, string>;
	upload_source_maps?: boolean;
};

type WranglerConfig = WranglerEnv & { env?: Record<string, WranglerEnv> };

const wrangler = readJsonc<WranglerConfig>("apps/data-service/wrangler.jsonc");
const environments = wrangler.env ?? {};

/** Environments that run on Cloudflare's network, as opposed to the local dev runtime. */
const SERVER_ENVIRONMENTS = ["staging", "production"];
const LOCAL_ENVIRONMENT = "dev";
const ALL_ENVIRONMENTS = [LOCAL_ENVIRONMENT, ...SERVER_ENVIRONMENTS];

/**
 * Values that stay secrets: database connection credentials, the Better Auth
 * signing secret, and the deployment target's public base URL. The base URL is
 * held back deliberately — it is only knowable once a custom domain is wired
 * (deferred to the deploy-ergonomics slice), and a versioned placeholder would
 * mis-issue auth callbacks silently instead of failing loudly on a missing secret.
 */
const SECRET_KEYS = [
	"DATABASE_HOST",
	"DATABASE_USERNAME",
	"DATABASE_PASSWORD",
	"BETTER_AUTH_SECRET",
	"BETTER_AUTH_URL",
];

/** Plain, non-sensitive values that belong in versioned per-environment config. */
const PLAIN_CONFIG_KEYS = ["CLOUDFLARE_ENV", "ALLOWED_ORIGINS"];

/** Assignment keys declared by the secrets template, ignoring comments and blank lines. */
function secretTemplateKeys(): string[] {
	return read("apps/data-service/.example.vars")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("#") && line.includes("="))
		.map((line) => line.split("=")[0]?.trim())
		.filter((key): key is string => Boolean(key));
}

describe("every environment survives a config dry-run", () => {
	// The deploy pipeline uploads versions rather than replacing the running
	// Worker, so this dry-runs the command the pipeline actually issues. Needs no
	// credentials: it bundles and validates without reaching the platform.
	it.each(ALL_ENVIRONMENTS)("dry-runs cleanly for %s", (environment) => {
		expect(() =>
			execFileSync(
				join(DATA_SERVICE, "node_modules/.bin/wrangler"),
				["versions", "upload", "--dry-run", "--env", environment],
				{
					cwd: DATA_SERVICE,
					stdio: "pipe",
					env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" },
				},
			),
		).not.toThrow();
	}, 180_000);
});

describe("Smart Placement runs the Worker near its database", () => {
	it.each(SERVER_ENVIRONMENTS)("is enabled on %s", (environment) => {
		expect(environments[environment]?.placement?.mode).toBe("smart");
	});

	it("is absent from local development, which has no placement decision to make", () => {
		expect(environments[LOCAL_ENVIRONMENT]?.placement).toBeUndefined();
	});

	it("is not declared at the top level, where local development would inherit it", () => {
		expect(wrangler.placement).toBeUndefined();
	});
});

describe("source maps reach the platform", () => {
	it("uploads source maps, so logged stack traces are not minified", () => {
		expect(wrangler.upload_source_maps).toBe(true);
	});
});

describe("configuration splits by sensitivity, not by convenience", () => {
	it.each(ALL_ENVIRONMENTS)("declares the environment name in %s's versioned config", (name) => {
		expect(environments[name]?.vars?.CLOUDFLARE_ENV).toBe(name);
	});

	it.each(ALL_ENVIRONMENTS)("declares the allowed origins in %s's versioned config", (name) => {
		expect(environments[name]?.vars).toHaveProperty("ALLOWED_ORIGINS");
	});

	it("keeps every plain value out of the secrets template", () => {
		for (const key of PLAIN_CONFIG_KEYS) {
			expect(secretTemplateKeys(), `${key} is versioned config, not a secret`).not.toContain(key);
		}
	});

	it("leaves only credentials in the secrets template", () => {
		const keys = secretTemplateKeys();
		expect(keys.length).toBeGreaterThan(0);
		expect(keys.toSorted()).toEqual(SECRET_KEYS.toSorted());
	});

	it("makes an environment configuration change visible in a tracked diff", () => {
		const tracked = execFileSync("git", ["ls-files", "apps/data-service/wrangler.jsonc"], {
			cwd: ROOT,
			encoding: "utf8",
		}).trim();
		expect(tracked).toBe("apps/data-service/wrangler.jsonc");
		const raw = read("apps/data-service/wrangler.jsonc");
		for (const key of PLAIN_CONFIG_KEYS) {
			expect(raw, `${key} should be reviewable in wrangler.jsonc`).toContain(key);
		}
	});

	it("still declares every value on the Worker's environment interface", () => {
		const generated = read("apps/data-service/worker-configuration.d.ts");
		for (const key of [...SECRET_KEYS, ...PLAIN_CONFIG_KEYS]) {
			expect(generated, `${key} should appear in the generated Env interface`).toContain(key);
		}
	});
});

describe("secrets are pushed in one bulk operation", () => {
	const script = read("apps/data-service/sync-secrets.sh");

	it("uses the bulk upload command", () => {
		expect(script).toContain("secret bulk");
	});

	it("no longer pushes one secret at a time", () => {
		expect(script).not.toContain("secret put");
	});
});
