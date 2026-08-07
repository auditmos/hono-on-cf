import type { Context, MiddlewareHandler } from "hono";

type RateLimitBindingKey = {
	[K in keyof Env]: Env[K] extends RateLimit ? K : never;
}[keyof Env];

type RateLimiterOptions = {
	windowSeconds: number;
};

/**
 * Bucket for callers the request carries no address for. Cloudflare stamps
 * `cf-connecting-ip` on everything that reaches a deployed Worker, so beyond dev
 * a missing address means the request bypassed the edge — traffic that deserves
 * to be throttled as one group rather than waved through.
 */
const SHARED_UNIDENTIFIED_KEY = "unidentified";

const resolveKey = (c: Context<{ Bindings: Env }>): string => {
	const address = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for");
	if (address) return address;

	// Nothing sits in front of the local runtime to stamp an address, so *every*
	// local caller is unidentifiable. Collapsing them into one bucket would make
	// unrelated concurrent requests — most visibly, concurrent tests — throttle
	// each other. Dev hands each unattributable caller its own bucket instead.
	if (c.env.CLOUDFLARE_ENV === "dev") return `${SHARED_UNIDENTIFIED_KEY}:${crypto.randomUUID()}`;

	return SHARED_UNIDENTIFIED_KEY;
};

export const rateLimiter = (
	bindingKey: RateLimitBindingKey,
	{ windowSeconds }: RateLimiterOptions,
): MiddlewareHandler<{ Bindings: Env }> => {
	return async (c, next) => {
		const binding = c.env[bindingKey] as RateLimit;
		const { success } = await binding.limit({ key: resolveKey(c) });
		if (!success) {
			c.header("Retry-After", String(windowSeconds));
			return c.json({ error: "Too many requests" }, 429);
		}
		return next();
	};
};
