import { supabase, isSupabaseConfigured } from "./index";

export type FeedbackCategory = "bug" | "order_delivery" | "product" | "payment" | "suggestion" | "other";
export type FeedbackStatus = "new" | "in_review" | "resolved";

export interface Feedback {
  id: string;
  profile_id: string | null;
  category: FeedbackCategory;
  message: string;
  status: FeedbackStatus;
  device_info: string | null;
  screenshot_url: string | null;
  ip_address: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface CreateFeedbackInput {
  category: FeedbackCategory;
  message: string;
  device_info?: string | null;
  screenshot_url?: string | null;
  metadata?: Record<string, unknown> | null;
  /**
   * The signed-in customer's `profiles.id`, when there is one. Feedback accepts
   * guests and members alike, so this stays optional: sending it links the row
   * to the submitter (the "own feedback" RLS policy matches on it), while a
   * guest submission is stored with `profile_id = NULL` and no extra identity
   * is collected. Never send an email/phone just to fill the column.
   */
  profile_id?: string | null;
}

/**
 * Raised when the `feedback` table has not been created yet (migration
 * `20261028090000_feedback_system.sql` unapplied). Distinct from a generic
 * failure so the UI can say "not available yet" instead of surfacing a raw
 * PostgREST message to the customer.
 */
export class FeedbackUnavailableError extends Error {
  constructor() {
    super("Feedback is not available on this installation yet.");
    this.name = "FeedbackUnavailableError";
  }
}

/**
 * True when a Supabase/PostgREST error means the table does not exist yet.
 * Mirrors `isTableMissing` in `sessions.ts`/`food.ts` so the whole data layer
 * treats "migration not applied" the same way: a clear, non-scary state rather
 * than an exception carrying the raw server text to the browser.
 */
function isTableMissing(error: unknown): boolean {
  const err = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : String(error ?? "");
  const message = error && typeof error === "object" && "message" in error
    ? String((error as { message?: unknown }).message ?? "")
    : "";
  return (
    err === "PGRST205" ||
    err === "42P01" ||
    /Could not find the table/i.test(message) ||
    /relation .* does not exist/i.test(message) ||
    /table .* does not exist/i.test(message)
  );
}

/**
 * Log the real cause once, on the client console, so a developer can still see
 * *why* feedback is unavailable — without putting the server's text in front of
 * the customer. The message is the PostgREST string, which never contains the
 * customer's submitted content.
 */
function reportUnavailable(operation: string, error: unknown): void {
  if (typeof console !== "undefined") {
    console.warn(`[feedback] ${operation} skipped — the feedback table is not available yet.`, error);
  }
}

/** Returns the configured client or throws, narrowing away the null case. */
function requireClient() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase not configured");
  }
  return supabase;
}

export async function createFeedback(input: CreateFeedbackInput): Promise<Feedback> {
  const client = requireClient();

  const { data, error } = await client
    .from("feedback")
    .insert({
      profile_id: input.profile_id ?? null,
      category: input.category,
      message: input.message,
      device_info: input.device_info ?? null,
      screenshot_url: input.screenshot_url ?? null,
      metadata: input.metadata ?? {},
    })
    .select()
    .single();

  if (error) {
    if (isTableMissing(error)) {
      reportUnavailable("createFeedback", error);
      throw new FeedbackUnavailableError();
    }
    throw error;
  }
  return data as Feedback;
}

export async function listFeedbacks(filters?: {
  status?: FeedbackStatus | null;
  category?: FeedbackCategory | null;
}): Promise<Feedback[]> {
  const client = requireClient();

  let query = client
    .from("feedback")
    .select("*")
    .order("created_at", { ascending: false });

  if (filters?.status) {
    query = query.eq("status", filters.status);
  }
  if (filters?.category) {
    query = query.eq("category", filters.category);
  }

  const { data, error } = await query;
  if (error) {
    if (isTableMissing(error)) {
      reportUnavailable("listFeedbacks", error);
      throw new FeedbackUnavailableError();
    }
    throw error;
  }
  return (data ?? []) as Feedback[];
}

export async function updateFeedbackStatus(id: string, status: FeedbackStatus): Promise<Feedback> {
  const client = requireClient();

  const updates: Partial<Feedback> = { status };
  if (status === "resolved") {
    updates.resolved_at = new Date().toISOString();
  }

  const { data, error } = await client
    .from("feedback")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    if (isTableMissing(error)) {
      reportUnavailable("updateFeedbackStatus", error);
      throw new FeedbackUnavailableError();
    }
    throw error;
  }
  return data as Feedback;
}
