import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveDeployEnvironment, resolveReadinessUrl, resolveWorkerName } from "./deploy-target";

const ROOT = join(import.meta.dirname, "..");
const DEPLOY_TARGET = join(ROOT, "scripts/deploy-target.ts");

const fixtures: string[] = [];

afterEach(() => {
	for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

/** A repository whose Worker config carries only the wrangler.jsonc given. */
function makeFixture(wranglerJsonc: string): string {
	const root = mkdtempSync(join(tmpdir(), "deploy-target-"));
	fixtures.push(root);
	const file = join(root, "apps/data-service/wrangler.jsonc");
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, wranglerJsonc, "utf8");
	return root;
}

describe("resolveDeployEnvironment", () => {
	it("sends a push to main to staging", () => {
		expect(resolveDeployEnvironment({ eventName: "push", ref: "refs/heads/main" })).toBe("staging");
	});

	it("sends a version tag to production", () => {
		expect(resolveDeployEnvironment({ eventName: "push", ref: "refs/tags/v1.2.3" })).toBe(
			"production",
		);
	});

	it("honours an explicit manual dispatch", () => {
		expect(
			resolveDeployEnvironment({
				eventName: "workflow_dispatch",
				ref: "refs/heads/main",
				input: "production",
			}),
		).toBe("production");
		expect(
			resolveDeployEnvironment({
				eventName: "workflow_dispatch",
				ref: "refs/heads/main",
				input: "staging",
			}),
		).toBe("staging");
	});

	it("never reaches production from a branch push, whatever the branch is called", () => {
		const branches = [
			"refs/heads/main",
			"refs/heads/production",
			"refs/heads/v1.2.3",
			"refs/heads/release/production",
			"refs/heads/feature/x",
		];
		for (const ref of branches) {
			expect(resolveDeployEnvironment({ eventName: "push", ref })).not.toBe("production");
		}
	});

	it("deploys nothing from a ref it does not recognise", () => {
		expect(resolveDeployEnvironment({ eventName: "push", ref: "refs/heads/feature/x" })).toBeNull();
		expect(resolveDeployEnvironment({ eventName: "push", ref: "refs/tags/nightly" })).toBeNull();
		expect(
			resolveDeployEnvironment({ eventName: "pull_request", ref: "refs/heads/main" }),
		).toBeNull();
	});

	it("refuses a dispatch input that names no known environment", () => {
		expect(
			resolveDeployEnvironment({
				eventName: "workflow_dispatch",
				ref: "refs/heads/main",
				input: "prod",
			}),
		).toBeNull();
	});
});

describe("resolveReadinessUrl", () => {
	it("probes the environment's custom domain, not its liveness endpoint", () => {
		const root = makeFixture(
			JSON.stringify({
				name: "svc",
				env: {
					staging: {
						routes: [{ pattern: "api-staging.example.com", custom_domain: true }],
					},
				},
			}),
		);
		expect(resolveReadinessUrl(root, "staging")).toBe(
			"https://api-staging.example.com/health/ready",
		);
	});

	it("reads through the comments a JSONC config carries", () => {
		const root = makeFixture(`{
	// the Worker
	"name": "svc",
	"env": {
		/* production */
		"production": {
			"routes": [{ "pattern": "api.example.com", "custom_domain": true }]
		}
	}
}`);
		expect(resolveReadinessUrl(root, "production")).toBe("https://api.example.com/health/ready");
	});

	it("resolves nothing while the template's domains are still placeholders", () => {
		// The shipped template comments its routes out, so there is no domain to
		// probe. A deploy must refuse to promote rather than promote unwatched.
		expect(resolveReadinessUrl(ROOT, "staging")).toBeNull();
		expect(resolveReadinessUrl(ROOT, "production")).toBeNull();
	});

	it("ignores a route that is not bound as a custom domain", () => {
		const root = makeFixture(
			JSON.stringify({
				name: "svc",
				env: {
					staging: { routes: [{ pattern: "api-staging.example.com/*", zone_name: "example.com" }] },
				},
			}),
		);
		expect(resolveReadinessUrl(root, "staging")).toBeNull();
	});
});

describe("deploy-target CLI", () => {
	function run(args: string[], cwd = ROOT): { stdout: string; stderr: string; status: number } {
		const result = spawnSync(join(ROOT, "node_modules/.bin/tsx"), [DEPLOY_TARGET, ...args], {
			cwd,
			encoding: "utf8",
			// A deliberately bare environment: no credentials, no tokens, no proxy.
			env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
		});
		return { stdout: result.stdout, stderr: result.stderr, status: result.status ?? -1 };
	}

	it("emits the resolved environment as workflow output", () => {
		const root = makeFixture(
			JSON.stringify({
				name: "svc",
				env: { staging: { routes: [{ pattern: "api-staging.example.com", custom_domain: true }] } },
			}),
		);
		const { stdout, status } = run(["--event", "push", "--ref", "refs/heads/main", "--root", root]);
		expect(status).toBe(0);
		expect(stdout).toContain("environment=staging");
		expect(stdout).toContain("readiness_url=https://api-staging.example.com/health/ready");
	});

	it("reports that nothing deploys rather than guessing", () => {
		const { stdout, status } = run(["--event", "push", "--ref", "refs/heads/topic"]);
		expect(status).toBe(0);
		expect(stdout).toContain("environment=");
		expect(stdout).not.toMatch(/environment=(staging|production)/);
	});

	it("refuses to deploy an environment it cannot probe", () => {
		// Credentials are configured — this is a real deployment — but no custom
		// domain is bound, so no readiness gate is possible. Fail before uploading
		// anything rather than promote a version nobody is watching.
		const root = makeFixture(JSON.stringify({ name: "svc", env: { staging: {} } }));
		const { stderr, status } = run(["--event", "push", "--ref", "refs/heads/main", "--root", root]);
		expect(status).not.toBe(0);
		expect(stderr).toContain("no custom domain");
		expect(stderr).toContain("init-project");
	});
});

describe("resolveWorkerName", () => {
	it("reads the environment's deployed Worker name", () => {
		const root = makeFixture(
			JSON.stringify({ name: "svc", env: { staging: { name: "svc-staging" } } }),
		);
		expect(resolveWorkerName(root, "staging")).toBe("svc-staging");
	});

	it("matches the name the shipped Worker actually deploys under", () => {
		expect(resolveWorkerName(ROOT, "staging")).toBe("hono-on-cf-ds-staging");
		expect(resolveWorkerName(ROOT, "production")).toBe("hono-on-cf-ds-production");
	});

	it("resolves nothing for an environment that names no Worker", () => {
		const root = makeFixture(JSON.stringify({ name: "svc", env: { staging: {} } }));
		expect(resolveWorkerName(root, "staging")).toBeNull();
	});
});
