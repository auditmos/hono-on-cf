import { sql } from "drizzle-orm";
import { getDb } from "@/database/setup";
import type { DatabaseStatus } from "./schema";

type PgErrorCause = Error & { code?: string };

function extractCause(error: unknown): { message: string; code?: string } | undefined {
	if (!(error instanceof Error) || !error.cause) return undefined;
	const cause = error.cause;
	if (cause instanceof Error) {
		const code = (cause as PgErrorCause).code;
		return code === undefined ? { message: cause.message } : { message: cause.message, code };
	}
	return { message: String(cause) };
}

export async function checkDatabase(): Promise<DatabaseStatus> {
	try {
		const db = getDb();
		await db.execute(sql`SELECT 1`);
		return "connected";
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const cause = extractCause(error);
		// biome-ignore lint/suspicious/noConsole: structured observability log; see Cloudflare best practice #16
		console.error(
			JSON.stringify({
				event: "health.database.check_failed",
				message,
				...(cause ? { cause } : {}),
			}),
		);
		return "disconnected";
	}
}
