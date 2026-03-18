import { Hono } from "hono";
import auth from "./handlers/auth-handlers";
import clients from "./handlers/client-handlers";
import health from "./handlers/health-handlers";
import { createCorsMiddleware } from "./middleware/cors";
import { onErrorHandler } from "./middleware/error-handler";
import { rateLimiter } from "./middleware/rate-limiter";
import { requestId } from "./middleware/request-id";

export const App = new Hono<{ Bindings: Env }>();

App.use("*", requestId());
App.onError(onErrorHandler);
App.use("*", createCorsMiddleware());
App.use("/api/auth/*", rateLimiter({ windowMs: 60_000, maxRequests: 20 }));

App.route("/api/auth", auth);
App.route("/health", health);
App.route("/clients", clients);
