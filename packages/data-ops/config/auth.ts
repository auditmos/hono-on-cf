// packages/data-ops/config/auth.ts

import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createBetterAuth } from "../src/auth/setup";
import { initDatabase, MissingDatabaseEnvError } from "../src/database/setup";

const password = process.env.DATABASE_PASSWORD;
const host = process.env.DATABASE_HOST;
const username = process.env.DATABASE_USERNAME;

if (!password || !host || !username) {
	throw new MissingDatabaseEnvError();
}

export const auth = createBetterAuth({
	database: drizzleAdapter(initDatabase({ password, host, username }), {
		provider: "pg",
	}),
});
