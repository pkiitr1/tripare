import { ApplicationFailure, log, proxyActivities } from '@temporalio/workflow';
import { selectBestOffers } from '../../domain/dedupe';
import type { Offer, SupplierName, SupplierResult } from '../../domain/types';
import type * as activities from '../activities';

/**
 * scheduleToClose bounds the total wait including retries; startToClose only
 * bounds one attempt. nonRetryableErrorTypes must match the `type` strings
 * fetchSupplier.ts throws - rename one without the other and retries return.
 */
const { fetchSupplierHotels } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 seconds',
  scheduleToCloseTimeout: '30 seconds',
  retry: {
    initialInterval: '200 milliseconds',
    backoffCoefficient: 2,
    maximumAttempts: 3,
    nonRetryableErrorTypes: ['SupplierBadRequest', 'SupplierBadResponse'],
  },
});

/** Redis is local and fast; a failure here is worth retrying but not for long. */
const { cacheHotels } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 seconds',
  scheduleToCloseTimeout: '20 seconds',
  retry: { initialInterval: '100 milliseconds', backoffCoefficient: 2, maximumAttempts: 3 },
});

/** Cache lifetime for a result assembled while a supplier was down. */
const DEGRADED_TTL_SECONDS = 60;

interface HotelSearchInput {
  city: string;
  /** Correlates the workflow with the HTTP request that started it. */
  requestId?: string;
}

export interface HotelSearchResult {
  offers: Offer[];
  suppliersFailed: SupplierName[];
  /** True when at least one supplier failed but we still produced a result. */
  degraded: boolean;
}

const SUPPLIERS: readonly SupplierName[] = ['Supplier A', 'Supplier B'];

/**
 * Fetches both suppliers in parallel, merges, caches, returns. `allSettled`, not
 * `all`: a dead supplier just drops out of the merge instead of failing the search.
 */
export async function hotelSearchWorkflow(input: HotelSearchInput): Promise<HotelSearchResult> {
  const city = input.city.trim().toLowerCase();
  log.info('hotel search started', { city, requestId: input.requestId });

  const settled = await Promise.allSettled(
    SUPPLIERS.map((supplier) => fetchSupplierHotels({ supplier, city })),
  );

  const succeeded: SupplierResult[] = [];
  const failed: SupplierName[] = [];

  // Keeps [A, B] order - selectBestOffers awards full ties to the first supplier.
  settled.forEach((outcome, index) => {
    const supplier = SUPPLIERS[index]!;
    if (outcome.status === 'fulfilled') {
      succeeded.push(outcome.value);
    } else {
      failed.push(supplier);
      log.warn('supplier failed after retries', {
        city,
        supplier,
        reason: String(outcome.reason?.message ?? outcome.reason),
      });
    }
  });

  if (succeeded.length === 0) {
    // Non-retryable: the activities already exhausted their own retries.
    throw ApplicationFailure.nonRetryable(
      `No supplier could be reached for city "${city}"`,
      'AllSuppliersUnavailable',
    );
  }

  const offers = selectBestOffers(succeeded);
  const degraded = failed.length > 0;

  // Partial answers expire fast, so a recovered supplier is picked up quickly.
  await cacheHotels({
    city,
    offers,
    ...(degraded ? { ttlSeconds: DEGRADED_TTL_SECONDS } : {}),
  });

  log.info('hotel search finished', { city, count: offers.length, degraded });

  return {
    offers,
    suppliersFailed: failed,
    degraded,
  };
}
