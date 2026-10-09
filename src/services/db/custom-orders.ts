import { isDemoMode, isSupabaseConfigured, supabase } from "./index";
import type {
  CustomOrderContactPreference,
  CustomOrderQuote,
  CustomOrderRequest,
  CustomOrderReviewItem,
  CustomOrderStatus,
} from "../../types";

// ---------------------------------------------------------------------------
// DLX Custom orders & quotations data layer
//
// A customer describes a product DLXSTORE does not stock, attaches reference
// images, and the DLX team replies with a quotation. Every read and write goes
// through a SECURITY DEFINER RPC from 20261021090000_custom_orders.sql.
//
// Two rules are load-bearing, not decoration:
//   * The customer never authors a price. Quotations are written only by
//     `submit_custom_order_quote`, which is admin/staff-gated in the database.
//   * A price is never invented client-side. `budget_cents` is the customer's
//     own optional hint; a quote's `price_cents` is always a reviewer's number.
//
// If the migration is unapplied, reads return empty and mutations throw
// `CustomOrdersUnavailableError`, so the surrounding UI degrades honestly.
// ---------------------------------------------------------------------------

/** Thrown when the custom-order RPCs are missing, i.e. the migration is unapplied. */
export class CustomOrdersUnavailableError extends Error {
  constructor(message = "Custom orders are not available yet.") {
    super(message);
    this.name = "CustomOrdersUnavailableError";
  }
}

const MAX_REFERENCE_IMAGES = 6;
/** Mirrors the RPC guard so the UI refuses before a round-trip. */
export const CUSTOM_ORDER_MAX_IMAGES = MAX_REFERENCE_IMAGES;

function isMissingRpc(error: { code?: string; message?: string }): boolean {
  const code = error.code ?? "";
  if (code === "PGRST202" || code === "42883" || code === "42P01" || code === "42703") {
    return true;
  }
  const message = error.message ?? "";
  return /could not find the function/i.test(message) || /does not exist/i.test(message);
}

function rethrow(error: { code?: string; message?: string }): never {
  if (isMissingRpc(error)) throw new CustomOrdersUnavailableError();
  throw new Error(error.message || "Custom orders are unavailable right now.");
}

// ---------------------------------------------------------------------------
// Reference media upload
// ---------------------------------------------------------------------------

const BUCKET = "custom-order-media";
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * Upload one reference image for a custom-order request to the public
 * `custom-order-media` bucket, under the caller's own folder. Returns the
 * public URL. Throws a readable error on an unsupported or oversized file so
 * the form can surface it inline rather than silently dropping the attachment.
 */
export async function uploadCustomOrderImage(userId: string, file: File): Promise<string> {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error("Only JPEG, PNG, and WebP images are supported.");
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error("Reference images must be 5 MB or smaller.");
  }
  if (!isSupabaseConfigured || !supabase) {
    if (!isDemoMode) {
      throw new Error("Image upload requires Supabase Storage configuration.");
    }
    // Demo mode: a local object URL is enough to preview the attachment.
    return URL.createObjectURL(file);
  }

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  if (!data.publicUrl) throw new Error("Could not resolve uploaded image URL.");
  return data.publicUrl;
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function mapQuote(value: unknown): CustomOrderQuote {
  const q = value as Record<string, unknown>;
  return {
    id: String(q.id),
    price_cents: Number(q.price_cents ?? 0),
    message: (q.message as string) ?? null,
    status: (q.status as CustomOrderQuote["status"]) ?? "sent",
    created_at: String(q.created_at ?? ""),
  };
}

function mapRequest(row: Record<string, unknown>): CustomOrderRequest {
  const quotesRaw = row.quotes;
  const quotes = Array.isArray(quotesRaw) ? (quotesRaw as unknown[]).map(mapQuote) : [];
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    details: String(row.details ?? ""),
    budget_cents: row.budget_cents === null || row.budget_cents === undefined ? null : Number(row.budget_cents),
    contact_preference: (row.contact_preference as CustomOrderContactPreference) ?? "chat",
    reference_image_urls: Array.isArray(row.reference_image_urls) ? (row.reference_image_urls as string[]) : [],
    status: (row.status as CustomOrderStatus) ?? "open",
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
    quotes,
  };
}

