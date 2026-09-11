import { describe, expect, it } from 'vitest';
import { normaliseName, selectBestOffers } from '../src/domain/dedupe';
import type { SupplierHotel, SupplierResult } from '../src/domain/types';

/** Terse builder so the tests read as rules, not as object literals. */
function hotel(
  name: string,
  price: number,
  commissionPct = 10,
  overrides: Partial<SupplierHotel> = {},
): SupplierHotel {
  return { hotelId: `${name}-${price}`, name, price, city: 'delhi', commissionPct, ...overrides };
}

function fromA(...hotels: SupplierHotel[]): SupplierResult {
  return { supplier: 'Supplier A', hotels };
}
function fromB(...hotels: SupplierHotel[]): SupplierResult {
  return { supplier: 'Supplier B', hotels };
}

describe('normaliseName', () => {
  it('lowercases and trims', () => {
    expect(normaliseName('  Holtin ')).toBe('holtin');
    expect(normaliseName('HOLTIN')).toBe('holtin');
  });

  it('collapses internal whitespace runs to a single space', () => {
    expect(normaliseName('Grand   Palace')).toBe('grand palace');
    expect(normaliseName('Grand\tPalace')).toBe('grand palace');
  });

  it('treats spelling variants of the same hotel as one key', () => {
    expect(normaliseName(' the  TAJ ')).toBe(normaliseName('The Taj'));
  });
});

