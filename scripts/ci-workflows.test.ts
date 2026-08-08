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

type WorkflowStep = {
	name?: string;
	id?: string;
	if?: string;
	run?: string;
	uses?: string;
	with?: Record<string, string>;
	env?: Record<string, string>;
};

function collectSteps(workflow: {
	jobs?: Record<string, { steps?: WorkflowStep[] }>;
}): WorkflowStep[] {
	return Object.values(workflow.jobs ?? {}).flatMap((job) => job.steps ?? []);
}

function stepUsing(workflow: unknown, action: string): WorkflowStep {
	const step = collectSteps(workflow as { jobs?: Record<string, { steps?: WorkflowStep[] }> }).find(
		(candidate) => candidate.uses?.startsWith(action),
	);
	if (!step) throw new Error(`no step uses "${action}"`);
	return step;
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

	it("blocks a merge when the generated runtime types have gone stale", () => {
		expect(collectRunCommands(checks)).toContain("pnpm run check:runtime-types");
	});
});

describe("compatibility-date bump workflow", () => {
	const compat = readWorkflow("compat-date.yml");
	const raw = readFileSync(join(WORKFLOWS_DIR, "compat-date.yml"), "utf8");

	it("regenerates the runtime types it invalidates by bumping the date", () => {
		expect(collectRunCommands(compat).join("\n")).toContain("cf-typegen");
	});

	it("subjects its own pull request to the freshness check", () => {
		// A bump that leaves the types behind must fail somewhere before merge.
		// With BOT_PR_TOKEN set that happens on the pull request; without it, on
		// this inline step. Either way the gate exists — see the token describe
		// block for which of the two runs.
		expect(collectRunCommands(compat)).toContain("pnpm run check:runtime-types");
	});

	it("no longer apologises for being unable to regenerate types", () => {
		expect(raw).not.toMatch(/does not regenerate/i);
		expect(raw).not.toMatch(/manual follow-up/i);
	});
});

describe("bot pull requests trigger checks", () => {
	const BOT_WORKFLOWS = ["deps-update.yml", "compat-date.yml"] as const;

	for (const file of BOT_WORKFLOWS) {
		it(`${file} opens its pull request with a token that starts CI`, () => {
			const open = stepUsing(readWorkflow(file), "peter-evans/create-pull-request");
			expect(open.with?.token).toContain("secrets.BOT_PR_TOKEN");
		});

		it(`${file} still opens a pull request on a clone with no token`, () => {
			// Degradation, never breakage: absent the secret the expression falls
			// back to the default token, so the bot keeps working — its pull
			// request simply arrives without checks.
			const open = stepUsing(readWorkflow(file), "peter-evans/create-pull-request");
			expect(open.with?.token).toContain("secrets.BOT_PR_TOKEN || secrets.GITHUB_TOKEN");
		});

		it(`${file} runs its inline gates only when the pull request will not be checked`, () => {
			// The inline copies of lint/types/test exist solely because bot pull
			// requests used to get no CI. Where the token starts CI they are
			// redundant, and worse: failing them here aborts before the pull
			// request exists, hiding a broken bump instead of showing it on a diff.
			const gates = collectSteps(readWorkflow(file)).filter((step) =>
				[
					"pnpm run lint:ci",
					"pnpm run types",
					"pnpm run test",
					"pnpm run knip",
					"pnpm run check:runtime-types",
				].includes(step.run ?? ""),
			);
			expect(gates.length).toBeGreaterThan(0);
			for (const gate of gates) {
				expect(gate.if ?? "").toContain("steps.bot_pr_token.outputs.configured != 'true'");
			}
		});

		it(`${file} no longer tells reviewers its pull request gets no CI`, () => {
			const raw = readFileSync(join(WORKFLOWS_DIR, file), "utf8");
			expect(raw).not.toMatch(/does not trigger CI/i);
			expect(raw).not.toMatch(/re-run all jobs/i);
			expect(raw).not.toMatch(/push an empty commit/i);
		});

		it(`${file} names the secret a maintainer must add`, () => {
			const raw = readFileSync(join(WORKFLOWS_DIR, file), "utf8");
			expect(raw).toMatch(/::notice::BOT_PR_TOKEN is not configured/);
		});
	}
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
