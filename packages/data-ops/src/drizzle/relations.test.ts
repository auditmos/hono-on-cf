import { createTableRelationsHelpers, Many, One, Relations } from "drizzle-orm";
import { auth_session, auth_user } from "./auth-schema";

describe("auth relations", () => {
	it("wires auth_user.sessions as many(auth_session)", async () => {
		const { userRelations } = await import("./relations");
		expect(userRelations).toBeInstanceOf(Relations);
		expect(userRelations.table).toBe(auth_user);

		const helpers = createTableRelationsHelpers(auth_user);
		const cfg = userRelations.config(helpers);
		expect(cfg.sessions).toBeInstanceOf(Many);
		expect(cfg.sessions.referencedTable).toBe(auth_session);
	});

	it("wires auth_session.user as one(auth_user) joined on userId → id", async () => {
		const { sessionRelations } = await import("./relations");
		expect(sessionRelations).toBeInstanceOf(Relations);
		expect(sessionRelations.table).toBe(auth_session);

		const helpers = createTableRelationsHelpers(auth_session);
		const cfg = sessionRelations.config(helpers);
		const user = cfg.user as One;
		expect(user).toBeInstanceOf(One);
		expect(user.referencedTable).toBe(auth_user);
		expect(user.config?.fields).toEqual([auth_session.userId]);
		expect(user.config?.references).toEqual([auth_user.id]);
	});
});
