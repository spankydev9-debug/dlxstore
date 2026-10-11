import type { Product } from "../types";

export type SearchCategory = { id: string; name: string };

/** Lower-case and strip diacritics so "café" matches "cafe", "Nike" matches "nike". */
function normalize(value: string): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** True when `needle` occurs at the start of any word in `haystack`. */
function hasWordStart(haystack: string, needle: string): boolean {
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    if (index === 0 || !/[a-z0-9]/.test(haystack[index - 1])) return true;
    index = haystack.indexOf(needle, index + 1);
  }
  return false;
}

/** Bounded Levenshtein distance; returns max+1 once the bound is exceeded. */
function boundedDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const m = a.length;
  const n = b.length;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** Last-resort typo tolerance over the individual words of the indexed fields. */
function fuzzyWordMatch(needle: string, fields: string[]): boolean {
  if (needle.length < 4) return false;
  const words = fields.join(" ").split(/[^a-z0-9]+/).filter((word) => word.length >= 3);
  for (const word of words) {
    if (Math.abs(word.length - needle.length) <= 1 && boundedDistance(word, needle, 1) <= 1) {
      return true;
    }
  }
  return false;
}

/**
 * Score a single product against an already-normalized query. -1 means "no
 * match"; lower is a better/earlier match. Category names are passed in because
 * products only store a `category_id`.
 */
function scoreProduct(
  product: Product,
  needle: string,
  tokens: string[],
  categoryName?: string
): number {
  const name = normalize(product.name);
  const brand = normalize(product.brand ?? "");
  const sku = normalize(product.sku ?? "");
  const tags = normalize((product.tags ?? []).join(" "));
  const description = normalize(product.description ?? "");
  const category = categoryName ? normalize(categoryName) : "";

  const haystack = `${name} ${brand} ${sku} ${category} ${tags} ${description}`;

  if (sku && sku.startsWith(needle)) return 0;
  if (name && name === needle) return 0;
  if (name.startsWith(needle)) return 1;
  if (hasWordStart(name, needle)) return 2;
  if (name.includes(needle)) return 3;
  if (brand.startsWith(needle)) return 4;
  if (brand.includes(needle)) return 5;
  if (category && category.includes(needle)) return 6;
  if (tags.includes(needle)) return 7;
  if (description.includes(needle)) return 8;

  // Multi-word queries: every token must appear somewhere (AND semantics).
  if (tokens.length > 1 && tokens.every((token) => haystack.includes(token))) return 9;

  if (fuzzyWordMatch(needle, [name, brand, category, tags])) return 10;

  return -1;
}

function categoryLookup(categories?: SearchCategory[]): Map<string, string> {
  return new Map((categories ?? []).map((category) => [category.id, category.name]));
}

/**
 * Boolean predicate shared with the shop results page (which keeps its own
 * sorting). Covers name, brand, SKU, category, tags and description, with
 * partial and one-edit-distance typo tolerance.
 */
export function matchesProductQuery(
  product: Product,
  query: string,
  categories?: SearchCategory[]
): boolean {
  const needle = normalize(query);
  if (!needle) return true;
  const tokens = needle.split(/\s+/).filter(Boolean);
  return scoreProduct(product, needle, tokens, categoryLookup(categories).get(product.category_id ?? "")) >= 0;
}

/**
 * Single product matcher shared by the desktop header field and the mobile
 * search surface.
 *
 * The two surfaces previously filtered independently (the drawer field had no
 * autocomplete at all, and neither matched on SKU), which is why mobile search
 * was strictly worse than desktop. One matcher means one behaviour.
 *
 * Matching is intentionally client-side: the catalogue is already loaded for
 * the header autocomplete, and this keeps search instant with no request. It is
 * a presentation helper — it invents no ranking and returns no data the
 * catalogue did not already have.
 */
export function matchProducts(
  products: Product[],
  query: string,
  limit = 6,
  categories?: SearchCategory[]
): Product[] {
  const needle = normalize(query);
  if (!needle) return [];
  const tokens = needle.split(/\s+/).filter(Boolean);
  const categoryNames = categoryLookup(categories);

  const scored: Array<{ product: Product; score: number }> = [];
  for (const product of products) {
    const score = scoreProduct(product, needle, tokens, categoryNames.get(product.category_id ?? ""));
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
