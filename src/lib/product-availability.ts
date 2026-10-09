// DLXSTORE — product availability classification
//
// One place that decides whether a product can be bought, so the product page,
// the cart and the checkout agree instead of each re-deriving it. This reads
// only fields that already exist on `Product` — there is no speculative
// "coming soon" or restock-date column, so nothing here invents a date the
// store does not actually know.

import type { Product } from "../types";

export type ProductAvailability = "available" | "low_stock" | "out_of_stock" | "unavailable";

export interface AvailabilityInfo {
  availability: ProductAvailability;
  /** True only for an active, unarchived product with stock > 0. */
  purchasable: boolean;
  /** Stock on hand for an active product; 0 otherwise. */
  stock: number;
}

/**
 * Classify a product's buyability.
 *
 * - `unavailable` — archived or deactivated. Not shown as purchasable anywhere,
 *   and excluded from checkout totals. This is the "coming soon / withdrawn"
 *   bucket DLXSTORE already has via `is_active`/`is_archived`.
 * - `out_of_stock` — active but zero stock. Kept visible (historical reference,
 *   wishlists) but not purchasable.
 * - `low_stock` — active, at or below the low-stock threshold. Purchasable, but
 *   the UI may nudge urgency honestly.
 * - `available` — active with comfortable stock.
 */
export function getProductAvailability(product: Pick<Product, "is_active" | "is_archived" | "stock_quantity" | "low_stock_threshold">): AvailabilityInfo {
  const stock = Number.isFinite(product.stock_quantity) ? Math.max(0, Math.trunc(product.stock_quantity)) : 0;
  const withdrawn = product.is_archived === true || product.is_active === false;

  if (withdrawn) {
    return { availability: "unavailable", purchasable: false, stock: 0 };
  }
  if (stock <= 0) {
    return { availability: "out_of_stock", purchasable: false, stock: 0 };
  }
  const threshold = Number.isFinite(product.low_stock_threshold) ? Math.max(0, Math.trunc(product.low_stock_threshold as number)) : 3;
  if (stock <= threshold) {
    return { availability: "low_stock", purchasable: true, stock };
  }
  return { availability: "available", purchasable: true, stock };
}
