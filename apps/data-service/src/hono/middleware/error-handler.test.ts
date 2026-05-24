import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { onErrorHandler } from "./error-handler";
import { requestId } from "./request-id";

const makeApp = (throwSomething: () => never) => {
	const app = new Hono<{ Bindings: Env }>();
	app.use("*", requestId());
	app.onError(onErrorHandler);
	app.get("/boom", () => {
		throwSomething();
	});
	return app;
};

describe("onErrorHandler", () => {
	it("uses HTTPException status and message", async () => {
		const app = makeApp(() => {
			throw new HTTPException(403, { message: "forbidden" });
		});

		const res = await app.request("/boom");

		expect(res.status).toBe(403);
		const body = (await res.json()) as { error: string; requestId: string };
		expect(body.error).toBe("forbidden");
		expect(typeof body.requestId).toBe("string");
		expect(res.headers.get("x-request-id")).toBe(body.requestId);
	});

	it("falls back to HTTPException response body when message is empty", async () => {
		const app = makeApp(() => {
			throw new HTTPException(418, {
				res: new Response("I'm a teapot", { status: 418 }),
			});
		});

		const res = await app.request("/boom");

		expect(res.status).toBe(418);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("I'm a teapot");
	});

	it("returns 500 with error message for generic Error", async () => {
		const app = makeApp(() => {
			throw new Error("boom went wrong");
		});

		const res = await app.request("/boom");

		expect(res.status).toBe(500);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("boom went wrong");
		expect(res.headers.get("x-request-id")).toBeTruthy();
	});
});
