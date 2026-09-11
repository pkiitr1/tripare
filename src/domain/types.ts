export type SupplierName = 'Supplier A' | 'Supplier B';

/** Raw record as returned by a mock supplier endpoint. */
export interface SupplierHotel {
  hotelId: string;
  name: string;
  price: number;
  city: string;
  commissionPct: number;
}

/** One supplier's answer. */
export interface SupplierResult {
  supplier: SupplierName;
  hotels: SupplierHotel[];
}

/** The de-duplicated, best-priced offer returned to the client. */
export interface Offer {
  name: string;
  price: number;
  supplier: SupplierName;
  commissionPct: number;
}

/** Optional inclusive price bounds. `undefined` means unbounded on that side. */
export interface PriceRange {
  minPrice?: number;
  maxPrice?: number;
}
