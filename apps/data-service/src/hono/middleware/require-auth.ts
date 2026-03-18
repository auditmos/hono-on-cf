import { getAuth } from "@repo/data-ops/auth/server";
import type { MiddlewareHandler } from "hono";

type AuthSession = Awaited<ReturnType<ReturnType<typeof getAuth>["api"]["getSession"]>>;

export type SessionData = NonNullable<AuthSession>;

declare module "hono" {
	interface ContextVariableMap {
		session: SessionData;
	}
}

export const requireAuth = (): MiddlewareHandler => {
	return async (c, next) => {
		const auth = getAuth();
		const session = await auth.api.getSession({
			headers: c.req.raw.headers,
		});

		if (!session) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		if (!session.user.approved) {
			return c.json({ error: "Account not approved" }, 403);
		}

		c.set("session", session);

		await next();
	};
};
