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
}

export async function createFeedback(input: CreateFeedbackInput): Promise<Feedback> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase not configured");
  }

  const { data, error } = await supabase
    .from("feedback")
    .insert({
      category: input.category,
      message: input.message,
      device_info: input.device_info ?? null,
      screenshot_url: input.screenshot_url ?? null,
      metadata: input.metadata ?? {},
    })
    .select()
    .single();

  if (error) throw error;
  return data as Feedback;
}

export async function listFeedbacks(filters?: {
  status?: FeedbackStatus | null;
  category?: FeedbackCategory | null;
}): Promise<Feedback[]> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase not configured");
  }

  let query = supabase
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
  if (error) throw error;
  return (data ?? []) as Feedback[];
}

export async function updateFeedbackStatus(id: string, status: FeedbackStatus): Promise<Feedback> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase not configured");
  }

  const updates: Partial<Feedback> = { status };
  if (status === "resolved") {
    updates.resolved_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from("feedback")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data as Feedback;
}

export async function getMyFeedbacks(): Promise<Feedback[]> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase not configured");
  }

  const { data, error } = await supabase
    .from("feedback")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as Feedback[];
}
