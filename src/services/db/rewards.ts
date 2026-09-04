import { RewardsSummary } from "../../types";
import { isDemoMode, isSupabaseConfigured, supabase } from "./index";

// ---------------------------------------------------------------------------
// DLX Rewards data layer
// All mutations go through SECURITY DEFINER RPCs — customers cannot
// manipulate purchase counts, share scores, coupon values, or reward status.
// ---------------------------------------------------------------------------

/** Fetch the full rewards summary for the signed-in customer. */
export async function getMyRewardsSummary(): Promise<RewardsSummary> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("get_my_rewards_summary");
    if (error) throw new Error(error.message || "Unable to load your rewards.");
    const raw = data as {
      qualifying_order_count: number;
      share_count: number;
      next_purchase_milestone: RewardsSummary["next_purchase_milestone"];
      next_share_milestone: RewardsSummary["next_share_milestone"];
      rewards: RewardsSummary["rewards"];
    };
    return {
      qualifying_order_count: raw.qualifying_order_count ?? 0,
      share_count: raw.share_count ?? 0,
      next_purchase_milestone: raw.next_purchase_milestone ?? null,
      next_share_milestone: raw.next_share_milestone ?? null,
      rewards: Array.isArray(raw.rewards) ? raw.rewards : [],
    };
  }

  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");

  // Demo fallback — returns empty summary
  return {
    qualifying_order_count: 0,
    share_count: 0,
    next_purchase_milestone: null,
    next_share_milestone: null,
    rewards: [],
  };
}

export type ShareChannel = "web" | "whatsapp" | "copy_link" | "native_share";

export interface ShareResult {
  recorded: boolean;
  reason?: string;
  awarded: boolean;
  share_count?: number;
}

/**
 * Record a legitimate share event (server-side, anti-abuse protected).
 * The RPC enforces a 24 h cooldown per channel per customer.
 */
export async function recordShareEvent(channel: ShareChannel = "web"): Promise<ShareResult> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("record_share_event", {
      p_channel: channel,
    });
    if (error) throw new Error(error.message || "Unable to record the share event.");
    return data as ShareResult;
  }

  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");

  // Demo: always succeeds once, no persistence
  return { recorded: true, awarded: false, share_count: 1 };
}
