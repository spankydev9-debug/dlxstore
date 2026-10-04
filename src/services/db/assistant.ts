import { isDemoMode, isSupabaseConfigured, supabase } from "./index";
import type { AssistantConversation, AssistantTurn } from "../../types";

// ---------------------------------------------------------------------------
// DLX AI Shopping Assistant — conversation persistence (client side)
// ---------------------------------------------------------------------------
// Retrieval happens server-side in `services/server/assistant.ts` and is never
// duplicated here: the browser must not talk to the catalogue-search RPC directly,
// because the answer must be produced in exactly one place.
//
// This layer only persists turns through `append_assistant_turn()`, the single
// write path. That RPC re-validates ownership, bounds the message, rate limits,
// and filters product ids against the real catalogue — so a crafted client cannot
// make the assistant recommend a product that is not buyable.
// ---------------------------------------------------------------------------

/** Thrown when the assistant RPCs are missing, i.e. the migration is unapplied. */
export class AssistantHistoryUnavailableError extends Error {
  constructor(message = "Assistant history is not available yet.") {
    super(message);
    this.name = "AssistantHistoryUnavailableError";
  }
}

const DEMO_TURNS_KEY = "dlxstore_assistant_turns";

function isMissingRpc(error: { code?: string; message?: string }): boolean {
  const code = error.code ?? "";
  if (code === "PGRST202" || code === "42883" || code === "42P01" || code === "42703") {
    return true;
  }
  const message = error.message ?? "";
  return /could not find the function/i.test(message) || /does not exist/i.test(message);
}

export type AskResult = {
  message: string;
  products: {
    id: string;
    name: string;
    slug: string;
    brand: string;
    price: number;
    discount_price: number | null;
    image_url: string | null;
  }[];
  source: "ai" | "deterministic";
};

/**
 * Ask the assistant. Goes through the server route so retrieval logic and any
 * future provider credential stay off the client.
 */
export async function askAssistant(question: string): Promise<AskResult> {
  const response = await fetch("/api/assistant/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || "The assistant could not answer right now.");
  }
  return (await response.json()) as AskResult;
}

function mapTurn(row: unknown): AssistantTurn {
  const r = row as Record<string, unknown>;
  return {
    id: String(r.id),
    role: r.role === "assistant" ? "assistant" : "user",
    message: String(r.message ?? ""),
    product_ids: Array.isArray(r.product_ids) ? (r.product_ids as string[]) : [],
    source: r.source === "ai" ? "ai" : "deterministic",
    created_at: String(r.created_at ?? ""),
  };
}

/** The customer's recent conversations. Empty rather than throwing when unapplied. */
export async function getAssistantConversations(
  limit = 20,
): Promise<AssistantConversation[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("get_my_assistant_conversations", {
      p_limit: limit,
    });
    if (error) {
      if (isMissingRpc(error)) return [];
      throw new Error(error.message);
    }
    return (Array.isArray(data) ? data : []).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: String(r.id),
        title: (r.title as string) ?? null,
        created_at: String(r.created_at ?? ""),
        updated_at: String(r.updated_at ?? ""),
      };
    });
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  return [];
}

/** Every turn in one conversation, oldest first. Empty when unapplied. */
export async function getAssistantTurns(conversationId: string): Promise<AssistantTurn[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("get_assistant_turns", {
      p_conversation_id: conversationId,
    });
    if (error) {
      if (isMissingRpc(error)) return [];
      throw new Error(error.message);
    }
    return (Array.isArray(data) ? data : []).map(mapTurn);
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  return [];
}

/**
 * Start a conversation. Returns null in demo mode, where there is no server to
 * mint an id; the caller keeps turns locally instead.
 */
export async function startAssistantConversation(
  title?: string,
): Promise<string | null> {
  if (!isSupabaseConfigured || !supabase) {
    if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
    return null;
  }
  const { data, error } = await supabase
    .from("assistant_conversations")
    .insert({ title: title ?? null })
    .select("id")
    .single();
  if (error) {
    if (isMissingRpc(error)) return null;
    throw new Error(error.message);
  }
  return String(data?.id ?? "");
}

/**
 * Persist one turn.
 *
 * Best-effort by contract: a lost turn is a lost line of history, not a failed
 * answer, so the UI shows the answer even when persistence fails.
 */
export async function appendAssistantTurn(args: {
  conversationId: string | null;
  role: "user" | "assistant";
  message: string;
  productIds: string[];
  source: "ai" | "deterministic";
}): Promise<void> {
  if (!args.conversationId) {
    // Demo mode: keep the thread locally so the surface is still testable.
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(DEMO_TURNS_KEY);
      const turns = raw ? (JSON.parse(raw) as AssistantTurn[]) : [];
      turns.push({
        id: `turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: args.role,
        message: args.message,
        product_ids: args.productIds,
        source: args.source,
        created_at: new Date().toISOString(),
      });
      window.localStorage.setItem(DEMO_TURNS_KEY, JSON.stringify(turns.slice(-100)));
    } catch {
      // A full localStorage must not break the assistant.
    }
    return;
  }

  if (!isSupabaseConfigured || !supabase) return;
  const { error } = await supabase.rpc("append_assistant_turn", {
    p_conversation_id: args.conversationId,
    p_role: args.role,
    p_message: args.message,
    p_product_ids: args.productIds,
    p_source: args.source,
  });
  if (error) {
    // Persistence is best-effort, so a rate-limit or schema error is swallowed
    // here rather than replacing the answer the customer already received.
    return;
  }
}
