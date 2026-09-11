import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Express 4 does not await handlers, so a rejected promise inside one becomes an
 * unhandled rejection and the client hangs until it times out - the error
 * middleware never sees it. This adapter forwards rejections to `next()`.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
