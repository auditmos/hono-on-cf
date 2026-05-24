// packages/data-ops/drizzle.config.ts
import type { Config } from "drizzle-kit";

const config: Config = {
	out: "./src/drizzle/migrations/staging",
	schema: ["./src/drizzle/auth-schema.ts", "./src/client/table.ts", "./src/drizzle/relations.ts"],
	dialect: "postgresql",
	dbCredentials: {
		url: `postgresql://${encodeURIComponent(process.env.DATABASE_USERNAME ?? "")}:${encodeURIComponent(process.env.DATABASE_PASSWORD ?? "")}@${process.env.DATABASE_HOST}`,
	},
	tablesFilter: ["!auth_*"],
};

export default config satisfies Config;
