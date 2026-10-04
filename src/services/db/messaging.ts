import type {
  CampaignSendResult,
  MarketingAudience,
  MessageOptIns,
  MessageStats,
  MessageTemplate,
  OutboxFilters,
  OutboxRow,
} from "../../types";
import { isDemoMode, isSupabaseConfigured, supabase } from "./index";

// ---------------------------------------------------------------------------
// P13 — Communication & Marketing data layer
//
// Every function here is a thin, typed pass-through to a `SECURITY DEFINER` RPC
// that enforces `public.is_admin()` in SQL. The admin Message Center is not an
// authorization boundary, so the guard lives in the database.
//
// Demo mode returns empty collections rather than fabricated rows. An outbox
// showing "12 delivered" for a shop with no orders teaches an admin to trust a
// number that does not exist.
// ---------------------------------------------------------------------------

const notConfigured = () => {
  throw new Error("DLXSTORE is not configured.");
};

const noMessaging = () => {
  if (!isDemoMode) notConfigured();
};

/** Postgres numeric/bigint arrive as strings over the wire. */
const num = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const str = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const bool = (value: unknown): boolean => value === true;

async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T[]> {
  const { data, error } = await supabase!.rpc(name, args ?? {});
  if (error) throw new Error(error.message || `Unable to load ${name}.`);
  return (Array.isArray(data) ? data : data ? [data] : []) as T[];
}

// ---------------------------------------------------------------------------
// Customer self-service
// ---------------------------------------------------------------------------

const DEFAULT_OPT_INS: MessageOptIns = {
  locale: "fr",
  whatsapp_marketing: false,
  email_marketing: false,
};

function mapOptIns(row: Record<string, unknown> | null): MessageOptIns {
  if (!row) return { ...DEFAULT_OPT_INS };
  return {
    locale: str(row.locale, "fr"),
    whatsapp_marketing: bool(row.whatsapp_marketing),
    email_marketing: bool(row.email_marketing),
  };
}

/**
 * The signed-in customer's own communication preferences.
 *
 * The target is always `auth.uid()`; the RPC takes no profile id, so this cannot
 * read somebody else's consent. Marketing reads `false` before any row exists,
 * which is the safe default: consent is opt-in, never implied.
 */
export async function getMyMessageOptIns(): Promise<MessageOptIns> {
  if (!isSupabaseConfigured) {
    noMessaging();
    return { ...DEFAULT_OPT_INS };
  }

  const { data, error } = await supabase!.rpc("get_my_message_opt_ins");
  if (error) throw new Error(error.message || "Unable to load your preferences.");
  return mapOptIns((data ?? null) as Record<string, unknown> | null);
}

export async function setMyMessageOptIn(
  channel: "whatsapp" | "email",
  enabled: boolean
): Promise<MessageOptIns> {
  if (!isSupabaseConfigured) {
    noMessaging();
    return { ...DEFAULT_OPT_INS };
  }

  const { error } = await supabase!.rpc("set_my_message_opt_in", {
    p_channel: channel,
    p_enabled: enabled,
  });
  if (error) throw new Error(error.message || "Unable to update your preferences.");
  return getMyMessageOptIns();
}

/**
 * Stores the customer's chosen interface language so transactional messages
 * arrive in the language they actually read, not a hardcoded default.
 */
export async function setMyMessageLocale(locale: string): Promise<MessageOptIns> {
  if (!isSupabaseConfigured) {
    noMessaging();
    return { ...DEFAULT_OPT_INS };
  }

  const { error } = await supabase!.rpc("set_my_message_locale", { p_locale: locale });
  if (error) throw new Error(error.message || "Unable to update your language.");
  return getMyMessageOptIns();
}

// ---------------------------------------------------------------------------
// Admin: outbox, stats, campaigns
// ---------------------------------------------------------------------------

function mapOutbox(row: Record<string, unknown>): OutboxRow {
  return {
    id: str(row.id),
    channel: str(row.channel, "in_app") as OutboxRow["channel"],
    template_key: str(row.template_key),
    locale: str(row.locale, "fr"),
    recipient_id: (row.recipient_id as string) ?? null,
    recipient_address: (row.recipient_address as string) ?? null,
    is_transactional: bool(row.is_transactional),
    subject: (row.subject as string) ?? null,
    body: str(row.body),
    status: str(row.status, "pending") as OutboxRow["status"],
    skip_reason: (row.skip_reason as string) ?? null,
    attempts: num(row.attempts),
    max_attempts: num(row.max_attempts),
    last_error: (row.last_error as string) ?? null,
    provider: (row.provider as string) ?? null,
    provider_message_id: (row.provider_message_id as string) ?? null,
    related_type: (row.related_type as string) ?? null,
    related_id: (row.related_id as string) ?? null,
    dedupe_key: (row.dedupe_key as string) ?? null,
    created_at: str(row.created_at),
    claimed_at: (row.claimed_at as string) ?? null,
    next_attempt_at: (row.next_attempt_at as string) ?? null,
    sent_at: (row.sent_at as string) ?? null,
  };
}

