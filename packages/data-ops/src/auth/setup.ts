import { type BetterAuthOptions, betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";

export const createBetterAuth = (config: {
	database: BetterAuthOptions["database"];
	secret?: BetterAuthOptions["secret"];
	baseURL?: BetterAuthOptions["baseURL"];
}) => {
	return betterAuth({
		database: config.database,
		secret: config.secret,
		baseURL: config.baseURL,
		plugins: [bearer()],
		emailAndPassword: {
			enabled: true,
		},
		user: {
			modelName: "auth_user",
			additionalFields: {
				approved: {
					type: "boolean",
					required: true,
					defaultValue: false,
					input: false,
				},
			},
		},
		session: {
			modelName: "auth_session",
			expiresIn: 60 * 60 * 24 * 400,
			updateAge: 60 * 60 * 24,
		},
		verification: {
			modelName: "auth_verification",
		},
		account: {
			modelName: "auth_account",
		},
	});
};
