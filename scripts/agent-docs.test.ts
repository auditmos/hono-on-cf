import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");

function read(relPath: string): string {
	return readFileSync(join(ROOT, relPath), "utf8");
}

const CURATED_AGENT_DOCS = [
	"AGENTS.md",
	"apps/data-service/AGENTS.md",
	"packages/data-ops/AGENTS.md",
];

const REMOVED_CLOUDFLARE_FEATURES = [
	"durable-objects/",
	"src/queues/",
	"src/workflows/",
	"/webhooks",
	"webhook-signature",
];

describe("agent-facing docs describe only what exists", () => {
	it("reference no removed Cloudflare feature (webhooks, queues, Durable Objects, Workflows)", () => {
		for (const doc of CURATED_AGENT_DOCS) {
			const content = read(doc);
			for (const term of REMOVED_CLOUDFLARE_FEATURES) {
				expect(content, `${doc} should not reference "${term}"`).not.toContain(term);
			}
		}
	});

	it("reference no application outside this repository", () => {
		for (const doc of CURATED_AGENT_DOCS) {
			expect(read(doc), `${doc} should not reference user-application`).not.toContain(
				"user-application",
			);
		}
	});

	it("keep the deleted-feature rule files gone", () => {
		for (const rule of [
			".claude/rules/data-service/durable-objects.md",
			".claude/rules/data-service/queues-workflows.md",
			".claude/rules/data-service/agent-sdk.md",
			".claude/rules/data-service/agent-workflows.md",
		]) {
			expect(existsSync(join(ROOT, rule)), `${rule} should be deleted`).toBe(false);
		}
	});

	it("lists in the data-service Structure block only top-level src/ directories that exist", () => {
		const doc = read("apps/data-service/AGENTS.md");
		const structureBlock = doc.match(/## Structure\n\n```\n([\s\S]*?)\n```/)?.[1] ?? "";
		expect(structureBlock, "Structure code block should exist").toBeTruthy();
		// Only top-level entries (no leading "│" continuation) represent direct children of src/.
		const topLevelDirs = structureBlock
			.split("\n")
			.filter((line) => /^(├|└)/.test(line.trim()) && line.includes("/"))
			.map((line) => line.match(/([\w-]+)\//)?.[1])
			.filter((name): name is string => Boolean(name));
		expect(topLevelDirs.length).toBeGreaterThan(0);
		for (const dirName of topLevelDirs) {
			const candidate = join(ROOT, "apps/data-service/src", dirName);
			expect(existsSync(candidate), `src/${dirName}/ referenced in Structure should exist`).toBe(
				true,
			);
		}
	});
});

describe("agent index (llms.txt) links all resolve", () => {
	const llmsTxt = read("llms.txt");
	const links = [...llmsTxt.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);

	it("has at least one link", () => {
		expect(links.length).toBeGreaterThan(0);
	});

	it("every relative link resolves to a real file", () => {
		for (const link of links) {
			if (/^https?:\/\//.test(link)) continue;
			const target = join(ROOT, link);
			expect(existsSync(target), `${link} referenced from llms.txt should exist`).toBe(true);
		}
	});
});

describe("documentation server configuration", () => {
	it(".mcp.json is present, valid, and points at the Cloudflare docs server", () => {
		const mcpConfig = JSON.parse(read(".mcp.json"));
		const servers = Object.values(mcpConfig.mcpServers ?? {}) as Array<{ url?: string }>;
		expect(servers.some((server) => server.url?.includes("docs.mcp.cloudflare.com"))).toBe(true);
	});
});

describe("root agent file depth", () => {
	it("carries a comparable heading count to the package-level agent files", () => {
		const headingCount = (content: string) => (content.match(/^##\s/gm) ?? []).length;
		const rootHeadings = headingCount(read("AGENTS.md"));
		const packageHeadingCounts = [
			headingCount(read("apps/data-service/AGENTS.md")),
			headingCount(read("packages/data-ops/AGENTS.md")),
		];
		const minPackageHeadings = Math.min(...packageHeadingCounts);
		expect(rootHeadings).toBeGreaterThanOrEqual(minPackageHeadings);
	});
});
