import { Context } from '@temporalio/activity';
import type { Offer } from '../../domain/types';
import { cacheOffers } from '../../redis/hotelStore';

interface CacheHotelsInput {
  city: string;
  offers: Offer[];
  /** Overrides the default TTL. Used to expire degraded results sooner. */
  ttlSeconds?: number;
}

/** Writes the merged result to Redis - an activity because it is I/O that can fail. */
export async function cacheHotels(input: CacheHotelsInput): Promise<void> {
  const { city, offers, ttlSeconds } = input;
  const { log } = Context.current();

  await cacheOffers(city, offers, ttlSeconds);
  log.info('offers cached', { city, count: offers.length, ttlSeconds: ttlSeconds ?? 'default' });
}
