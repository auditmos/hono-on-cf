import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
	checkWranglerEnvs,
	isValidDomain,
	needsCustomDomain,
	wireCustomDomain,
} from "./init-project";

const ROOT = join(import.meta.dirname, "..");
const WRANGLER = join(ROOT, "apps/data-service/wrangler.jsonc");

type WranglerEnv = {
	name?: string;
	routes?: Array<{ pattern?: string; custom_domain?: boolean; zone_name?: string }>;
	vars?: Record<string, string>;
};

function parse(content: string): { env?: Record<string, WranglerEnv> } {
	const { config, error } = ts.parseConfigFileTextToJson("wrangler.jsonc", content);
	if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, " "));
	return config as { env?: Record<string, WranglerEnv> };
}

describe("wireCustomDomain", () => {
	const shipped = readFileSync(WRANGLER, "utf8");

	it("binds each remote environment as a custom domain, not a route pattern", () => {
		// Custom domains create the DNS record and certificate themselves. A route
		// pattern needs a proxied record to already exist, or requests fail outright.
		const { env } = parse(wireCustomDomain(shipped, "example.com"));
		expect(env?.staging?.routes).toEqual([
			{ pattern: "api-staging.example.com", custom_domain: true },
		]);
		expect(env?.production?.routes).toEqual([{ pattern: "api.example.com", custom_domain: true }]);
	});

	it("points allowed origins at the same domain", () => {
		const { env } = parse(wireCustomDomain(shipped, "example.com"));
		expect(env?.staging?.vars?.ALLOWED_ORIGINS).toBe("https://staging.example.com");
		expect(env?.production?.vars?.ALLOWED_ORIGINS).toBe("https://example.com");
	});

	it("leaves no placeholder host anywhere in the config", () => {
		expect(wireCustomDomain(shipped, "example.com")).not.toContain("YOUR_DOMAIN");
	});

	it("keeps the config's comments, which explain why each setting is there", () => {
		const wired = wireCustomDomain(shipped, "example.com");
		expect(wired).toContain("run the Worker");
		expect(wired).toContain("Sized for uptime monitors");
	});

	it("indents what it uncomments with the tabs the rest of the file uses", () => {
		const wired = wireCustomDomain(shipped, "example.com");
		const routeLines = wired
			.split("\n")
			.filter((line) => /"(routes|pattern|custom_domain)"/.test(line));
		expect(routeLines).not.toEqual([]);
		// Tabs only. A block comment's ` *` continuation lines legitimately start
		// with a space, so this looks at the lines the function itself produced.
		for (const line of routeLines) expect(line).not.toMatch(/^\t* /);
	});

	it("never overwrites a domain someone has already filled in", () => {
		// Re-running during incremental configuration must be safe. Once a real
		// host is in place there is no placeholder left to substitute, so a second
		// run with a different answer is a no-op rather than a silent replacement.
		const wired = wireCustomDomain(shipped, "example.com");
		expect(wireCustomDomain(wired, "somewhere-else.com")).toBe(wired);
		expect(needsCustomDomain(wired)).toBe(false);
	});

	it("recognises the shipped template as still needing a domain", () => {
		expect(needsCustomDomain(shipped)).toBe(true);
	});

	it("accepts a bare hostname and refuses anything carrying a scheme or path", () => {
		expect(isValidDomain("example.com")).toBe(true);
		expect(isValidDomain("my-app.co.uk")).toBe(true);
		expect(isValidDomain("https://example.com")).toBe(false);
		expect(isValidDomain("example.com/api")).toBe(false);
		expect(isValidDomain("localhost")).toBe(false);
		expect(isValidDomain("")).toBe(false);
	});
});

describe("checkWranglerEnvs", () => {
	const shipped = readFileSync(WRANGLER, "utf8");

	it("accepts the config the template ships with", () => {
		// The allowed-origins values contain `https://`, and a comment stripper
		// built from a regular expression cuts those in half — which made the
		// verify step report a parse failure on a perfectly valid config.
		expect(checkWranglerEnvs(WRANGLER, ["staging", "production"])).toEqual([]);
	});

	it("accepts a config whose domain has been wired", () => {
		expect(checkWranglerEnvs(WRANGLER, ["staging", "production"])).toEqual([]);
		expect(wireCustomDomain(shipped, "example.com")).not.toContain("YOUR_DOMAIN");
	});

	it("reports an environment the config does not declare", () => {
		expect(checkWranglerEnvs(WRANGLER, ["preview"])).toEqual([`${WRANGLER}: missing env.preview`]);
	});
});

describe("the configuration the script produces is deployable", () => {
	// Placeholder-free is not the same as valid. This bundles the wired config
	// with the command the deploy pipeline issues, so a substitution that
	// produced malformed JSONC fails here rather than on someone's first deploy.
	it("dry-runs cleanly once a domain is bound", () => {
		const wired = wireCustomDomain(readFileSync(WRANGLER, "utf8"), "example.com");
		const probe = join(ROOT, "apps/data-service/wrangler.init-probe.jsonc");
		writeFileSync(probe, wired, "utf8");
		try {
			for (const environment of ["staging", "production"]) {
				execFileSync(
					join(ROOT, "apps/data-service/node_modules/.bin/wrangler"),
					["versions", "upload", "--dry-run", "--env", environment, "-c", probe],
					{
						cwd: join(ROOT, "apps/data-service"),
						stdio: "pipe",
						env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" },
					},
				);
			}
		} finally {
			rmSync(probe, { force: true });
		}
	}, 180_000);
});
