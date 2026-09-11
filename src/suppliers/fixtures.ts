import type { SupplierHotel, SupplierName } from '../domain/types';

/**
 * Static, not random, so tests and Postman can assert exact output. Delhi covers
 * every selection rule:
 *   Holtin, Ibis   in both, one cheaper          -> cheaper wins
 *   Radison        in both, B spelled "radison " -> normalisation merges them
 *   Leela          in both, same price           -> higher commission wins (B)
 *   Taj Palace     A only; Oberoy B only         -> passes through
 */
const CATALOGUE: Record<SupplierName, SupplierHotel[]> = {
  'Supplier A': [
    { hotelId: 'a1', name: 'Holtin', price: 6000, city: 'delhi', commissionPct: 10 },
    { hotelId: 'a2', name: 'Radison', price: 5900, city: 'delhi', commissionPct: 13 },
    { hotelId: 'a3', name: 'Leela', price: 7000, city: 'delhi', commissionPct: 12 },
    { hotelId: 'a4', name: 'Ibis', price: 3200, city: 'delhi', commissionPct: 8 },
    { hotelId: 'a5', name: 'Taj Palace', price: 8200, city: 'delhi', commissionPct: 15 },
    { hotelId: 'a6', name: 'Sea Breeze', price: 4500, city: 'mumbai', commissionPct: 10 },
    { hotelId: 'a7', name: 'Taj Lands', price: 12000, city: 'mumbai', commissionPct: 14 },
  ],
  'Supplier B': [
    { hotelId: 'b1', name: 'Holtin', price: 5340, city: 'delhi', commissionPct: 20 },
    { hotelId: 'b2', name: 'radison ', price: 6100, city: 'delhi', commissionPct: 25 },
    { hotelId: 'b3', name: 'Leela', price: 7000, city: 'delhi', commissionPct: 18 },
    { hotelId: 'b4', name: 'Ibis', price: 3400, city: 'delhi', commissionPct: 9 },
    { hotelId: 'b5', name: 'Oberoy', price: 9100, city: 'delhi', commissionPct: 18 },
    { hotelId: 'b6', name: 'Sea Breeze', price: 4300, city: 'mumbai', commissionPct: 12 },
    { hotelId: 'b7', name: 'Marine Plaza', price: 6800, city: 'mumbai', commissionPct: 16 },
  ],
};

/** A supplier's hotels, optionally for one city. Unknown city -> [], not an error. */
export function getSupplierHotels(supplier: SupplierName, city?: string): SupplierHotel[] {
  const hotels = CATALOGUE[supplier];
  if (!city) return hotels;
  const needle = city.trim().toLowerCase();
  return hotels.filter((h) => h.city === needle);
}
