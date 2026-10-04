import { isDemoMode, isSupabaseConfigured, supabase } from "./index";
import { encodeProductShareMessage, parseProductShareSlug } from "../../lib/product-share";
import type { Friend, Product, SocialRecommendation, SocialShare, ShareChannel } from "../../types";

// ---------------------------------------------------------------------------
// DLX Social commerce data layer (master roadmap area 12)
//
// Connects the social graph to the catalogue. Every read and every write goes
// through a SECURITY DEFINER RPC from 20261008090000_social_commerce_core.sql.
//
// Two privacy rules are load-bearing here, not decoration:
//   * `getProductSocialProof` returns COUNTS and the caller's own flags only. It
//     cannot name another customer, and the UI must not try to.
//   * A share to a person is validated server-side against follows/friendships
//     and blocks. The recipient picker here is a convenience; the RPC is the
//     authorization.
//
// `product-share.ts` already knew how to encode a product card into a chat
// message body but nothing ever called it. `shareProductToChat` is that call.
// ---------------------------------------------------------------------------

/** Thrown when the social-commerce RPCs are missing, i.e. the migration is unapplied. */
export class SocialCommerceUnavailableError extends Error {
  constructor(message = "Social shopping is not available yet.") {
    super(message);
    this.name = "SocialCommerceUnavailableError";
  }
}

const DEMO_SHARES_KEY = "dlxstore_product_shares";

function isMissingRpc(error: { code?: string; message?: string }): boolean {
  const code = error.code ?? "";
  if (code === "PGRST202" || code === "42883" || code === "42P01" || code === "42703") {
    return true;
  }
  const message = error.message ?? "";
  return /could not find the function/i.test(message) || /does not exist/i.test(message);
}

function rethrow(error: { code?: string; message?: string }): never {
  if (isMissingRpc(error)) throw new SocialCommerceUnavailableError();
  throw new Error(error.message || "Social shopping is unavailable right now.");
}

// ---------------------------------------------------------------------------
// Demo persistence
// ---------------------------------------------------------------------------

function readDemoShares(): SocialShare[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(DEMO_SHARES_KEY);
    return raw ? (JSON.parse(raw) as SocialShare[]) : [];
  } catch {
    return [];
  }
}

function writeDemoShares(shares: SocialShare[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DEMO_SHARES_KEY, JSON.stringify(shares));
  } catch {
    // A full or unavailable localStorage must not break the demo surface.
  }
}

// ---------------------------------------------------------------------------
// Social proof
// ---------------------------------------------------------------------------

function mapProof(row: unknown) {
  const r = (Array.isArray(row) ? row[0] : row) as Record<string, unknown> | null;
  if (!r) {
    // A signed-out visitor on a database without this RPC still gets a usable
    // zeroed strip rather than a broken product page.
    return {
      buyer_count: 0,
      wishlist_count: 0,
      share_count: 0,
      circle_buyer_count: 0,
      circle_wishlist_count: 0,
      i_bought_it: false,
      i_wishlisted_it: false,
      shared_with_me: false,
    };
  }
  return {
    buyer_count: Number(r.buyer_count ?? 0),
    wishlist_count: Number(r.wishlist_count ?? 0),
    share_count: Number(r.share_count ?? 0),
    circle_buyer_count: Number(r.circle_buyer_count ?? 0),
    circle_wishlist_count: Number(r.circle_wishlist_count ?? 0),
    i_bought_it: Boolean(r.i_bought_it),
    i_wishlisted_it: Boolean(r.i_wishlisted_it),
    shared_with_me: Boolean(r.shared_with_me),
  };
}

/**
 * Anonymous trust signal for a product.
 *
 * Never throws for a missing migration: social proof is an enhancement, and the
 * product page must still render for an anonymous visitor on a database where the
 * RPC does not exist yet.
 */
export async function getProductSocialProof(productId: string) {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("get_product_social_proof", {
      p_product_id: productId,
    });
    if (error) {
      if (isMissingRpc(error)) return mapProof(null);
      throw new Error(error.message || "Could not load social proof.");
    }
    return mapProof(data);
  }
  return mapProof(null);
}

