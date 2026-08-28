import { Product, SessionProduct, StoreSession } from "../../types";
import { initMockDb, isDemoMode, isSupabaseConfigured, supabase } from "./index";

type SessionFields = Omit<StoreSession, "id" | "created_at">;

/**
 * True when a Supabase/PostgREST error means the table does not exist yet
 * (e.g. before the Phase 2 migration is applied). The storefront must treat
 * this as an empty/no-data result instead of throwing a console error.
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

function readMockSessions(): StoreSession[] {
  initMockDb();
  return JSON.parse(localStorage.getItem("dlxstore_sessions") || "[]") as StoreSession[];
}

function writeMockSessions(sessions: StoreSession[]) {
  localStorage.setItem("dlxstore_sessions", JSON.stringify(sessions));
}

// --------------------------------------------------------------------------
// Sessions (collections)
// --------------------------------------------------------------------------

export async function getSessions(options: { includeInactive?: boolean } = {}): Promise<StoreSession[]> {
  if (isSupabaseConfigured && supabase) {
    let query = supabase.from("sessions").select("*").order("display_order", { ascending: true }).order("name", { ascending: true });
    if (!options.includeInactive) query = query.eq("is_active", true);
    const { data, error } = await query;
    if (error) {
      if (isTableMissing(error)) return [];
      throw new Error(error.message || "An error occurred.");
    }
    return (data ?? []) as StoreSession[];
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  const sessions = readMockSessions();
  return options.includeInactive ? sessions : sessions.filter((s) => s.is_active !== false);
}

export async function getSessionBySlug(slug: string): Promise<StoreSession | null> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.from("sessions").select("*").eq("slug", slug).maybeSingle();
    if (error) {
      if (isTableMissing(error)) return null;
      throw new Error(error.message || "An error occurred.");
    }
    return (data as StoreSession) ?? null;
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  return readMockSessions().find((s) => s.slug === slug) ?? null;
}

export async function createSession(fields: Partial<SessionFields>): Promise<StoreSession> {
  const payload = {
    name: fields.name ?? "",
    slug: fields.slug ?? "",
    description: fields.description ?? null,
    image_url: fields.image_url ?? null,
    is_active: fields.is_active ?? true,
    display_order: fields.display_order ?? 0,
    starts_at: fields.starts_at ?? null,
    ends_at: fields.ends_at ?? null,
  };
  if (!payload.name.trim()) throw new Error("Session name is required.");
  if (!payload.slug.trim()) throw new Error("Session slug is required.");

  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.from("sessions").insert(payload).select().single();
    if (error) throw new Error(error.message || "An error occurred.");
    return data as StoreSession;
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  const sessions = readMockSessions();
  const session: StoreSession = { ...(payload as StoreSession), id: `session-${crypto.randomUUID()}`, created_at: new Date().toISOString() };
  writeMockSessions([...sessions, session]);
  return session;
}

export async function updateSession(id: string, fields: Partial<SessionFields>): Promise<StoreSession> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.from("sessions").update(fields).eq("id", id).select().single();
    if (error) throw new Error(error.message || "An error occurred.");
    return data as StoreSession;
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  const sessions = readMockSessions();
  const index = sessions.findIndex((s) => s.id === id);
  if (index === -1) throw new Error("Session not found.");
  sessions[index] = { ...sessions[index], ...fields };
  writeMockSessions(sessions);
  return sessions[index];
}

export async function deleteSession(id: string): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.from("sessions").delete().eq("id", id);
    if (error) throw new Error(error.message || "An error occurred.");
    return;
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  writeMockSessions(readMockSessions().filter((s) => s.id !== id));
}

export async function reorderSessions(sessionIds: string[]): Promise<void> {
  const client = supabase;
  if (isSupabaseConfigured && client) {
    const results = await Promise.all(sessionIds.map((id, index) => client.from("sessions").update({ display_order: index }).eq("id", id)));
    const failure = results.find((r) => r.error)?.error;
    if (failure) throw failure;
    return;
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  const sessions = readMockSessions();
  const order = new Map(sessionIds.map((id, index) => [id, index]));
  writeMockSessions(sessions.map((s) => ({ ...s, display_order: order.get(s.id) ?? s.display_order ?? 0 })));
}

// --------------------------------------------------------------------------
// Session product membership (session_products)
// --------------------------------------------------------------------------

export async function getSessionProducts(sessionId: string): Promise<SessionProduct[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("session_products")
      .select("*")
      .eq("session_id", sessionId)
      .order("display_order", { ascending: true });
    if (error) {
      if (isTableMissing(error)) return [];
      throw new Error(error.message || "An error occurred.");
    }
    return (data ?? []) as SessionProduct[];
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  const rows = JSON.parse(localStorage.getItem(`dlxstore_session_products_${sessionId}`) || "[]") as SessionProduct[];
  return rows.sort((a, b) => a.display_order - b.display_order);
}

export async function getProductIdsForSession(sessionId: string): Promise<string[]> {
  const rows = await getSessionProducts(sessionId);
  return rows.map((r) => r.product_id);
}

export async function addProductToSession(sessionId: string, productId: string, displayOrder?: number): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.from("session_products").upsert(
      { session_id: sessionId, product_id: productId, display_order: displayOrder ?? 0 },
    );
    if (error) throw new Error(error.message || "An error occurred.");
    return;
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  const rows = await getSessionProducts(sessionId);
  const existing = rows.find((r) => r.product_id === productId);
  if (existing) return;
  const next = [...rows, { session_id: sessionId, product_id: productId, display_order: displayOrder ?? rows.length, created_at: new Date().toISOString() }];
  localStorage.setItem(`dlxstore_session_products_${sessionId}`, JSON.stringify(next));
}

export async function removeProductFromSession(sessionId: string, productId: string): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.from("session_products").delete().eq("session_id", sessionId).eq("product_id", productId);
    if (error) throw new Error(error.message || "An error occurred.");
    return;
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  const rows = await getSessionProducts(sessionId);
  localStorage.setItem(`dlxstore_session_products_${sessionId}`, JSON.stringify(rows.filter((r) => r.product_id !== productId)));
}

export async function reorderSessionProducts(sessionId: string, productIds: string[]): Promise<void> {
  const client = supabase;
  if (isSupabaseConfigured && client) {
    const results = await Promise.all(productIds.map((productId, index) => client.from("session_products").update({ display_order: index }).eq("session_id", sessionId).eq("product_id", productId)));
    const failure = results.find((r) => r.error)?.error;
    if (failure) throw failure;
    return;
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  const rows = await getSessionProducts(sessionId);
  const order = new Map(productIds.map((id, index) => [id, index]));
  localStorage.setItem(`dlxstore_session_products_${sessionId}`, JSON.stringify(rows.map((r) => ({ ...r, display_order: order.get(r.product_id) ?? r.display_order }))));
}

export async function getProductsForSession(sessionId: string): Promise<Product[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("session_products")
      .select(`product_id, display_order, products(*, product_images(image_url, is_primary, display_order))`)
      .eq("session_id", sessionId)
      .order("display_order", { ascending: true });
    if (error) {
      if (isTableMissing(error)) return [];
      throw new Error(error.message || "An error occurred.");
    }

    const rows = ((data ?? []) as unknown) as Array<{
      product_id: string;
      display_order: number;
      products: Record<string, unknown> & { product_images?: Array<{ image_url: string; is_primary: boolean; display_order: number }> | null } | null;
    }>;

    return rows
      .map((row): Product | null => {
        const p = row.products;
        if (!p) return null;
        const { product_images, ...rest } = p;
        return {
          ...rest,
          images: (product_images ?? [])
            .sort((a, b) => a.display_order - b.display_order)
            .map((img) => img.image_url),
        } as Product;
      })
      .filter((p): p is Product => p !== null)
      .filter((p) => p.is_active !== false && p.is_archived !== true);
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  const ids = await getProductIdsForSession(sessionId);
  const localRaw = localStorage.getItem("dlxstore_products");
  const all: Product[] = localRaw ? JSON.parse(localRaw) : [];
  const byId = new Map(all.map((p) => [p.id, p]));
  const ordered = ids.map((id) => byId.get(id)).filter((p): p is Product => Boolean(p));
  return ordered.filter((p) => p.is_active !== false && p.is_archived !== true);
}
