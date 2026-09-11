import { env } from '../config/env';
import { normaliseName } from '../domain/dedupe';
import type { Offer, PriceRange } from '../domain/types';
import { logger } from '../logger';
import { getRedis } from './client';

/**
 * Per city:
 *   hotels:delhi        ZSET    normalised name -> price (the score ZRANGEBYSCORE filters on)
 *   hotels:delhi:data   HASH    normalised name -> JSON offer
 *   hotels:delhi:meta   STRING  presence = cached
 */
function keysFor(city: string) {
  const base = `hotels:${city}`;
  return { zset: base, hash: `${base}:data`, meta: `${base}:meta` };
}

/** Redis wants "-inf"/"+inf" for an open-ended ZRANGEBYSCORE bound. */
function bound(value: number | undefined, fallback: '-inf' | '+inf'): string {
  return value === undefined ? fallback : String(value);
}

/** Replaces a city's cache in one MULTI, so a reader never sees it half-rebuilt. */
export async function cacheOffers(
  city: string,
  offers: Offer[],
  ttlSeconds?: number,
): Promise<void> {
  const redis = getRedis();
  const { zset, hash, meta } = keysFor(city);
  const ttl = ttlSeconds ?? env.CACHE_TTL_SECONDS;

  const tx = redis.multi().del(zset, hash);

  if (offers.length > 0) {
    const zaddArgs: (string | number)[] = [];
    const hsetArgs: string[] = [];

    for (const offer of offers) {
      const key = normaliseName(offer.name);
      zaddArgs.push(offer.price, key);
      hsetArgs.push(key, JSON.stringify(offer));
    }

    tx.zadd(zset, ...zaddArgs);
    tx.hset(hash, ...hsetArgs);
    tx.expire(zset, ttl);
    tx.expire(hash, ttl);
  }

  // Written even when empty, so a city with no hotels is a hit, not a permanent miss.
  tx.set(meta, JSON.stringify({ count: offers.length }), 'EX', ttl);

  await tx.exec();
}

/** Offers in the price range, or null on a cache miss. [] is a real answer. */
export async function readOffers(city: string, range: PriceRange): Promise<Offer[] | null> {
  const redis = getRedis();
  const { zset, hash, meta } = keysFor(city);

  const rows = await redis.readHotelsInRange(
    meta,
    zset,
    hash,
    bound(range.minPrice, '-inf'),
    bound(range.maxPrice, '+inf'),
  );

  if (rows === null) return null;

  // Already in price order - ZRANGEBYSCORE returns by score.
  return rows
    .filter((row): row is string => typeof row === 'string')
    .map((row) => JSON.parse(row) as Offer);
}

/** Drops a city's cache. Used by the `?refresh=1` escape hatch. */
export async function invalidateCity(city: string): Promise<void> {
  const { zset, hash, meta } = keysFor(city);
  await getRedis().del(zset, hash, meta);
  logger.debug({ city }, 'cache invalidated');
}

export async function pingRedis(): Promise<boolean> {
  const reply = await getRedis().ping();
  return reply === 'PONG';
}
