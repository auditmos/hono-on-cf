// packages/data-ops/database/setup.ts
import { drizzle } from "drizzle-orm/neon-http";
import * as authSchema from "../drizzle/auth-schema";
import * as authRelations from "../drizzle/relations";

const schema = { ...authSchema, ...authRelations };

export class DatabaseNotInitializedError extends Error {
	constructor() {
		super("Database not initialized");
		this.name = "DatabaseNotInitializedError";
	}
}

let db: ReturnType<typeof drizzle<typeof schema>>;

export function initDatabase(connection: { host: string; username: string; password: string }) {
	if (db) {
		return db;
	}
	const username = encodeURIComponent(connection.username);
	const password = encodeURIComponent(connection.password);
	const connectionString = `postgres://${username}:${password}@${connection.host}`;
	db = drizzle(connectionString, { schema });
	return db;
}

export function getDb() {
	if (!db) {
		throw new DatabaseNotInitializedError();
	}
	return db;
}
