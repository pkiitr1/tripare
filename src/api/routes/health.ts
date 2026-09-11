import { type Request, type Response, Router } from 'express';
import { env } from '../../config/env';
import type { SupplierName } from '../../domain/types';
import { pingRedis } from '../../redis/hotelStore';
import { pingTemporal } from '../../temporal/client';
import { asyncHandler } from '../asyncHandler';

export const healthRouter: Router = Router();

const HEALTH_TIMEOUT_MS = 3000;

interface CheckResult {
  status: 'up' | 'down';
  latencyMs: number;
  error?: string;
}

/** Times one check and turns any throw into `down`, so /health itself never 500s. */
async function probe(check: () => Promise<unknown>): Promise<CheckResult> {
  const startedAt = Date.now();
  try {
    await check();
    return { status: 'up', latencyMs: Date.now() - startedAt };
  } catch (err) {
    return {
      status: 'down',
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** A supplier is healthy if it answers 2xx to a cheap, real query. */
function supplierProbe(supplier: SupplierName): () => Promise<void> {
  const base = supplier === 'Supplier A' ? env.SUPPLIER_A_URL : env.SUPPLIER_B_URL;
  return async () => {
    const url = new URL(base);
    url.searchParams.set('city', 'delhi');
    const response = await fetch(url, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`responded ${response.status}`);
    await response.arrayBuffer();
  };
}

/**
 * GET /health - probes both suppliers, Redis and Temporal in parallel.
 * 200 only when all are up, 503 otherwise; the body says which one failed.
 */
healthRouter.get(
  '/health',
  asyncHandler(async (_req: Request, res: Response) => {
    const [supplierA, supplierB, redis, temporal] = await Promise.all([
      probe(supplierProbe('Supplier A')),
      probe(supplierProbe('Supplier B')),
      probe(async () => {
        if (!(await pingRedis())) throw new Error('PING did not return PONG');
      }),
      probe(pingTemporal),
    ]);

    const checks = { supplierA, supplierB, redis, temporal };
    const healthy = Object.values(checks).every((c) => c.status === 'up');

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      uptimeSeconds: Math.round(process.uptime()),
      checks,
    });
  }),
);
