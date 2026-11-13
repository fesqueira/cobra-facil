/** Error with an HTTP status and a stable machine-readable code, rendered as { error: { code, message } }. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new AppError(404, "NOT_FOUND", `${what} não encontrada.`);
