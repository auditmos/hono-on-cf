import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findDocDrift } from "./doc-drift";

const ROOT = join(import.meta.dirname, "..");

const fixtures: string[] = [];

afterEach(() => {
	for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

/** A minimal repository whose every documented reference resolves. */
const BASELINE: Record<string, string> = {
	"package.json": JSON.stringify({ scripts: { lint: "biome check .", test: "vitest run" } }),
	"apps/data-service/package.json": JSON.stringify({ scripts: { dev: "wrangler dev" } }),
	"apps/data-service/src/hono/app.ts": [
		'App.route("/health", health);',
		'App.route("/clients", clients);',
	].join("\n"),
	"llms.txt": "- [Agent guide](AGENTS.md)\n",
	"AGENTS.md": [
		"# fixture",
		"",
		"Handlers live in `apps/data-service/src/hono/`.",
		"",
		"Run `pnpm run lint` and `pnpm run dev`.",
		"",
		"- `GET /health/live`",
		"- `GET /clients`",
		"",
		"See [the index](llms.txt).",
		"",
	].join("\n"),
};

function makeFixture(overrides: Record<string, string> = {}): string {
	const root = mkdtempSync(join(tmpdir(), "doc-drift-"));
	fixtures.push(root);
	for (const [relPath, content] of Object.entries({ ...BASELINE, ...overrides })) {
		const full = join(root, relPath);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, content);
	}
	return root;
}

function withAgentsDoc(body: string): Record<string, string> {
	return { "AGENTS.md": `${BASELINE["AGENTS.md"]}\n${body}\n` };
}

describe("the check accepts documentation that matches the repository", () => {
	it("reports nothing for a repository whose references all resolve", () => {
		expect(findDocDrift(makeFixture())).toEqual([]);
	});

	it("reports nothing against this repository", () => {
		expect(findDocDrift(ROOT)).toEqual([]);
	});
});

describe("the check fails on drift", () => {
	it("fails when a deleted directory is referenced again", () => {
		const drift = findDocDrift(makeFixture(withAgentsDoc("Consumers live in `src/queues/`.")));
		expect(drift).toHaveLength(1);
		expect(drift[0]).toMatchObject({ kind: "directory", reference: "src/queues/" });
	});

	it("fails when a script that does not exist is referenced", () => {
		const drift = findDocDrift(makeFixture(withAgentsDoc("Run `pnpm run build:everything`.")));
		expect(drift).toHaveLength(1);
		expect(drift[0]).toMatchObject({ kind: "script", reference: "build:everything" });
	});

	it("fails when an index link points at a missing file", () => {
		const drift = findDocDrift(makeFixture({ "llms.txt": "- [Gone](.claude/rules/gone.md)\n" }));
		expect(drift).toHaveLength(1);
		expect(drift[0]).toMatchObject({ kind: "link", reference: ".claude/rules/gone.md" });
	});

	it("fails when an endpoint that is not mounted is documented", () => {
		const drift = findDocDrift(makeFixture(withAgentsDoc("- `POST /webhooks/stripe`")));
		expect(drift).toHaveLength(1);
		expect(drift[0]).toMatchObject({ kind: "endpoint", reference: "/webhooks/stripe" });
	});

	it("fails when a structure tree lists a directory that does not exist", () => {
		const drift = findDocDrift(
			makeFixture(
				withAgentsDoc(
					["```", "apps/data-service/src/", "└── hono/", "    ├── queues/", "```"].join("\n"),
				),
			),
		);
		expect(drift).toHaveLength(1);
		expect(drift[0]).toMatchObject({
			kind: "directory",
			reference: "apps/data-service/src/hono/queues/",
		});
	});

	it("fails when a structure tree lists a file that does not exist", () => {
		const drift = findDocDrift(
			makeFixture(
				withAgentsDoc(
					[
						"```",
						"apps/data-service/src/",
						"└── hono/",
						"    ├── app.ts",
						"    ├── gone.ts",
						"```",
					].join("\n"),
				),
			),
		);
		expect(drift).toHaveLength(1);
		expect(drift[0]).toMatchObject({
			kind: "file",
			reference: "apps/data-service/src/hono/gone.ts",
		});
	});

	it("skips a tree subtree rooted at a placeholder, which cannot resolve", () => {
		const drift = findDocDrift(
			makeFixture(
				withAgentsDoc(["```", "src/", "├── {domain}/", "│   ├── table.ts", "```"].join("\n")),
			),
		);
		expect(drift).toEqual([]);
	});

	it("reports every drifted reference, not just the first", () => {
		const drift = findDocDrift(
			makeFixture(withAgentsDoc("`src/queues/` and `pnpm run gone` and `POST /webhooks`")),
		);
		expect(drift.map((issue) => issue.kind).toSorted()).toEqual([
			"directory",
			"endpoint",
			"script",
		]);
	});
});

describe("the check runs as an executable command", () => {
	function runCheck(cwd: string): { status: number; output: string } {
		const result = execFileSync(
			join(ROOT, "node_modules/.bin/tsx"),
			[join(ROOT, "scripts/doc-drift.ts"), cwd],
			{
				cwd: ROOT,
				encoding: "utf8",
				stdio: "pipe",
				// A deliberately bare environment: no credentials, no tokens, no proxy.
				env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
			},
		);
		return { status: 0, output: result };
	}

	it("exits 0 with no credentials in the environment", () => {
		expect(() => runCheck(makeFixture())).not.toThrow();
	});

	it("exits non-zero and names the drifted reference", () => {
		const fixture = makeFixture(withAgentsDoc("Consumers live in `src/queues/`."));
		let failure: { status?: number; stdout?: string; stderr?: string } | undefined;
		try {
			runCheck(fixture);
		} catch (error) {
			failure = error as { status?: number; stdout?: string; stderr?: string };
		}
		expect(failure?.status).toBe(1);
		expect(`${failure?.stdout ?? ""}${failure?.stderr ?? ""}`).toContain("src/queues/");
	});
});

describe("the check gates every pull request", () => {
	it("is exposed as a repository script", () => {
		const { scripts } = JSON.parse(
			execFileSync("cat", ["package.json"], { cwd: ROOT, encoding: "utf8" }),
		) as { scripts: Record<string, string> };
		expect(scripts["check:docs"]).toBeDefined();
	});

	it("runs in the reusable checks workflow", () => {
		const workflow = execFileSync("cat", [".github/workflows/checks.yml"], {
			cwd: ROOT,
			encoding: "utf8",
		});
		expect(workflow).toContain("pnpm run check:docs");
	});

	it("reaches pull requests, because they invoke that workflow", () => {
		const workflow = execFileSync("cat", [".github/workflows/pull-request.yml"], {
			cwd: ROOT,
			encoding: "utf8",
		});
		expect(workflow).toContain("pull_request");
		expect(workflow).toContain("./.github/workflows/checks.yml");
	});
});
