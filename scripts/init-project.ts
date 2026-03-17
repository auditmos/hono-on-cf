import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── Helpers ──────────────────────────────────────────────────────────

function prompt(question: string): Promise<string> {
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer.trim());
		});
	});
}

function abs(...segments: string[]): string {
	return path.join(ROOT, ...segments);
}

function replaceInFile(filePath: string, search: string | RegExp, replacement: string) {
	const content = fs.readFileSync(filePath, "utf-8");
	fs.writeFileSync(filePath, content.replace(search, replacement), "utf-8");
}

function replaceAllInFile(filePath: string, search: string, replacement: string) {
	const content = fs.readFileSync(filePath, "utf-8");
	fs.writeFileSync(filePath, content.replaceAll(search, replacement), "utf-8");
}

function rmDir(dirPath: string) {
	if (fs.existsSync(dirPath)) {
		fs.rmSync(dirPath, { recursive: true, force: true });
	}
}

function rmFile(filePath: string) {
	if (fs.existsSync(filePath)) {
		fs.unlinkSync(filePath);
	}
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
	const name = await prompt("Project name (kebab-case): ");

	if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) {
		console.error("Invalid name. Must be kebab-case (e.g. my-app).");
		process.exit(1);
	}

	console.log(`\nInitializing project: ${name}\n`);

	// ── Step 1: Rename project references ────────────────────────────

	console.log("[1/6] Renaming project references...");

	replaceAllInFile(abs("apps/data-service/wrangler.jsonc"), "hono-on-cf", name);
	replaceInFile(abs("package.json"), `"name": "hono-on-cf"`, `"name": "${name}"`);

	// ── Step 2: Delete client domain (data-ops) ──────────────────────

	console.log("[2/6] Deleting client domain from data-ops...");
	rmDir(abs("packages/data-ops/src/client"));

	const dataOpsPackagePath = abs("packages/data-ops/package.json");
	const dataOpsPkg = JSON.parse(fs.readFileSync(dataOpsPackagePath, "utf-8"));
	delete dataOpsPkg.exports["./client"];
	fs.writeFileSync(dataOpsPackagePath, `${JSON.stringify(dataOpsPkg, null, "\t")}\n`, "utf-8");

	for (const cfg of [
		"drizzle-dev.config.ts",
		"drizzle-staging.config.ts",
		"drizzle-production.config.ts",
	]) {
		replaceInFile(
			abs(`packages/data-ops/${cfg}`),
			`schema: ["./src/drizzle/auth-schema.ts", "./src/client/table.ts", "./src/drizzle/relations.ts"],`,
			`schema: ["./src/drizzle/auth-schema.ts", "./src/drizzle/relations.ts"],`,
		);
	}

	// ── Step 3: Delete migrations ────────────────────────────────────

	console.log("[3/6] Deleting migrations...");
	rmDir(abs("packages/data-ops/src/drizzle/migrations/dev"));
	rmDir(abs("packages/data-ops/src/drizzle/migrations/staging"));
	rmDir(abs("packages/data-ops/src/drizzle/migrations/production"));

	// ── Step 4: Clean seed file ──────────────────────────────────────

	console.log("[4/6] Cleaning seed file...");
	fs.writeFileSync(
		abs("packages/data-ops/src/database/seed/seed.ts"),
		`import { sql } from "drizzle-orm";
import { initDatabase } from "../setup";

async function seedDb() {
	const db = initDatabase({
		host: process.env.DATABASE_HOST!,
		username: process.env.DATABASE_USERNAME!,
		password: process.env.DATABASE_PASSWORD!,
	});
	await db.execute(sql\`SELECT 1\`);
	// Add seed data here
	process.exit(0);
}

seedDb().catch(() => {
	process.exit(1);
});
`,
		"utf-8",
	);

	// ── Step 5: Clean data-service ──────────────────────────────────

	console.log("[5/6] Cleaning data-service...");
	rmFile(abs("apps/data-service/src/hono/handlers/client-handlers.ts"));
	rmFile(abs("apps/data-service/src/hono/services/client-service.ts"));

	const appTsPath = abs("apps/data-service/src/hono/app.ts");
	let appTs = fs.readFileSync(appTsPath, "utf-8");
	appTs = appTs.replace(`import clients from "./handlers/client-handlers";\n`, "");
	appTs = appTs.replace(`\nApp.route("/clients", clients);`, "");
	fs.writeFileSync(appTsPath, appTs, "utf-8");

	// ── Step 6: Self-destruct ───────────────────────────────────────

	console.log("[6/6] Cleaning up init script...");

	const rootPkgPath = abs("package.json");
	const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf-8"));
	delete rootPkg.scripts["init-project"];
	fs.writeFileSync(rootPkgPath, `${JSON.stringify(rootPkg, null, "\t")}\n`, "utf-8");

	fs.unlinkSync(abs("scripts/init-project.ts"));

	try {
		fs.rmdirSync(abs("scripts"));
	} catch {
		// not empty, leave it
	}

	console.log(`\n✅ Project "${name}" initialized!\n`);
	console.log("Next steps:");
	console.log("  1. Configure env files (see .env examples):");
	console.log("     - packages/data-ops/.env.dev");
	console.log("     - apps/data-service/.dev.vars");
	console.log(
		"  2. Run drizzle migrations: pnpm --filter data-ops drizzle:dev:generate && pnpm --filter data-ops drizzle:dev:migrate",
	);
	console.log("  3. pnpm run dev:data-service");
}

main();
