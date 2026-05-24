import { relations } from "drizzle-orm";
import { auth_session, auth_user } from "./auth-schema.js";

export const userRelations = relations(auth_user, ({ many }) => ({
	sessions: many(auth_session),
}));

export const sessionRelations = relations(auth_session, ({ one }) => ({
	user: one(auth_user, {
		fields: [auth_session.userId],
		references: [auth_user.id],
	}),
}));
