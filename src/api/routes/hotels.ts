import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import type { Offer, PriceRange } from '../../domain/types';
import { logger } from '../../logger';
import { invalidateCity, readOffers } from '../../redis/hotelStore';
import { AllSuppliersUnavailableError, runHotelSearch } from '../../temporal/client';
import { asyncHandler } from '../asyncHandler';
import { HttpError } from '../errors';

export const hotelsRouter: Router = Router();

// z.coerce.number() turns '' into 0, so `?minPrice=` would silently become a
// real lower bound. Blanks are mapped back to undefined first.
const optionalPrice = z.preprocess(
  (v) => (v === '' || v === undefined ? undefined : v),
  z.coerce.number().nonnegative().finite().optional(),
);

const querySchema = z
  .object({
    city: z.string().trim().min(1),
    minPrice: optionalPrice,
    maxPrice: optionalPrice,
    refresh: z.union([z.literal('1'), z.literal('true')]).optional(),
  })
  .refine((q) => q.minPrice === undefined || q.maxPrice === undefined || q.minPrice <= q.maxPrice, {
    message: 'minPrice must be less than or equal to maxPrice',
    path: ['minPrice'],
  });

/** Only used when Redis is down after the workflow ran - degrade, don't 500. */
function filterInMemory(offers: Offer[], range: PriceRange): Offer[] {
  return offers.filter(
    (o) =>
      (range.minPrice === undefined || o.price >= range.minPrice) &&
      (range.maxPrice === undefined || o.price <= range.maxPrice),
  );
}

function requestIdOf(req: Request): string {
  return String((req as Request & { id?: unknown }).id ?? 'unknown');
}

/**
 * GET /api/hotels?city=delhi[&minPrice=&maxPrice=][&refresh=1]
 * Cache-aside: a miss runs the workflow (which fills Redis), then both paths
 * answer through the same filtered Redis read.
 */
hotelsRouter.get(
  '/hotels',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      throw HttpError.badRequest('Invalid query parameters', parsed.error.flatten().fieldErrors);
    }

    const { city: rawCity, minPrice, maxPrice, refresh } = parsed.data;
    const city = rawCity.toLowerCase();
    const range: PriceRange = { minPrice, maxPrice };
    const requestId = requestIdOf(req);

    if (refresh) {
      await invalidateCity(city);
    }

    let offers = await readOffers(city, range).catch((err) => {
      logger.warn({ err, city }, 'redis read failed, falling back to the workflow');
      return null;
    });

    if (offers !== null) {
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('X-Filter-Source', 'redis');
      res.json(offers);
      return;
    }

    res.setHeader('X-Cache', 'MISS');

    let result;
    try {
      result = await runHotelSearch(city, requestId);
    } catch (err) {
      if (err instanceof AllSuppliersUnavailableError) {
        throw HttpError.serviceUnavailable(err.message, 'ALL_SUPPLIERS_UNAVAILABLE');
      }
      throw err;
    }

    if (result.degraded) {
      // Headers, because the spec pins the body to a bare array.
      res.setHeader('X-Degraded', 'true');
      res.setHeader('X-Suppliers-Failed', result.suppliersFailed.join(','));
    }

    offers = await readOffers(city, range).catch(() => null);

    if (offers === null) {
      logger.warn({ city }, 'redis unavailable after workflow, filtering in process');
      res.setHeader('X-Filter-Source', 'memory-fallback');
      res.json(filterInMemory(result.offers, range));
      return;
    }

    res.setHeader('X-Filter-Source', 'redis');
    res.json(offers);
  }),
);
