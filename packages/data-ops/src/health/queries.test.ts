import { getDb } from "../database/setup";

vi.mock("../database/setup", () => ({
	getDb: vi.fn(),
}));

describe("checkDatabase", () => {
	beforeEach(() => {
		vi.mocked(getDb).mockReset();
	});

	it("returns 'disconnected' when db.execute rejects", async () => {
		const cause = Object.assign(new Error("ECONNREFUSED"), {
			code: "ECONNREFUSED",
		});
		const dbError = Object.assign(new Error("connection refused"), { cause });
		vi.mocked(getDb).mockReturnValue({
			execute: vi.fn().mockRejectedValue(dbError),
			// biome-ignore lint/suspicious/noExplicitAny: test stub
		} as any);

		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const { checkDatabase } = await import("./queries");
			await expect(checkDatabase()).resolves.toBe("disconnected");
		} finally {
			errorSpy.mockRestore();
		}
	});

	it("logs structured JSON containing error message and cause.code on failure", async () => {
		const cause = Object.assign(new Error("ECONNREFUSED"), {
			code: "ECONNREFUSED",
		});
		const dbError = Object.assign(new Error("connection refused"), { cause });
		vi.mocked(getDb).mockReturnValue({
			execute: vi.fn().mockRejectedValue(dbError),
			// biome-ignore lint/suspicious/noExplicitAny: test stub
		} as any);

		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const { checkDatabase } = await import("./queries");
			await checkDatabase();

			expect(errorSpy).toHaveBeenCalledTimes(1);
			const firstCall = errorSpy.mock.calls[0];
			expect(firstCall).toBeDefined();
			const payload = firstCall?.[0];
			expect(typeof payload).toBe("string");
			const parsed = JSON.parse(payload as string) as {
				message?: string;
				cause?: { code?: string };
			};
			expect(parsed.message).toBe("connection refused");
			expect(parsed.cause?.code).toBe("ECONNREFUSED");
		} finally {
			errorSpy.mockRestore();
		}
	});
});
