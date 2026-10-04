import { isDemoMode, isSupabaseConfigured, supabase } from "./index";
import type { DiscoverItem } from "../../types";

// ---------------------------------------------------------------------------
// DLX Discover data layer (master roadmap area 14)
//
// Composes the existing catalogue rather than introducing a second product
// source: `product_type` already distinguishes DLX Food from the catalogue, so
// one query spans both verticals. Everything is read through the SECURITY DEFINER
// RPCs from 20261009090000_discover_recent_and_trending.sql.
//
// Two rules are load-bearing:
//   * A view is only ever recorded for the signed-in customer. There is no
//     anonymous tracking, so no visitor behaviour is collected without consent.
//   * `view_count` is never used for ranking. The ranking is recency and real
//     engagement, so nothing here can be inflated by reloading a page.
// ---------------------------------------------------------------------------

/** Thrown when the Discover RPCs are missing, i.e. the migration is unapplied. */
export class DiscoverUnavailableError extends Error {
  constructor(message = "Discovery features are not available yet.") {
    super(message);
    this.name = "DiscoverUnavailableError";
  }
}

const DEMO_RECENT_KEY = "dlxstore_recently_viewed";

function isMissingRpc(error: { code?: string; message?: string }): boolean {
  const code = error.code ?? "";
  if (code === "PGRST202" || code === "42883" || code === "42P01" || code === "42703") {
    return true;
  }
  const message = error.message ?? "";
  return /could not find the function/i.test(message) || /does not exist/i.test(message);
}

function mapItems(rows: unknown, withViewedAt: boolean): DiscoverItem[] {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id ?? ""),
      name: String(r.name ?? ""),
      slug: String(r.slug ?? ""),
      price: Number(r.price ?? 0),
      discount_price:
        r.discount_price === null || r.discount_price === undefined
          ? null
          : Number(r.discount_price),
      image_url: (r.image_url as string) ?? null,
      product_type: (r.product_type as string) ?? null,
      viewed_at: withViewedAt ? String(r.viewed_at ?? "") : undefined,
    };
  });
}

function readDemoRecent(): DiscoverItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(DEMO_RECENT_KEY);
    return raw ? (JSON.parse(raw) as DiscoverItem[]) : [];
  } catch {
    return [];
  }
}

function writeDemoRecent(items: DiscoverItem[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DEMO_RECENT_KEY, JSON.stringify(items.slice(0, 24)));
  } catch {
    // A full or unavailable localStorage must not break browsing.
  }
}

/**
 * Record that the customer opened a product.
 *
 * Best-effort by design: this is analytics, and a failure must never interrupt
 * navigation or surface an error on a product page.
 */
export async function recordProductView(productId: string): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.rpc("record_product_view", { p_product_id: productId });
    if (error) {
      if (isMissingRpc(error)) return;
      throw new Error(error.message);
    }
    return;
  }
  if (!isDemoMode) return;
  const current = readDemoRecent();
  const existing = current.find((item) => item.id === productId);
  // De-duplicate and re-stamp, matching the RPC's ON CONFLICT behaviour.
  const entry: DiscoverItem = existing
    ? { ...existing, viewed_at: new Date().toISOString() }
    : {
        id: productId,
        name: "",
        slug: "",
        price: 0,
        discount_price: null,
        image_url: null,
        product_type: null,
        viewed_at: new Date().toISOString(),
      };
  writeDemoRecent([entry, ...current.filter((item) => item.id !== productId)]);
}

/** Recently viewed, most recent first. Empty rather than throwing when unapplied. */
export async function getRecentlyViewed(limit = 12): Promise<DiscoverItem[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("get_recently_viewed", { p_limit: limit });
    if (error) {
      if (isMissingRpc(error)) return [];
      throw new Error(error.message);
    }
    return mapItems(data, true);
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  return readDemoRecent().slice(0, limit);
}

/**
 * Trending now. Works signed out (store-wide tier), and improves for a signed-in
 * customer once their circle has signal. Never throws for a missing migration: an
 * unapplied Discover rail should be absent, not broken.
 */
export async function getTrending(limit = 12): Promise<DiscoverItem[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("get_trending_products", { p_limit: limit });
    if (error) {
      if (isMissingRpc(error)) return [];
      throw new Error(error.message);
    }
    return mapItems(data, false);
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  return [];
}
