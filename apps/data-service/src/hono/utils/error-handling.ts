export function isError(error: unknown): error is Error {
	return error instanceof Error;
}

export function createErrorResponse(error: unknown): { error: string } {
	if (isError(error)) {
		return { error: error.message };
	}
	return { error: "Internal server error" };
}
