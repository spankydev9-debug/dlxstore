import type { Product } from "../types";

/**
 * Single product matcher shared by the desktop header field and the mobile
 * search surface.
 *
 * The two surfaces previously filtered independently (the drawer field had no
 * autocomplete at all, and neither matched on SKU), which is why mobile search
 * was strictly worse than desktop. One matcher means one behaviour.
 *
 * Matching is intentionally simple and client-side: the catalogue is already
 * loaded for the header autocomplete, and this keeps search instant with no
 * request. It is a presentation helper — it invents no ranking and returns no
 * data the catalogue did not already have.
 */
export function matchProducts(products: Product[], query: string, limit = 6): Product[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const scored: Array<{ product: Product; score: number }> = [];
  for (const product of products) {
    const name = product.name.toLowerCase();
    const brand = (product.brand ?? "").toLowerCase();
    const sku = (product.sku ?? "").toLowerCase();
    const tags = (product.tags ?? []).join(" ").toLowerCase();

    let score = -1;
    if (sku && sku.startsWith(needle)) score = 0;
    else if (name.startsWith(needle)) score = 1;
    else if (name.includes(needle)) score = 2;
    else if (brand.startsWith(needle)) score = 3;
    else if (brand.includes(needle)) score = 4;
    else if (tags.includes(needle)) score = 5;

    if (score >= 0) scored.push({ product, score });
  }

  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map((entry) => entry.product);
}

/** Build the canonical results URL so both surfaces send users to the same place. */
export function buildSearchHref(query: string): string {
  const trimmed = query.trim();
  return trimmed ? `/shop?search=${encodeURIComponent(trimmed)}` : "/shop";
}

// ---------------------------------------------------------------------------
// Recent searches
// ---------------------------------------------------------------------------

const RECENT_KEY = "dlx:recent-searches";
const RECENT_MAX = 6;

/**
 * Recent searches are a personal, device-local convenience — not account data.
 * They live in `localStorage` for the same reason the Look cache does: nothing
 * should be claimed as synced to the account while the production RPC is
 * unavailable. Read/write never throw (private browsing, disabled storage).
 */
export function readRecentSearches(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string").slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

export function rememberSearch(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return readRecentSearches();
  const next = [trimmed, ...readRecentSearches().filter((entry) => entry !== trimmed)].slice(
    0,
    RECENT_MAX
  );
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable: recents are optional, never a hard failure.
    }
  }
  return next;
}

export function clearRecentSearches(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(RECENT_KEY);
  } catch {
    // Nothing to recover from.
  }
}
