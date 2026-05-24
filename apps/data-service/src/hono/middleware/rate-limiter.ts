import type { MiddlewareHandler } from "hono";

type RateLimitBindingKey = {
	[K in keyof Env]: Env[K] extends RateLimit ? K : never;
}[keyof Env];

type RateLimiterOptions = {
	windowSeconds: number;
};

export const rateLimiter = (
	bindingKey: RateLimitBindingKey,
	{ windowSeconds }: RateLimiterOptions,
): MiddlewareHandler<{ Bindings: Env }> => {
	return async (c, next) => {
		const ip = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "unknown";
		const binding = c.env[bindingKey] as RateLimit;
		const { success } = await binding.limit({ key: ip });
		if (!success) {
			c.header("Retry-After", String(windowSeconds));
			return c.json({ error: "Too many requests" }, 429);
		}
		return next();
	};
};
