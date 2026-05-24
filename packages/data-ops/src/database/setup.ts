// packages/data-ops/database/setup.ts
import { drizzle } from "drizzle-orm/neon-http";

let db: ReturnType<typeof drizzle>;

export function initDatabase(connection: { host: string; username: string; password: string }) {
	if (db) {
		return db;
	}
	const username = encodeURIComponent(connection.username);
	const password = encodeURIComponent(connection.password);
	const connectionString = `postgres://${username}:${password}@${connection.host}`;
	db = drizzle(connectionString);
	return db;
}

export function getDb() {
	if (!db) {
		throw new Error("Database not initialized");
	}
	return db;
}