describe('selectBestOffers', () => {
  describe('rule 2 - cheapest wins when a hotel appears in both suppliers', () => {
    it('picks the cheaper supplier', () => {
      const out = selectBestOffers([
        fromA(hotel('Holtin', 6000, 10)),
        fromB(hotel('Holtin', 5340, 20)),
      ]);
      expect(out).toEqual([
        { name: 'Holtin', price: 5340, supplier: 'Supplier B', commissionPct: 20 },
      ]);
    });

    it('picks A when A is cheaper', () => {
      const out = selectBestOffers([
        fromA(hotel('Radison', 5900, 13)),
        fromB(hotel('Radison', 6100, 25)),
      ]);
      expect(out).toEqual([
        { name: 'Radison', price: 5900, supplier: 'Supplier A', commissionPct: 13 },
      ]);
    });

    it('ignores commission when prices differ - cheapest still wins', () => {
      const out = selectBestOffers([
        fromA(hotel('Oberoy', 9000, 40)),
        fromB(hotel('Oberoy', 8999, 1)),
      ]);
      expect(out[0]).toMatchObject({ supplier: 'Supplier B', price: 8999 });
    });
  });

  describe('rule 3/4 - deterministic tie-breaking', () => {
    it('breaks a price tie on the higher commission', () => {
      const out = selectBestOffers([
        fromA(hotel('Leela', 7000, 12)),
        fromB(hotel('Leela', 7000, 18)),
      ]);
      expect(out[0]).toMatchObject({ supplier: 'Supplier B', commissionPct: 18 });
    });

    it('breaks a full tie on input order (Supplier A first)', () => {
      const out = selectBestOffers([
        fromA(hotel('Leela', 7000, 15)),
        fromB(hotel('Leela', 7000, 15)),
      ]);
      expect(out[0]!.supplier).toBe('Supplier A');
    });

    it('is stable across repeated calls with identical input', () => {
      const input = () => [
        fromA(hotel('X', 100, 5), hotel('Y', 100, 5)),
        fromB(hotel('Y', 100, 5)),
      ];
      expect(selectBestOffers(input())).toEqual(selectBestOffers(input()));
    });
  });

  describe('rule 1/5 - name normalisation', () => {
    it('merges hotels whose names differ only by case or whitespace', () => {
      const out = selectBestOffers([fromA(hotel('  holtin ', 6000)), fromB(hotel('HOLTIN', 5000))]);
      expect(out).toHaveLength(1);
    });

    it('returns the winning record original spelling, not the normalised key', () => {
      const out = selectBestOffers([
        fromA(hotel('  holtin ', 6000)),
        fromB(hotel('Holtin Downtown Delhi', 5000)),
        fromB(hotel('HOLTIN', 4000)),
      ]);
      const holtin = out.find((o) => o.price === 4000);
      expect(holtin!.name).toBe('HOLTIN');
    });

    it('trims surrounding whitespace from the returned name', () => {
      const out = selectBestOffers([fromA(hotel('  radison ', 6100))]);
      expect(out[0]!.name).toBe('radison');
    });

    it('does not merge genuinely different hotels', () => {
      const out = selectBestOffers([fromA(hotel('Taj', 100), hotel('Taj Palace', 90))]);
      expect(out).toHaveLength(2);
    });
  });

  describe('partial supplier availability', () => {
    it('keeps a hotel that only one supplier returned', () => {
      const out = selectBestOffers([
        fromA(hotel('OnlyA', 1000, 11)),
        fromB(hotel('OnlyB', 2000, 22)),
      ]);
      expect(out).toEqual([
        { name: 'OnlyA', price: 1000, supplier: 'Supplier A', commissionPct: 11 },
        { name: 'OnlyB', price: 2000, supplier: 'Supplier B', commissionPct: 22 },
      ]);
    });

    it('works when only one supplier answered at all', () => {
      const out = selectBestOffers([fromA(hotel('Solo', 500, 9))]);
      expect(out).toEqual([{ name: 'Solo', price: 500, supplier: 'Supplier A', commissionPct: 9 }]);
    });

    it('returns [] when no supplier answered', () => {
      expect(selectBestOffers([])).toEqual([]);
    });

    it('returns [] when suppliers answered with empty lists (unknown city)', () => {
      expect(selectBestOffers([fromA(), fromB()])).toEqual([]);
    });
  });

  describe('rules 6/7 - defensive validity filtering', () => {
    it('drops records with a blank name', () => {
      const out = selectBestOffers([fromA(hotel('   ', 100), hotel('Good', 200))]);
      expect(out.map((o) => o.name)).toEqual(['Good']);
    });

    it('drops records with a non-finite or negative price', () => {
      const out = selectBestOffers([
        fromA(
          hotel('NaN Hotel', Number.NaN),
          hotel('Inf Hotel', Number.POSITIVE_INFINITY),
          hotel('Negative Hotel', -1),
          hotel('Good', 200),
        ),
      ]);
      expect(out.map((o) => o.name)).toEqual(['Good']);
    });

    it('allows a price of exactly zero', () => {
      const out = selectBestOffers([fromA(hotel('Free Stay', 0))]);
      expect(out.map((o) => o.name)).toEqual(['Free Stay']);
    });

    it('does not let an invalid cheaper duplicate beat a valid one', () => {
      const out = selectBestOffers([
        fromA(hotel('Holtin', Number.NaN, 99)),
        fromB(hotel('Holtin', 5000, 10)),
      ]);
      expect(out).toEqual([
        { name: 'Holtin', price: 5000, supplier: 'Supplier B', commissionPct: 10 },
      ]);
    });
  });

  describe('rules 8/9 - output ordering', () => {
    it('sorts ascending by price', () => {
      const out = selectBestOffers([
        fromA(hotel('Expensive', 9000), hotel('Cheap', 1000), hotel('Mid', 5000)),
      ]);
      expect(out.map((o) => o.price)).toEqual([1000, 5000, 9000]);
    });

    it('breaks price ties by normalised name ascending', () => {
      const out = selectBestOffers([
        fromA(hotel('zebra', 100), hotel('Alpha', 100), hotel('mango', 100)),
      ]);
      expect(out.map((o) => o.name)).toEqual(['Alpha', 'mango', 'zebra']);
    });
  });

  describe('purity', () => {
    it('does not mutate its input', () => {
      const input = [fromA(hotel('Holtin', 6000)), fromB(hotel('Holtin', 5000))];
      const snapshot = JSON.parse(JSON.stringify(input));
      selectBestOffers(input);
      expect(input).toEqual(snapshot);
    });

    it('returns plain serialisable objects with exactly the four response fields', () => {
      const out = selectBestOffers([fromA(hotel('Holtin', 6000, 10, { hotelId: 'a1' }))]);
      expect(Object.keys(out[0]!).sort()).toEqual(['commissionPct', 'name', 'price', 'supplier']);
    });
  });
});
