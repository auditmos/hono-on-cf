import { getAuth } from "@repo/data-ops/auth/server";
import { Hono } from "hono";

const auth = new Hono();

auth.all("/*", async (c) => {
	const betterAuth = getAuth();
	return betterAuth.handler(c.req.raw);
});

export default auth;
