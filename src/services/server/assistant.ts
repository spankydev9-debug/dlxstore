import "server-only";
import { supabase, isSupabaseConfigured } from "../db/index";

// ---------------------------------------------------------------------------
// DLX AI Shopping Assistant — grounded retrieval (master roadmap area 15)
//
// TRUSTWORTHINESS IS THE WHOLE DESIGN. This module contains no language model and
// no generation step. It answers by searching the real catalogue and returning real
// product rows, so it cannot invent a price, a stock level, or a product.
//
// A language model may later choose *which* recalled ids to present and write the
// phrasing. That adapter belongs behind `AssistantProvider` below and is
// deliberately NOT compiled in: no provider has been selected or credentialed for
// this project, and shipping a fake one would be worse than shipping none.
//
// This is separate from AI Catalog Automation (an admin tool) and from the Fashion
// Studio / Ghost Mannequin renderer (deterministic image composition). No shared
// code path with either.
// ---------------------------------------------------------------------------

export type AssistantProduct = {
  id: string;
  name: string;
  slug: string;
  brand: string;
  price: number;
  discount_price: number | null;
  image_url: string | null;
  stock_quantity: number;
  product_type: string | null;
};

export type AssistantAnswer = {
  message: string;
  products: AssistantProduct[];
  /** `ai` once a provider is configured; `deterministic` until then. */
  source: "ai" | "deterministic";
};

export class AssistantUnavailableError extends Error {
  constructor(message = "The shopping assistant is not available yet.") {
    super(message);
    this.name = "AssistantUnavailableError";
  }
}

const MAX_QUERY_LENGTH = 300;

/** Matches a price constraint like "under 200", "moins de 150", "max 50". */
function extractMaxPrice(text: string): number | null {
  const match = /(?:under|below|less than|max|moins de|sous|maxi(?:m(?:um)?)?)\s*(\d{1,7})/i.exec(text);
  if (!match) {
    // A bare "$200" or "200$" is also a price constraint.
    const bare = /(\d{1,7})\s*\$/.exec(text);
    return bare ? Number(bare[1]) : null;
  }
  return Number(match[1]);
}

/**
 * The terms to actually search on.
 *
 * Strips the price constraint and filler so "a phone under 200" searches for
 * "phone" rather than for the literal string "a phone under 200", which would
 * match nothing.
 */
function buildSearchTerms(text: string): string {
  return text
    .replace(/(?:under|below|less than|max|moins de|sous|maxi(?:m(?:um)?)?)\s*\d{1,7}/gi, " ")
    .replace(/(\d{1,7})\s*\$/g, " ")
    .replace(/[?.!,]/g, " ")
    .replace(/\b(?:do you have|have you got|i want|i need|looking for|show me|find|please)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mapProduct(row: unknown): AssistantProduct {
  const r = row as Record<string, unknown>;
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    slug: String(r.slug ?? ""),
    brand: String(r.brand ?? ""),
    price: Number(r.price ?? 0),
    discount_price:
      r.discount_price === null || r.discount_price === undefined
        ? null
        : Number(r.discount_price),
    image_url: (r.image_url as string) ?? null,
    stock_quantity: Number(r.stock_quantity ?? 0),
    product_type: (r.product_type as string) ?? null,
  };
}

/**
 * Answer a customer question from the real catalogue.
 *
 * Returns an honest empty result when nothing matches. It never fills the gap with
 * a plausible-sounding product, because a wrong recommendation in Goma is a
 * customer who arrives to collect something that does not exist.
 */
export async function answerFromCatalogue(
  question: string,
  limit = 4,
): Promise<AssistantAnswer> {
  const raw = (question ?? "").trim().slice(0, MAX_QUERY_LENGTH);
  if (raw === "") {
    return { message: "", products: [], source: "deterministic" };
  }

  const maxPrice = extractMaxPrice(raw);
  const terms = buildSearchTerms(raw);

  // A question with no searchable term left (e.g. only "under 200") cannot be
  // answered honestly, so it returns nothing rather than guessing.
  if (terms.length < 2 || !isSupabaseConfigured || !supabase) {
    return {
      message:
        "Tell me what you are looking for — a brand, a product type or a category — and I will search the DLXSTORE catalogue for you.",
      products: [],
      source: "deterministic",
    };
  }

  const { data, error } = await supabase.rpc("search_the_catalogue", {
    p_query: terms,
    p_limit: limit,
    p_max_price: maxPrice,
    p_category_id: null,
  });

  if (error) {
    // The RPC missing means the migration is unapplied. That is a degraded mode,
    // not an error the customer should see.
    if (["PGRST202", "42883", "42P01", "42703"].includes(error.code ?? "")) {
      return {
        message:
          "The assistant is being prepared. You can browse the full catalogue in the meantime.",
        products: [],
        source: "deterministic",
      };
    }
    throw new Error(error.message || "The assistant could not search the catalogue.");
  }

  const products = (Array.isArray(data) ? data : []).map(mapProduct);

  if (products.length === 0) {
    return {
      message: maxPrice
        ? `I could not find a matching item in the catalogue under ${maxPrice} $. Try a broader search or browse the shop.`
        : "I could not find a matching item in the DLXSTORE catalogue. Try a different word, or browse the shop.",
      products: [],
      source: "deterministic",
    };
  }

  const priceNote = maxPrice ? ` under ${maxPrice} $` : "";
  const message =
    products.length === 1
      ? `I found 1 matching item${priceNote}:`
      : `I found ${products.length} matching items${priceNote}:`;

  return { message, products, source: "deterministic" };
}

/**
 * Where a future language model plugs in.
 *
 * Present so the UI and API surface do not need to change when a provider is
 * selected. Not implemented: an adapter must build its own prompt, may only choose
 * among ids returned by `answerFromCatalogue`, and must never set price or stock.
 */
export interface AssistantProvider {
  answer(question: string, recalled: AssistantProduct[]): Promise<AssistantAnswer>;
}

export function describeAssistantCapability() {
  return {
    available: false,
    deterministicFallbackAvailable: true,
    reason: "provider_not_configured" as const,
  };
}

export const ASSISTANT_REQUIRED_ENV = [
  "DLX_ASSISTANT_AI_PROVIDER",
  "DLX_ASSISTANT_AI_API_KEY",
] as const;
