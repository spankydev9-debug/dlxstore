import type { Campaign, Coupon } from "../../types";
import { getCoupons } from "./coupons";
import { isDemoMode, isSupabaseConfigured, supabase } from "./index";

// ---------------------------------------------------------------------------
// Campaigns — one data layer for the `campaigns` table
//
// The table, its grants and both RLS policies ship in 20261014090000 (P11 Growth
// & loyalty, applied to production). P11 built the schema and P13 built the send
// path on top of it, but nothing could create or edit a campaign, and no customer
// surface read one. Both gaps live here rather than in a second copy of the table.
//
// Writes go straight to the table: "Admins manage campaigns" is a `FOR ALL`
// policy gated by `public.is_admin()`, so the database — not this file — decides
// who may write. `message_campaign` delivery still belongs to P13 (`messaging.ts`).
//
// Demo mode returns no rows. A launch banner that promises 15% off a store with
// no such campaign is the exact fabrication this project rules out.
// ---------------------------------------------------------------------------

const CAMPAIGN_COLUMNS =
  "id, name, slug, description, channel, segment, discount_percent, min_order, coupon_code, starts_at, ends_at, is_active, created_at";

/**
 * `campaigns_channel_check` and `campaigns_segment_check` on production, copied
 * exactly. The admin form builds its options from these and the validator rejects
 * anything else, so one list keeps both ends honest.
 */
export const CAMPAIGN_CHANNELS = ["in_app", "whatsapp", "push", "email"] as const;
export const CAMPAIGN_SEGMENTS = ["all", "vip", "gold", "new", "inactive", "birthday"] as const;

/** Postgres `numeric` arrives as a string over the wire. */
const num = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const optNum = (value: unknown): number | null =>
  value === null || value === undefined ? null : num(value);

const str = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

function mapCampaign(row: Record<string, unknown>): Campaign {
  return {
    id: str(row.id),
    name: str(row.name),
    slug: str(row.slug),
    description: (row.description as string) ?? null,
    channel: str(row.channel, "in_app"),
    segment: str(row.segment, "all"),
    discount_percent: optNum(row.discount_percent),
    min_order: num(row.min_order),
    coupon_code: (row.coupon_code as string) ?? null,
    starts_at: (row.starts_at as string) ?? null,
    ends_at: (row.ends_at as string) ?? null,
    is_active: row.is_active === true,
    created_at: (row.created_at as string) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Admin reads and writes
// ---------------------------------------------------------------------------

export async function getCampaigns(): Promise<Campaign[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("campaigns")
      .select(CAMPAIGN_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message || "Unable to load campaigns.");
    return ((data ?? []) as Record<string, unknown>[]).map(mapCampaign);
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  return [];
}

export interface CampaignInput {
  name: string;
  slug: string;
  description: string | null;
  channel: string;
  segment: string;
  discount_percent: number | null;
  min_order: number;
  coupon_code: string | null;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
}

/**
 * The CHECK constraints on `campaigns`, mirrored so an admin gets one clear
 * message instead of a Postgres error. The database still enforces all of them —
 * this only moves the rejection earlier, never weaker.
 */
export function validateCampaign(input: CampaignInput): string | null {
  if (!input.name.trim()) return "Give the campaign a name.";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug.trim()))
    return "The slug needs to be lowercase, with single hyphens between words.";
  if (!CAMPAIGN_CHANNELS.includes(input.channel as (typeof CAMPAIGN_CHANNELS)[number]))
    return "Choose one of the delivery channels the database accepts.";
  if (!CAMPAIGN_SEGMENTS.includes(input.segment as (typeof CAMPAIGN_SEGMENTS)[number]))
    return "Choose one of the audience segments the database accepts.";
  if (!input.starts_at || !input.ends_at) return "Set both a start and an end date.";
  if (Date.parse(input.ends_at) <= Date.parse(input.starts_at))
    return "The end date has to come after the start date.";
  if (input.discount_percent !== null && (input.discount_percent <= 0 || input.discount_percent > 90))
    return "A discount must be between 1% and 90%.";
  if (!Number.isFinite(input.min_order) || input.min_order < 0)
    return "The minimum order must be 0 or more.";
  if (input.channel === "in_app" && input.discount_percent === null && !input.coupon_code?.trim())
    return "An in-app banner needs a discount or a coupon code, otherwise it offers nothing.";
  return null;
}

/**
 * The rule this project will not bend: a banner may only advertise a saving the
 * coupon actually delivers. Every check below compares what the campaign says
 * against what the coupon row can honour, so an admin is stopped at the form
 * instead of misleading the customer at checkout.
 */
export function describeCouponProblem(coupon: Coupon | null, input: CampaignInput): string | null {
  const code = input.coupon_code?.trim();
  if (!code) return null;
  if (!coupon)
    return `No coupon named ${code} exists. Create it under Coupons & Promotions first — a campaign may only advertise a real code.`;
  if (!coupon.active) return `Coupon ${code} is switched off, so nothing it promises can be redeemed.`;
  if (coupon.expires_at && Date.parse(coupon.expires_at) < Date.now())
    return `Coupon ${code} expired on ${coupon.expires_at.slice(0, 10)}. Renew it or drop the code from this campaign.`;
  if (coupon.max_uses != null && coupon.used_count >= coupon.max_uses)
    return `Coupon ${code} has used up all ${coupon.max_uses} of its redemptions.`;
  if (coupon.expires_at && input.ends_at && Date.parse(coupon.expires_at) < Date.parse(input.ends_at))
    return `Coupon ${code} expires on ${coupon.expires_at.slice(0, 10)}, before this campaign ends. Shorten the campaign or renew the coupon.`;
  if (input.discount_percent !== null) {
    if (coupon.type !== "percentage")
      return `The banner states ${input.discount_percent}% off, but coupon ${code} is a fixed-amount coupon.`;
    if (Math.round(coupon.value) !== Math.round(input.discount_percent))
      return `The banner states ${input.discount_percent}% off, but coupon ${code} gives ${coupon.value}%.`;
  }
  return null;
}

