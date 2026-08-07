import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const WORKFLOWS_DIR = join(ROOT, ".github", "workflows");

// biome-ignore lint/suspicious/noExplicitAny: raw parsed workflow YAML, shape varies by file
function readWorkflow(name: string): any {
	return load(readFileSync(join(WORKFLOWS_DIR, name), "utf8"));
}

function collectRunCommands(workflow: {
	jobs?: Record<string, { steps?: Array<{ run?: string }> }>;
}): string[] {
	const commands: string[] = [];
	for (const job of Object.values(workflow.jobs ?? {})) {
		for (const step of job.steps ?? []) {
			if (step.run) commands.push(step.run);
		}
	}
	return commands;
}

describe("reusable checks workflow", () => {
	const checks = readWorkflow("checks.yml");

	it("is triggered by workflow_call", () => {
		expect(checks.on).toHaveProperty("workflow_call");
	});

	it("runs lint, types, test, and knip", () => {
		const commands = collectRunCommands(checks);
		expect(commands).toContain("pnpm run lint:ci");
		expect(commands).toContain("pnpm run types");
		expect(commands).toContain("pnpm run test");
		expect(commands).toContain("pnpm run knip");
	});

	it("requires no secrets, so a credential-less clone stays green", () => {
		const raw = readFileSync(join(WORKFLOWS_DIR, "checks.yml"), "utf8");
		expect(raw).not.toContain("secrets.");
	});
});

describe("pull-request workflow", () => {
	const pr = readWorkflow("pull-request.yml");

	it("triggers on pull_request", () => {
		expect(pr.on).toHaveProperty("pull_request");
	});

	it("invokes the reusable checks workflow instead of duplicating steps", () => {
		const jobs = Object.values(pr.jobs ?? {}) as Array<{ uses?: string }>;
		expect(jobs.some((job) => job.uses === "./.github/workflows/checks.yml")).toBe(true);
	});
});

describe("release workflow", () => {
	const release = readWorkflow("release.yml");

	it("invokes the reusable checks workflow instead of duplicating steps", () => {
		const jobs = Object.values(release.jobs ?? {}) as Array<{ uses?: string }>;
		expect(jobs.some((job) => job.uses === "./.github/workflows/checks.yml")).toBe(true);
	});

	it("no longer runs its own copy of lint, types, test, or knip", () => {
		const commands = collectRunCommands(release);
		expect(commands).not.toContain("pnpm run lint:ci");
		expect(commands).not.toContain("pnpm run types");
		expect(commands).not.toContain("pnpm run test");
		expect(commands).not.toContain("pnpm run knip");
	});
});
