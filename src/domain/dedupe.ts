import type { Offer, SupplierHotel, SupplierName, SupplierResult } from './types';

/**
 * De-duplication key: trimmed, whitespace collapsed, lowercased.
 * `toLowerCase`, not `toLocaleLowerCase`: this runs in the workflow, where
 * locale-dependent output would break replay.
 */
export function normaliseName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** One supplier hotel with its provenance attached, used while folding. */
interface Entry {
  key: string;
  name: string;
  price: number;
  commissionPct: number;
  supplier: SupplierName;
}

/** Needs a real name and a finite, non-negative price - a NaN would corrupt the ZSET score. */
function isUsable(hotel: SupplierHotel): boolean {
  return hotel.name.trim().length > 0 && Number.isFinite(hotel.price) && hotel.price >= 0;
}

/**
 * Cheaper wins; equal price -> higher commission wins; a full tie returns false,
 * so the incumbent stays - and since A is folded before B, A wins full ties.
 */
function beats(candidate: Entry, current: Entry): boolean {
  if (candidate.price !== current.price) return candidate.price < current.price;
  return candidate.commissionPct > current.commissionPct;
}

/**
 * One best offer per hotel, sorted by price. Pure and deterministic - it runs
 * inside the workflow. A supplier that was down is simply absent from `results`.
 * The rules are specified in tests/dedupe.spec.ts.
 */
export function selectBestOffers(results: SupplierResult[]): Offer[] {
  const best = new Map<string, Entry>();

  for (const { supplier, hotels } of results) {
    for (const hotel of hotels) {
      if (!isUsable(hotel)) continue;

      const candidate: Entry = {
        key: normaliseName(hotel.name),
        name: hotel.name.trim(), // the winner's own spelling, minus stray whitespace
        price: hotel.price,
        commissionPct: hotel.commissionPct,
        supplier,
      };

      const current = best.get(candidate.key);
      if (!current || beats(candidate, current)) {
        best.set(candidate.key, candidate);
      }
    }
  }

  return [...best.values()]
    .sort((a, b) => {
      if (a.price !== b.price) return a.price - b.price;
      // Plain relational operators, never localeCompare - see normaliseName.
      if (a.key < b.key) return -1;
      if (a.key > b.key) return 1;
      return 0;
    })
    .map(({ name, price, supplier, commissionPct }) => ({ name, price, supplier, commissionPct }));
}