async function assertAdvertisedCoupon(input: CampaignInput): Promise<void> {
  const code = input.coupon_code?.trim();
  if (!code) return;
  // Reads every coupon, inactive ones included: an off switch is exactly what
  // this guard has to see.
  const coupons = await getCoupons(true);
  const coupon = coupons.find((row) => row.code.trim().toUpperCase() === code.toUpperCase()) ?? null;
  const problem = describeCouponProblem(coupon, input);
  if (problem) throw new Error(problem);
}

export async function saveCampaign(input: CampaignInput): Promise<Campaign> {
  const invalid = validateCampaign(input);
  if (invalid) throw new Error(invalid);

  if (isSupabaseConfigured && supabase) {
    await assertAdvertisedCoupon(input);
    const { data, error } = await supabase
      .from("campaigns")
      .insert({
        name: input.name.trim(),
        slug: input.slug.trim(),
        description: input.description?.trim() || null,
        channel: input.channel,
        segment: input.segment,
        discount_percent: input.discount_percent,
        min_order: input.min_order,
        coupon_code: input.coupon_code?.trim() || null,
        starts_at: input.starts_at,
        ends_at: input.ends_at,
        is_active: input.is_active,
      })
      .select(CAMPAIGN_COLUMNS)
      .single();
    if (error) throw new Error(describeWriteError(error.message, "created"));
    return mapCampaign(data as Record<string, unknown>);
  }
  throw new Error("DLXSTORE is not configured.");
}

export async function updateCampaign(id: string, input: CampaignInput): Promise<Campaign> {
  const invalid = validateCampaign(input);
  if (invalid) throw new Error(invalid);

  if (isSupabaseConfigured && supabase) {
    await assertAdvertisedCoupon(input);
    const { data, error } = await supabase
      .from("campaigns")
      .update({
        name: input.name.trim(),
        slug: input.slug.trim(),
        description: input.description?.trim() || null,
        channel: input.channel,
        segment: input.segment,
        discount_percent: input.discount_percent,
        min_order: input.min_order,
        coupon_code: input.coupon_code?.trim() || null,
        starts_at: input.starts_at,
        ends_at: input.ends_at,
        is_active: input.is_active,
      })
      .eq("id", id)
      .select(CAMPAIGN_COLUMNS)
      .maybeSingle();
    if (error) throw new Error(describeWriteError(error.message, "updated"));
    if (!data) throw new Error("This campaign no longer exists.");
    return mapCampaign(data as Record<string, unknown>);
  }
  throw new Error("DLXSTORE is not configured.");
}

/**
 * A rejected write reaches the customer as a policy denial, not a stack trace.
 * Postgres reports an RLS-blocked `UPDATE` as zero affected rows, so both shapes
 * are turned into the same honest sentence.
 */
function describeWriteError(message: string, tense: "created" | "updated"): string {
  if (/row-level security|permission denied|new row violates/i.test(message))
    return "Only an admin can change campaigns.";
  if (/campaigns_coupon_code_fkey|foreign key constraint/i.test(message))
    return "That coupon code does not exist yet. Create it under Coupons & Promotions first — a campaign may only advertise a real code.";
  if (/duplicate key/i.test(message))
    return "Another campaign already uses this slug — the URL identifier must be unique.";
  if (/check constraint/i.test(message))
    return "The campaign was rejected by the database rules. Check the dates and the discount.";
  return `Campaign could not be ${tense}: ${message}`;
}

// ---------------------------------------------------------------------------
// Customer-facing reads
// ---------------------------------------------------------------------------

/**
 * A campaign inside its date window. Deliberately not `is_active` alone: the
 * read policy returns every active row to every visitor, so a campaign scheduled
 * for next week would otherwise publish its coupon code early.
 */
export function isCampaignLive(campaign: Campaign, now = Date.now()): boolean {
  if (!campaign.is_active) return false;
  if (campaign.starts_at && Date.parse(campaign.starts_at) > now) return false;
  if (campaign.ends_at && Date.parse(campaign.ends_at) < now) return false;
  return true;
}

/**
 * Banners for the storefront: active `in_app` campaigns that are live right now,
 * soonest-ending first so the offer the customer would lose soonest is on top.
 *
 * The window is evaluated in the browser because there is no server-side read for
 * it, so a skewed clock can only show or hide a banner early — the discount
 * itself is still recomputed by `apply_coupon_on_order` at checkout.
 */
export async function getLiveInAppCampaigns(): Promise<Campaign[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("campaigns")
      .select(CAMPAIGN_COLUMNS)
      .eq("channel", "in_app")
      .eq("is_active", true)
      .order("ends_at", { ascending: true })
      .limit(10);
    if (error) throw new Error(error.message || "Unable to load offers.");
    return ((data ?? []) as Record<string, unknown>[])
      .map(mapCampaign)
      .filter((campaign) => isCampaignLive(campaign));
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  return [];
}