/**
 * Share a product.
 *
 * `recipientId` set means a direct share to one person (which notifies them);
 * omitted means a channel share, which is a counter only. The RPC decides the
 * real channel, so a caller cannot claim a direct share as a public one.
 */
export async function shareProduct(
  productId: string,
  channel: ShareChannel = "web",
  recipientId?: string | null,
): Promise<string> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("share_product", {
      p_product_id: productId,
      p_recipient_id: recipientId ?? null,
      p_channel: channel,
    });
    if (error) rethrow(error);
    return String(data ?? "");
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  const id = `share-${Math.random().toString(36).slice(2, 12)}`;
  const shares = readDemoShares();
  shares.unshift({
    share_id: id,
    product_id: productId,
    product_name: "Product",
    product_slug: "",
    image_url: null,
    channel: recipientId ? "friend" : channel,
    recipient_id: recipientId ?? null,
    created_at: new Date().toISOString(),
  });
  writeDemoShares(shares);
  return id;
}

/**
 * Share a product into a DLX Chat conversation.
 *
 * This is the first real caller of `encodeProductShareMessage`, which existed in
 * `lib/product-share.ts` with no call site. The card rides in the message body as
 * a parseable prefix rather than in a new table, so an existing conversation
 * client renders it with no schema change and no migration.
 */
export async function shareProductToChat(
  sendMessage: (body: string) => Promise<unknown>,
  product: Pick<Product, "slug" | "name">,
  note?: string,
): Promise<void> {
  const card = encodeProductShareMessage(product.slug, product.name);
  await sendMessage(note?.trim() ? `${card}\n${note.trim()}` : card);
}

/** Pull a shared product out of a chat message body, or null if it is not a card. */
export function productSlugFromChatBody(body: string | null | undefined): string | null {
  return parseProductShareSlug(body ?? null);
}

/** Recommendations drawn from the caller's circle. Empty when there is no signal. */
export async function getSocialRecommendations(limit = 12): Promise<SocialRecommendation[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("get_social_recommendations", { p_limit: limit });
    if (error) {
      if (isMissingRpc(error)) return [];
      throw new Error(error.message || "Could not load recommendations.");
    }
    return (Array.isArray(data) ? data : []).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: String(r.id),
        name: String(r.name ?? ""),
        slug: String(r.slug ?? ""),
        price: Number(r.price ?? 0),
        discount_price:
          r.discount_price === null || r.discount_price === undefined
            ? null
            : Number(r.discount_price),
        image_url: (r.image_url as string) ?? null,
        reason: r.reason === "saved_by_friends" ? "saved_by_friends" : "bought_by_friends",
        score: Number(r.score ?? 0),
      };
    });
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  return [];
}

/** The caller's own share history. Empty rather than throwing when unavailable. */
export async function getMyShares(limit = 50): Promise<SocialShare[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("get_my_shared_products", { p_limit: limit });
    if (error) {
      if (isMissingRpc(error)) return [];
      throw new Error(error.message || "Could not load your shares.");
    }
    return (Array.isArray(data) ? data : []).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        share_id: String(r.share_id),
        product_id: String(r.product_id),
        product_name: String(r.product_name ?? ""),
        product_slug: String(r.product_slug ?? ""),
        image_url: (r.image_url as string) ?? null,
        channel: (r.channel as ShareChannel) ?? "web",
        recipient_id: (r.recipient_id as string) ?? null,
        created_at: String(r.created_at ?? ""),
      };
    });
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  return readDemoShares();
}

/**
 * Who the caller may share with.
 *
 * Reuses the friend-graph read rather than a second one: the audience for a
 * product share is exactly the audience for a friend request, and two different
 * definitions of "your circle" would drift apart within a release.
 */
export async function getShareRecipients(): Promise<Friend[]> {
  const { getMyFriendGraph } = await import("./social");
  const graph = await getMyFriendGraph();
  return graph.friends;
}
