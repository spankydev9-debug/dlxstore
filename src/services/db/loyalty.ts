import type {
  BundleSummary,
  CartRecoveryOffer,
  FlashSaleItem,
  LoyaltySummary,
  LoyaltyTierCode,
  PersonalizedPromotion,
  PointsEntry,
  ReferralSummary,
} from "../../types";
import { isDemoMode, isSupabaseConfigured, supabase } from "./index";

// ---------------------------------------------------------------------------
// DLX Growth & loyalty data layer (Phase 11 / P11)
//
// Points, tiers and referrals are all owned by SECURITY DEFINER RPCs. There is
// deliberately no client path that can mint, inflate or edit a points balance:
// the customer-facing functions are read-only plus a small number of scoped
// writes (apply a code, dismiss a promo, record a cart). `award_points` is not
// granted to `authenticated` at all.
// ---------------------------------------------------------------------------

const notConfigured = () => {
  throw new Error("DLXSTORE is not configured.");
};

/** Points balance, current tier, and progress toward the next tier. */
export async function getLoyaltySummary(): Promise<LoyaltySummary> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("get_loyalty_summary");
    if (error) throw new Error(error.message || "Unable to load your loyalty summary.");
    const row = (Array.isArray(data) ? data[0] : data) as LoyaltySummary | null;
    return {
      tier_code: (row?.tier_code ?? "bronze") as LoyaltyTierCode,
      tier_label: row?.tier_label ?? "Bronze",
      balance: row?.balance ?? 0,
      lifetime_earned: row?.lifetime_earned ?? 0,
      lifetime_redeemed: row?.lifetime_redeemed ?? 0,
      points_to_next_tier: row?.points_to_next_tier ?? 0,
      next_tier_label: row?.next_tier_label ?? "",
      discount_percent: row?.discount_percent ?? 0,
      free_shipping: row?.free_shipping ?? false,
      early_access: row?.early_access ?? false,
      points_multiplier: row?.points_multiplier ?? 1,
      referral_code: row?.referral_code ?? null,
    };
  }

  if (!isDemoMode) notConfigured();
  return {
    tier_code: "bronze",
    tier_label: "Bronze",
    balance: 0,
    lifetime_earned: 0,
    lifetime_redeemed: 0,
    points_to_next_tier: 500,
    next_tier_label: "Silver",
    discount_percent: 0,
    free_shipping: false,
    early_access: false,
    points_multiplier: 1,
    referral_code: null,
  };
}

/** Append-only points activity for the signed-in customer. */
export async function getPointsHistory(limit = 25): Promise<PointsEntry[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("get_points_history", { p_limit: limit });
    if (error) throw new Error(error.message || "Unable to load your points history.");
    return (Array.isArray(data) ? data : []) as PointsEntry[];
  }
  if (!isDemoMode) notConfigured();
  return [];
}

/** The customer's own referral code, created on first request if missing. */
export async function getMyReferralCode(): Promise<string> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("get_referral_code");
    if (error) throw new Error(error.message || "Unable to load your referral code.");
    return (data as string) ?? "";
  }
  if (!isDemoMode) notConfigured();
  return "";
}

/**
 * Apply someone else's referral code to this account.
 * The RPC returns a human-readable outcome rather than raising, because
 * "you already used a code" and "that code does not exist" are both ordinary
 * user-correctable states that belong in the UI, not in an error toast.
 */
export async function applyReferralCode(code: string): Promise<string> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("apply_referral_code", {
      p_code: code.trim(),
    });
    if (error) throw new Error(error.message || "Unable to apply that referral code.");
    return (data as string) ?? "";
  }
  if (!isDemoMode) notConfigured();
  return "ok";
}

/** How many people this customer has referred and how many qualified. */
export async function getReferrals(): Promise<ReferralSummary> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("get_referrals");
    if (error) throw new Error(error.message || "Unable to load your referrals.");
    const row = (Array.isArray(data) ? data[0] : data) as ReferralSummary | null;
    return {
      total: row?.total ?? 0,
      qualified: row?.qualified ?? 0,
      rewarded: row?.rewarded ?? 0,
      code: row?.code ?? "",
      invites: Array.isArray(row?.invites) ? row.invites : [],
    };
  }
  if (!isDemoMode) notConfigured();
  return { total: 0, qualified: 0, rewarded: 0, code: "", invites: [] };
}

/**
 * Flash sales are catalogue-adjacent marketing data and are readable before
 * sign-in, so this one deliberately falls back to an empty list rather than
 * throwing when Supabase is unavailable.
 */
export async function getActiveFlashSales(): Promise<FlashSaleItem[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("get_active_flash_sales");
    if (error) throw new Error(error.message || "Unable to load flash sales.");
    return (Array.isArray(data) ? data : []) as FlashSaleItem[];
  }
  if (!isDemoMode) notConfigured();
  return [];
}

export async function getActiveBundles(): Promise<BundleSummary[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("get_active_bundles");
    if (error) throw new Error(error.message || "Unable to load bundles.");
    return (Array.isArray(data) ? data : []) as BundleSummary[];
  }
  if (!isDemoMode) notConfigured();
  return [];
}

/** Promotions targeted at this customer's tier, minus anything dismissed. */
export async function getPersonalizedPromotions(): Promise<PersonalizedPromotion[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("get_personalized_promotions");
    if (error) throw new Error(error.message || "Unable to load your offers.");
    return (Array.isArray(data) ? data : []) as PersonalizedPromotion[];
  }
  if (!isDemoMode) notConfigured();
  return [];
}

/** Hide a promotion. Scoped to the caller's own rows by the RPC. */
export async function dismissPromotion(promotionId: string): Promise<boolean> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("dismiss_promotion", {
      p_promotion_id: promotionId,
    });
    if (error) throw new Error(error.message || "Unable to dismiss that offer.");
    return Boolean(data);
  }
  if (!isDemoMode) notConfigured();
  return true;
}

/**
 * Record an in-progress cart for abandoned-cart recovery.
 * Fire-and-forget by design: a failed recovery ping must never interrupt
 * shopping, so callers should not await this on a critical path.
 */
export async function trackAbandonedCart(
  items: unknown[],
  subtotal: number,
  couponCode?: string | null,
): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  if (!Array.isArray(items) || items.length === 0 || subtotal <= 0) return false;
  const { error } = await supabase.rpc("track_abandoned_cart", {
    p_items: items,
    p_subtotal: subtotal,
    p_coupon_code: couponCode ?? null,
  });
  if (error) return false;
  return true;
}

/** The customer's own recoverable cart, if it is still inside the window. */
export async function getCartRecoveryOffer(): Promise<CartRecoveryOffer | null> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("get_cart_recovery_offer");
    if (error) return null;
    const row = (Array.isArray(data) ? data[0] : data) as CartRecoveryOffer | null;
    return row ?? null;
  }
  return null;
}

/** Called after a successful checkout: the cart is no longer abandoned. */
export async function markCartRecovered(): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  const { error } = await supabase.rpc("mark_cart_recovered");
  if (error) return false;
  return true;
}
