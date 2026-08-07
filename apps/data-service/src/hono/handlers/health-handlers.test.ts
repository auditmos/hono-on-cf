import { env } from "cloudflare:workers";
import { App } from "../app";

// Uptime monitors poll from pools of checkpoints that share a handful of egress
// addresses, so an entire provider can arrive as one client address. Two
// providers at 20 checkpoints on a 30s interval already lands ~80 polls a
// minute on that address; one poll per second is the rate the probe has to
// survive before a limit sized for humans turns monitoring into false alerts.
const MONITORING_POLLS_PER_MINUTE = 60;

// wrangler.jsonc, dev environment: RATE_LIMIT_HEALTH is 300 requests per 60s.
const HEALTH_LIMIT = 300;

const readiness = (ip: string) =>
	App.request("/health/ready", { headers: { "cf-connecting-ip": ip } }, env);

describe("readiness probe", () => {
	it("tolerates uptime monitoring at a realistic polling rate", async () => {
		const monitoringEgress = "198.51.100.10";

		for (let i = 0; i < MONITORING_POLLS_PER_MINUTE; i++) {
			const res = await readiness(monitoringEgress);
			expect(res.status).not.toBe(429);
		}
	});

	it("is still capped — raised for monitoring, not opened up", async () => {
		const floodingCaller = "198.51.100.11";

		for (let i = 0; i < HEALTH_LIMIT; i++) {
			await readiness(floodingCaller);
		}

		expect((await readiness(floodingCaller)).status).toBe(429);
	});
});
