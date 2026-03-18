import { WorkerEntrypoint } from "cloudflare:workers";
import { setAuth } from "@repo/data-ops/auth/server";
import { getDb, initDatabase } from "@repo/data-ops/database/setup";
import { App } from "@/hono/app";
import { handleQueue } from "./queues";
import { handleScheduled } from "./scheduled";

export default class DataService extends WorkerEntrypoint<Env> {
	constructor(ctx: ExecutionContext, env: Env) {
		super(ctx, env);
		initDatabase({
			host: env.DATABASE_HOST,
			username: env.DATABASE_USERNAME,
			password: env.DATABASE_PASSWORD,
		});
		setAuth({
			secret: env.BETTER_AUTH_SECRET,
			baseURL: env.BETTER_AUTH_URL,
			adapter: {
				drizzleDb: getDb(),
				provider: "pg",
			},
		});
	}
	fetch(request: Request) {
		return App.fetch(request, this.env, this.ctx);
	}

	async scheduled(controller: ScheduledController) {
		await handleScheduled(controller, this.env, this.ctx);
	}

	async queue(batch: MessageBatch<ExampleQueueMessage>) {
		await handleQueue(batch, this.env);
	}
}
