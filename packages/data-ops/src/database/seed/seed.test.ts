import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SEED_SCRIPT = fileURLToPath(new URL("./seed.ts", import.meta.url));
const PACKAGE_DIR = fileURLToPath(new URL("../../..", import.meta.url));

function runSeedWithoutDatabaseEnv() {
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([key]) => !key.startsWith("DATABASE_")),
	);
	return spawnSync(process.execPath, ["--import", "tsx", SEED_SCRIPT], {
		cwd: PACKAGE_DIR,
		env,
		encoding: "utf8",
	});
}

describe("seed script", () => {
	it("exits 1 and prints the error when DATABASE_* variables are missing", () => {
		const result = runSeedWithoutDatabaseEnv();

		expect(result.status).toBe(1);
		expect(result.stderr).toContain("MissingDatabaseEnvError");
		expect(result.stderr).toContain("Missing required DATABASE_* environment variables");
	});
});