/** Most recent outbox rows, newest first. Admin-only. */
export async function getOutbox(filters: OutboxFilters = {}): Promise<OutboxRow[]> {
  if (!isSupabaseConfigured) {
    noMessaging();
    return [];
  }

  const rows = await rpc<Record<string, unknown>>("admin_get_outbox", {
    p_status: filters.status ?? null,
    p_channel: filters.channel ?? null,
    p_limit: Math.min(Math.max(filters.limit ?? 50, 1), 200),
  });
  return rows.map(mapOutbox);
}

const EMPTY_STATS: MessageStats = {
  total: 0,
  sent: 0,
  finished: 0,
  delivery_rate: null,
  skipped_no_consent: 0,
  by_status: {},
  by_channel: {},
};

/**
 * Outbox totals.
 *
 * `delivery_rate` stays null until at least one message reaches a terminal
 * state: a rate computed over zero finished messages would read as either 0% or
 * 100% depending on the divisor and both would be a lie.
 */
export async function getMessageStats(): Promise<MessageStats> {
  if (!isSupabaseConfigured) {
    noMessaging();
    return { ...EMPTY_STATS };
  }

  const [row] = await rpc<Record<string, unknown>>("admin_message_stats");
  if (!row) return { ...EMPTY_STATS };

  return {
    total: num(row.total),
    sent: num(row.sent),
    finished: num(row.finished),
    delivery_rate: row.delivery_rate === null || row.delivery_rate === undefined
      ? null
      : num(row.delivery_rate),
    skipped_no_consent: num(row.skipped_no_consent),
    by_status: (row.by_status as Record<string, number>) ?? {},
    by_channel: (row.by_channel as Record<string, number>) ?? {},
  };
}

/** How many customers a campaign segment matches, and how many opted in. */
export async function getMarketingAudience(
  segment: string,
  channel: "whatsapp" | "email" = "whatsapp"
): Promise<MarketingAudience> {
  if (!isSupabaseConfigured) {
    noMessaging();
    return { segment, total: 0, opted_in: 0 };
  }

  const [row] = await rpc<Record<string, unknown>>("admin_marketing_audience", {
    p_segment: segment,
    p_channel: channel,
  });
  if (!row) return { segment, total: 0, opted_in: 0 };

  return {
    segment: str(row.segment, segment),
    total: num(row.total),
    opted_in: num(row.opted_in),
  };
}

function mapSendResult(campaignId: string, row: Record<string, unknown>, dryRun: boolean): CampaignSendResult {
  return {
    campaign_id: str(row.campaign_id, campaignId),
    matched: num(row.matched),
    queued: num(row.queued),
    skipped: num(row.skipped),
    dry_run: dryRun || bool(row.dry_run),
  };
}

/**
 * Previews a campaign. Queues nothing — `matched` is the reachable audience,
 * `opted_in` is how many of those actually consented.
 */
export async function previewCampaign(campaignId: string): Promise<CampaignSendResult> {
  if (!isSupabaseConfigured) {
    noMessaging();
    return { campaign_id: campaignId, matched: 0, queued: 0, skipped: 0, dry_run: true };
  }

  const { data, error } = await supabase!.rpc("admin_send_campaign", {
    p_campaign_id: campaignId,
    p_dry_run: true,
  });
  if (error) throw new Error(error.message || "Unable to preview this campaign.");
  return mapSendResult(campaignId, (data ?? {}) as Record<string, unknown>, true);
}

/**
 * Queues a campaign for real.
 *
 * Consent is still enforced per recipient, so `queued` can be lower than the
 * segment size; a refusal is recorded as a `skipped` row rather than dropped.
 */
export async function sendCampaign(campaignId: string): Promise<CampaignSendResult> {
  if (!isSupabaseConfigured) {
    noMessaging();
    return { campaign_id: campaignId, matched: 0, queued: 0, skipped: 0, dry_run: false };
  }

  const { data, error } = await supabase!.rpc("admin_send_campaign", {
    p_campaign_id: campaignId,
    p_dry_run: false,
  });
  if (error) throw new Error(error.message || "Unable to send this campaign.");
  return mapSendResult(campaignId, (data ?? {}) as Record<string, unknown>, false);
}

