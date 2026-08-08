/**
 * Deploy target resolution.
 *
 * Decides which environment a workflow run deploys to, and where its readiness
 * probe lives. Both answers are derived from committed configuration rather than
 * restated in workflow YAML, so the rules are testable and cannot drift from the
 * Worker they describe.
 *
 * Reads the filesystem only — no network, no credentials.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export type DeployEnvironment = "staging" | "production";

const WORKER_CONFIG = join("apps", "data-service", "wrangler.jsonc");

/** The endpoint that verifies database connectivity, unlike `/health/live`. */
const READINESS_PATH = "/health/ready";

export type DeployTrigger = {
	/** GitHub event name, e.g. `push` or `workflow_dispatch`. */
	eventName: string;
	/** Full ref, e.g. `refs/heads/main` or `refs/tags/v1.2.3`. */
	ref: string;
	/** The `environment` input, present only on a manual dispatch. */
	input?: string;
};

/**
 * Returns the environment this trigger deploys to, or `null` when it deploys
 * nothing. Production is reachable only from a version tag or an explicit
 * manual dispatch — never from a branch push, whatever the branch is called.
 */
export function resolveDeployEnvironment(trigger: DeployTrigger): DeployEnvironment | null {
	const { eventName, ref, input } = trigger;

	if (eventName === "workflow_dispatch") return isDeployEnvironment(input) ? input : null;

	if (eventName !== "push") return null;
	if (ref === "refs/heads/main") return "staging";
	// Only a version tag promotes. Matching on the `refs/tags/` prefix — never on
	// the bare name — is what keeps a branch called `v1.2.3` out of production.
	if (/^refs\/tags\/v\d+\.\d+\.\d+/.test(ref)) return "production";
	return null;
}

function isDeployEnvironment(value: string | undefined): value is DeployEnvironment {
	return value === "staging" || value === "production";
}

type WorkerRoute = { pattern?: string; custom_domain?: boolean };
type WorkerEnv = { name?: string; routes?: WorkerRoute[] };
type WorkerConfig = { env?: Record<string, WorkerEnv> };

/**
 * The Worker config's block for one environment, or nothing if unreadable.
 *
 * Parsed with TypeScript's JSONC reader rather than by stripping comments with a
 * regular expression: the config's own values contain `//`, inside URLs like
 * `https://staging.example.com`, and a regex cannot tell those from a comment.
 */
function readEnvConfig(root: string, environment: DeployEnvironment): WorkerEnv | null {
	const file = join(root, WORKER_CONFIG);
	if (!existsSync(file)) return null;
	const { config, error } = ts.parseConfigFileTextToJson(file, readFileSync(file, "utf8"));
	if (error) return null;
	return (config as WorkerConfig | undefined)?.env?.[environment] ?? null;
}

/**
 * The name the Worker deploys under in an environment. A readiness gate needs it
 * to address a specific version: the `Cloudflare-Workers-Version-Overrides`
 * header is keyed by Worker name.
 */
export function resolveWorkerName(root: string, environment: DeployEnvironment): string | null {
	return readEnvConfig(root, environment)?.name ?? null;
}

/**
 * Returns the readiness URL for an environment, or `null` when the Worker binds
 * no custom domain there — which is the state a fresh template ships in, its
 * routes commented out. A caller that cannot resolve a URL cannot gate a
 * rollout, and must refuse to promote rather than promote unwatched.
 */
export function resolveReadinessUrl(root: string, environment: DeployEnvironment): string | null {
	const routes = readEnvConfig(root, environment)?.routes ?? [];
	// Only a custom-domain binding names a whole host. A route pattern carries
	// path globs and needs a DNS record nobody promised to create, so it is not a
	// probe target.
	const domain = routes.find((route) => route.custom_domain === true)?.pattern;
	return domain ? `https://${domain}${READINESS_PATH}` : null;
}

// ── CLI ──────────────────────────────────────────────────────────────
//
// Emits `key=value` lines for a workflow to append to $GITHUB_OUTPUT:
//
//   tsx scripts/deploy-target.ts --event push --ref "$GITHUB_REF" >> "$GITHUB_OUTPUT"

function readFlag(argv: string[], flag: string): string | undefined {
	const index = argv.indexOf(flag);
	return index === -1 ? undefined : argv[index + 1];
}

function main(argv: string[]): void {
	const root = readFlag(argv, "--root") ?? resolve(dirname(fileURLToPath(import.meta.url)), "..");
	const environment = resolveDeployEnvironment({
		eventName: readFlag(argv, "--event") ?? "",
		ref: readFlag(argv, "--ref") ?? "",
		input: readFlag(argv, "--input"),
	});

	if (!environment) {
		// Not an error: most runs of most workflows deploy nothing.
		console.log("environment=");
		console.log("readiness_url=");
		console.log("worker_name=");
		return;
	}

	const readinessUrl = resolveReadinessUrl(root, environment);
	if (!readinessUrl) {
		console.error(
			`✗ ${environment} binds no custom domain, so its rollout cannot be gated on a readiness probe.\n` +
				`  Add one under env.${environment}.routes in ${WORKER_CONFIG} with "custom_domain": true —\n` +
				"  `pnpm run init-project` prompts for it. Refusing to deploy a version nobody can watch.",
		);
		process.exit(1);
	}

	console.log(`environment=${environment}`);
	console.log(`readiness_url=${readinessUrl}`);
	console.log(`worker_name=${resolveWorkerName(root, environment) ?? ""}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main(process.argv.slice(2));
}
