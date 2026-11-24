import { getDb } from "../database/setup";

vi.mock("../database/setup", () => ({
	getDb: vi.fn(),
}));

function stubInsertReturning(rows: unknown[]) {
	const returning = vi.fn().mockResolvedValue(rows);
	const values = vi.fn(() => ({ returning }));
	vi.mocked(getDb).mockReturnValue({
		insert: vi.fn(() => ({ values })),
	} as unknown as ReturnType<typeof getDb>);
}

describe("createClient", () => {
	beforeEach(() => {
		vi.mocked(getDb).mockReset();
	});

	it("returns the inserted row", async () => {
		const row = { id: "c1", name: "Ada", surname: "Lovelace", email: "ada@example.com" };
		stubInsertReturning([row]);
		const { createClient } = await import("./queries");

		await expect(
			createClient({ name: "Ada", surname: "Lovelace", email: "ada@example.com" }),
		).resolves.toEqual(row);
	});

	it("rejects with ClientNotCreatedError when the insert returns no row", async () => {
		stubInsertReturning([]);
		const { createClient } = await import("./queries");

		await expect(
			createClient({ name: "Ada", surname: "Lovelace", email: "ada@example.com" }),
		).rejects.toMatchObject({
			name: "ClientNotCreatedError",
			message: "Failed to create client",
		});
	});
});