/**
 * Asks the server to run one dispatcher pass.
 *
 * The browser never claims rows itself: claiming reserves a row into `sending`,
 * and without provider credentials the browser could never record a result, so
 * the row would sit there until the stale sweep freed it. Delivery therefore goes
 * through `/api/messaging/dispatch`, which holds the transport and the
 * credentials.
 */
export async function dispatchOnce(
  channel?: string,
  limit = 25
): Promise<Record<string, number>> {
  if (!isSupabaseConfigured) {
    noMessaging();
    return {};
  }

  const { data: sessionData } = await supabase!.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Your session expired. Sign in again.");

  const response = await fetch("/api/messaging/dispatch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ channel: channel ?? null, limit }),
  });

  const payload = (await response.json().catch(() => null)) as
    | { summary?: Record<string, number>; error?: string; detail?: string }
    | null;

  if (!response.ok) {
    throw new Error(payload?.detail || payload?.error || "Unable to run the dispatcher.");
  }
  return payload?.summary ?? {};
}

/** Queues an admin test message to an arbitrary destination. */
export async function enqueueTestMessage(
  channel: string,
  address: string | null,
  templateKey = "campaign.whatsapp"
): Promise<string | null> {
  if (!isSupabaseConfigured) {
    noMessaging();
    return null;
  }

  const { data, error } = await supabase!.rpc("admin_enqueue_test_message", {
    p_channel: channel,
    p_address: address,
    p_template_key: templateKey,
  });
  if (error) throw new Error(error.message || "Unable to queue the test message.");
  return (data as string) ?? null;
}

/** Active templates, for the admin template editor. */
export async function getMessageTemplates(): Promise<MessageTemplate[]> {
  if (!isSupabaseConfigured) {
    noMessaging();
    return [];
  }

  const { data, error } = await supabase!
    .from("message_templates")
    .select("id, template_key, channel, locale, subject, body, is_active, updated_at")
    .order("template_key")
    .order("locale");
  if (error) throw new Error(error.message || "Unable to load templates.");

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: str(row.id),
    template_key: str(row.template_key),
    channel: str(row.channel, "in_app") as MessageTemplate["channel"],
    locale: str(row.locale, "fr"),
    subject: (row.subject as string) ?? null,
    body: str(row.body),
    is_active: bool(row.is_active),
    updated_at: (row.updated_at as string) ?? undefined,
  }));
}

/** Saves one template. `admin_upsert_message_template` re-checks admin in SQL. */
export async function upsertMessageTemplate(input: {
  templateKey: string;
  channel: string;
  locale: string;
  subject: string;
  body: string;
  isActive: boolean;
}): Promise<string | null> {
  if (!isSupabaseConfigured) {
    noMessaging();
    return null;
  }

  const { data, error } = await supabase!.rpc("admin_upsert_message_template", {
    p_template_key: input.templateKey,
    p_channel: input.channel,
    p_locale: input.locale,
    p_subject: input.subject,
    p_body: input.body,
    p_is_active: input.isActive,
  });
  if (error) throw new Error(error.message || "Unable to save the template.");
  return (data as string) ?? null;
}

// ---------------------------------------------------------------------------
// Campaign listing
// ---------------------------------------------------------------------------

/**
 * The minimal campaign shape the Message Center needs. Campaigns are owned by
 * P11 Growth & Loyalty; this reads the existing table (admin-readable through its
 * `is_admin()` policy) rather than duplicating the growth data layer.
 */
export type MessagingCampaign = {
  id: string;
  name: string;
  slug: string;
  channel: string;
  segment: string;
  discount_percent: number | null;
  coupon_code: string | null;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
};

/** A campaign that is currently inside its date window and switched on. */
export function isCampaignLive(campaign: MessagingCampaign): boolean {
  if (!campaign.is_active) return false;
  const now = Date.now();
  if (campaign.starts_at && Date.parse(campaign.starts_at) > now) return false;
  if (campaign.ends_at && Date.parse(campaign.ends_at) < now) return false;
  return true;
}

export async function getCampaigns(): Promise<MessagingCampaign[]> {
  if (!isSupabaseConfigured) {
    noMessaging();
    return [];
  }

  const { data, error } = await supabase!
    .from("campaigns")
    .select("id, name, slug, channel, segment, discount_percent, coupon_code, starts_at, ends_at, is_active")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message || "Unable to load campaigns.");

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: str(row.id),
    name: str(row.name),
    slug: str(row.slug),
    channel: str(row.channel, "whatsapp"),
    segment: str(row.segment, "all"),
    discount_percent: row.discount_percent === null || row.discount_percent === undefined
      ? null
      : num(row.discount_percent),
    coupon_code: (row.coupon_code as string) ?? null,
    starts_at: (row.starts_at as string) ?? null,
    ends_at: (row.ends_at as string) ?? null,
    is_active: bool(row.is_active),
  }));
}
