import { ApplicationFailure, Context } from '@temporalio/activity';
import { z } from 'zod';
import { env } from '../../config/env';
import type { SupplierName, SupplierResult } from '../../domain/types';

/** Third-party payloads are validated, not trusted. */
const supplierHotelSchema = z.object({
  hotelId: z.string(),
  name: z.string(),
  price: z.number(),
  city: z.string(),
  commissionPct: z.number(),
});
const supplierPayloadSchema = z.array(supplierHotelSchema);

const SUPPLIER_URLS: Record<SupplierName, string> = {
  'Supplier A': env.SUPPLIER_A_URL,
  'Supplier B': env.SUPPLIER_B_URL,
};

interface FetchSupplierInput {
  supplier: SupplierName;
  city: string;
}

/**
 * Calls one supplier. Its real job is deciding what Temporal should retry:
 *   retryable     - network faults, timeouts, 5xx, 408, 429
 *   non-retryable - other 4xx and malformed payloads, thrown as ApplicationFailure
 *                   with a `type` the workflow's retry policy matches by name
 */
export async function fetchSupplierHotels(input: FetchSupplierInput): Promise<SupplierResult> {
  const { supplier, city } = input;
  const { log, info } = Context.current();

  const url = new URL(SUPPLIER_URLS[supplier]);
  url.searchParams.set('city', city);

  log.info('calling supplier', { supplier, city, attempt: info.attempt });

  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(env.SUPPLIER_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
  } catch (err) {
    // Network refused, DNS failure, or our own timeout firing. All transient.
    const reason = err instanceof Error ? err.message : String(err);
    log.warn('supplier request failed', { supplier, reason });
    throw new Error(`${supplier} unreachable: ${reason}`);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const retryable = response.status >= 500 || response.status === 408 || response.status === 429;

    log.warn('supplier returned an error status', {
      supplier,
      status: response.status,
      retryable,
    });

    if (!retryable) {
      throw ApplicationFailure.nonRetryable(
        `${supplier} rejected the request with ${response.status}: ${body.slice(0, 200)}`,
        'SupplierBadRequest',
      );
    }
    throw new Error(`${supplier} returned ${response.status}`);
  }

  const parsed = supplierPayloadSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw ApplicationFailure.nonRetryable(
      `${supplier} returned a malformed payload: ${parsed.error.message.slice(0, 300)}`,
      'SupplierBadResponse',
    );
  }

  log.info('supplier responded', { supplier, count: parsed.data.length });
  return { supplier, hotels: parsed.data };
}
