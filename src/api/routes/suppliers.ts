import { type Request, type Response, Router } from 'express';
import { env } from '../../config/env';
import type { SupplierName } from '../../domain/types';
import { getSupplierHotels } from '../../suppliers/fixtures';

export const suppliersRouter: Router = Router();

/**
 * Mock third-party suppliers, called by the worker over real HTTP so timeouts
 * and 5xx are reachable. Failure simulation:
 *   ?fail=1          -> 503 for this request
 *   ?delay=6000      -> stall past SUPPLIER_TIMEOUT_MS
 *   SUPPLIER_X_DOWN  -> 503 always (env)
 */
function isDown(supplier: SupplierName, failFlag: unknown): boolean {
  if (failFlag === '1' || failFlag === 'true') return true;
  return supplier === 'Supplier A' ? env.SUPPLIER_A_DOWN : env.SUPPLIER_B_DOWN;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function handler(supplier: SupplierName) {
  return async (req: Request, res: Response) => {
    if (isDown(supplier, req.query.fail)) {
      res.status(503).json({ error: `${supplier} is unavailable`, code: 'SUPPLIER_DOWN' });
      return;
    }

    const delay = Number(req.query.delay ?? 0);
    if (Number.isFinite(delay) && delay > 0) {
      await sleep(Math.min(delay, 30_000));
    }

    const city = typeof req.query.city === 'string' ? req.query.city : undefined;
    res.json(getSupplierHotels(supplier, city));
  };
}

suppliersRouter.get('/supplierA/hotels', handler('Supplier A'));
suppliersRouter.get('/supplierB/hotels', handler('Supplier B'));
