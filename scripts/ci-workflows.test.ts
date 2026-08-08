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

describe("deploy workflow", () => {
	const deploy = readWorkflow("deploy.yml");
	const raw = readFileSync(join(WORKFLOWS_DIR, "deploy.yml"), "utf8");
	const jobs = (deploy.jobs ?? {}) as Record<
		string,
		{ if?: string; needs?: string | string[]; environment?: string; steps?: WorkflowStep[] }
	>;

	it("deploys staging from the main branch", () => {
		expect(deploy.on?.push?.branches).toContain("main");
	});

	it("reaches production only from a version tag or an explicit dispatch", () => {
		expect(deploy.on?.push?.tags?.join(" ")).toMatch(/v/);
		const choice = deploy.on?.workflow_dispatch?.inputs?.environment;
		expect(choice?.type).toBe("choice");
		expect(choice?.options).toEqual(["staging", "production"]);
	});

	it("never names an environment in YAML, deferring to the tested resolver", () => {
		// The rule that keeps a branch called `production` out of production is a
		// unit-tested function, not a YAML boolean nobody can exercise.
		expect(raw).toContain("scripts/deploy-target.ts");
	});

	it("checks for deployment credentials before doing anything else", () => {
		const guard = jobs.guard?.steps ?? [];
		const credentialStep = guard.findIndex((step) => step.id === "credentials");
		expect(credentialStep).toBe(1); // after checkout, before everything else
		expect(guard[credentialStep]?.env).toMatchObject({
			CLOUDFLARE_API_TOKEN: expect.stringContaining("secrets.CLOUDFLARE_API_TOKEN"),
			CLOUDFLARE_ACCOUNT_ID: expect.stringContaining("secrets.CLOUDFLARE_ACCOUNT_ID"),
		});
	});

	it("skips with a notice naming the exact secrets to add", () => {
		expect(raw).toMatch(/::notice::[^\n]*CLOUDFLARE_API_TOKEN/);
		expect(raw).toMatch(/::notice::[^\n]*CLOUDFLARE_ACCOUNT_ID/);
	});

	it("reports green on a clone with no credentials", () => {
		// Skipping is not failing: every step past the guard is conditional, and
		// the guard itself never exits non-zero for an absent secret.
		const guard = jobs.guard?.steps ?? [];
		for (const step of guard.slice(2)) {
			expect(step.if ?? "").toContain("steps.credentials.outputs.configured == 'true'");
		}
		expect(jobs.deploy?.if).toContain("needs.guard.outputs.configured == 'true'");
	});

	it("deploys the environment the resolver chose, under that environment's protection rules", () => {
		expect(jobs.deploy?.needs).toContain("guard");
		expect(jobs.deploy?.if).toContain("needs.guard.outputs.environment != ''");
		expect(jobs.deploy?.environment).toContain("needs.guard.outputs.environment");
	});
});

describe("deploy workflow rolls out gradually behind a readiness gate", () => {
	const deploy = readWorkflow("deploy.yml");
	const steps = ((deploy.jobs?.deploy?.steps ?? []) as WorkflowStep[]).filter((step) => step.run);
	const named = (fragment: string): number =>
		steps.findIndex((step) => (step.name ?? "").toLowerCase().includes(fragment));
	const script = steps.map((step) => step.run).join("\n");

	it("uploads a version instead of replacing the running one", () => {
		expect(script).toContain("wrangler versions upload");
		// `wrangler deploy` replaces production in place. The lookahead spares
		// `wrangler deployments`, which only reads.
		expect(script).not.toMatch(/wrangler deploy(?![a-z])/);
	});

	it("proves the bundle builds before uploading anything", () => {
		expect(script).toContain("--dry-run");
		expect(named("dry run")).toBeLessThan(named("upload"));
	});

	it("sends a fraction of traffic to the new version before all of it", () => {
		// `<id>@<percentage>` is wrangler's traffic split. A canary share must
		// precede the full share, or the rollout is a replace-in-place wearing a
		// different command.
		expect(script).toMatch(/versions deploy[^\n]*@\$\{?CANARY_PERCENTAGE/);
		expect(script).toMatch(/versions deploy[^\n]*@100/);
		expect(named("canary")).toBeLessThan(named("promote"));
	});

	it("gates promotion on the readiness probe, never the liveness one", () => {
		const gate = steps[named("readiness gate")];
		expect(gate?.run).toContain("READINESS_URL");
		expect(script).not.toContain("/health/live");
		// The resolver only ever builds a /health/ready URL, and the gate reads
		// the database status that endpoint alone reports.
		expect(gate?.run).toContain('"database":"connected"');
	});

	it("halts the rollout when the gate fails", () => {
		expect(named("readiness gate")).toBeGreaterThan(named("canary"));
		expect(named("readiness gate")).toBeLessThan(named("promote"));
		// The gate exits non-zero, which stops the job before promotion — a
		// `continue-on-error` here would silently promote a broken version.
		expect(steps[named("readiness gate")]?.["continue-on-error"]).toBeUndefined();
	});

	it("verifies the promoted version too, not just the canary", () => {
		expect(named("verify")).toBeGreaterThan(named("promote"));
	});

	it("rolls back to the version that was serving before this run", () => {
		const rollback = steps[named("roll back")];
		expect(rollback?.if).toContain("failure()");
		expect(rollback?.run).toContain("PREVIOUS_VERSION");
		expect(named("previous")).toBeLessThan(named("upload"));
	});
});

describe("the readiness gate probes the canary, not whatever answers", () => {
	const deploy = readWorkflow("deploy.yml");
	const steps = ((deploy.jobs?.deploy?.steps ?? []) as WorkflowStep[]).filter((step) => step.run);
	const gate = steps.find((step) => (step.name ?? "").toLowerCase().includes("readiness gate"));

	it("addresses the new version by id rather than sampling a traffic split", () => {
		// At a 10% split an unaddressed probe usually reaches the *old* version, so
		// a gate that just curls the domain mostly proves the old version works.
		// The version-override header pins the request to the version under test.
		expect(gate?.run).toContain("Cloudflare-Workers-Version-Overrides");
		expect(gate?.run).toContain("NEW_VERSION");
		expect(gate?.run).toContain("WORKER_NAME");
	});

	it("takes the Worker name from the resolver, not from a literal in YAML", () => {
		const guardSteps = (deploy.jobs?.guard?.steps ?? []) as WorkflowStep[];
		const target = guardSteps.find((step) => step.id === "target");
		expect(target).toBeDefined();
		expect(deploy.jobs?.guard?.outputs?.worker_name).toContain("steps.target.outputs.worker_name");
	});
});