function mapReviewItem(row: Record<string, unknown>): CustomOrderReviewItem {
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    details: String(row.details ?? ""),
    budget_cents: row.budget_cents === null || row.budget_cents === undefined ? null : Number(row.budget_cents),
    contact_preference: (row.contact_preference as CustomOrderContactPreference) ?? "chat",
    reference_image_urls: Array.isArray(row.reference_image_urls) ? (row.reference_image_urls as string[]) : [],
    status: (row.status as CustomOrderStatus) ?? "open",
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
    customer_id: String(row.customer_id ?? ""),
    customer_name: String(row.customer_name ?? "Client"),
    quote_count: Number(row.quote_count ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The caller's own requests, newest first, each with its quotes. */
export async function getMyCustomOrders(limit = 50): Promise<CustomOrderRequest[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("get_my_custom_order_requests", { p_limit: limit });
    if (error) {
      if (isMissingRpc(error)) return [];
      throw new Error(error.message || "Could not load your requests.");
    }
    return (Array.isArray(data) ? data : []).map((row) => mapRequest(row as Record<string, unknown>));
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  return [];
}

/**
 * The reviewer queue (admin/staff). Optional status filter (empty = all).
 * Throws `CustomOrdersUnavailableError` when the migration is unapplied, and an
 * access error when a non-reviewer calls it.
 */
export async function listCustomOrdersForReview(
  status: CustomOrderStatus | "" = "",
  limit = 100,
): Promise<CustomOrderReviewItem[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("list_custom_order_requests", {
      p_status: status || null,
      p_limit: limit,
    });
    if (error) rethrow(error);
    return (Array.isArray(data) ? data : []).map((row) => mapReviewItem(row as Record<string, unknown>));
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  return [];
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface CreateCustomOrderInput {
  title: string;
  details: string;
  budgetCents?: number | null;
  contactPreference?: CustomOrderContactPreference;
  referenceImageUrls?: string[];
}

/** Submit a new custom-order request. Returns the new request id. */
export async function createCustomOrder(input: CreateCustomOrderInput): Promise<string> {
  if (isSupabaseConfigured && supabase) {
    const images = input.referenceImageUrls ?? [];
    if (images.length > MAX_REFERENCE_IMAGES) {
      throw new Error(`You can attach up to ${MAX_REFERENCE_IMAGES} reference images.`);
    }
    const { data, error } = await supabase.rpc("create_custom_order_request", {
      p_title: input.title,
      p_details: input.details,
      p_budget_cents: input.budgetCents ?? null,
      p_contact_preference: input.contactPreference ?? "chat",
      p_reference_image_urls: images,
    });
    if (error) rethrow(error);
    return String(data);
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  throw new CustomOrdersUnavailableError();
}

/** Reviewer: send a quotation for a request. Returns the new quote id. */
export async function submitCustomOrderQuote(
  requestId: string,
  priceCents: number,
  message?: string,
): Promise<string> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("submit_custom_order_quote", {
      p_request_id: requestId,
      p_price_cents: priceCents,
      p_message: message ?? null,
    });
    if (error) rethrow(error);
    return String(data);
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  throw new CustomOrdersUnavailableError();
}

/** Customer: accept or decline a quotation they received. */
export async function respondToCustomOrderQuote(quoteId: string, accept: boolean): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.rpc("respond_custom_order_quote", {
      p_quote_id: quoteId,
      p_accept: accept,
    });
    if (error) rethrow(error);
    return;
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  throw new CustomOrdersUnavailableError();
}

/** Advance a request's status. Reviewers may set most states; a customer may only cancel. */
export async function setCustomOrderStatus(requestId: string, status: CustomOrderStatus): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.rpc("set_custom_order_request_status", {
      p_request_id: requestId,
      p_status: status,
    });
    if (error) rethrow(error);
    return;
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  throw new CustomOrdersUnavailableError();
}
