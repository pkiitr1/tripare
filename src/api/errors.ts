/** An error carrying the HTTP status it should be rendered as. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }

  static badRequest(message: string, details?: unknown): HttpError {
    return new HttpError(400, message, 'BAD_REQUEST', details);
  }

  static serviceUnavailable(message: string, code: string): HttpError {
    return new HttpError(503, message, code);
  }
}
