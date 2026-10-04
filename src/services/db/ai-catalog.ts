import type { CatalogSuggestionSource } from "../ai-catalog/provider";
import { isDemoMode, isSupabaseConfigured, supabase } from "./index";

/**
 * Client access to the AI catalog review queue.
 *
 * The table is admin-only, so every read and write here is already constrained by
 * RLS in the database. The client never decides who may review; it only reflects
 * what the database allows.
 */

export type CatalogDraftStatus = "draft" | "approved" | "rejected" | "published";

export interface CatalogDraft {
  id: string;
  target_product_id: string | null;
  source_product_image_id: string | null;
  source_image_url: string | null;
  suggested_name: string | null;
  suggested_description: string | null;
  suggested_slug: string | null;
  suggested_category_id: string | null;
  suggested_category_label: string | null;
  suggested_brand: string | null;
  suggested_colors: string[];
  suggested_sizes: string[];
  suggested_tags: string[];
  suggested_seo_title: string | null;
  suggested_seo_description: string | null;
  suggested_seo_keywords: string | null;
  suggested_alt_text: string | null;
  suggested_attributes: Record<string, unknown>;
  confidence: Record<string, number>;
  rationale: string | null;
  suggestion_source: CatalogSuggestionSource;
  provider: string | null;
  status: CatalogDraftStatus;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  published_product_image_id: string | null;
  applied_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const DRAFT_COLUMNS =
  "id, target_product_id, source_product_image_id, source_image_url, " +
  "suggested_name, suggested_description, suggested_slug, suggested_category_id, " +
  "suggested_category_label, suggested_brand, suggested_colors, suggested_sizes, " +
  "suggested_tags, suggested_seo_title, suggested_seo_description, " +
  "suggested_seo_keywords, suggested_alt_text, suggested_attributes, " +
  "status, review_note, reviewed_by, reviewed_at, published_product_image_id, " +
  "applied_at, created_by, created_at, updated_at";

export class CatalogAutomationUnavailableError extends Error {
  constructor(message = "L'assistant catalogue n'est pas encore activé sur cette installation.") {
    super(message);
    this.name = "CatalogAutomationUnavailableError";
  }
}

function isSchemaUnavailable(error: { code?: string; message?: string } | null) {
  return (
    error?.code === "PGRST202" ||
    error?.code === "PGRST205" ||
    error?.code === "42P01" ||
    error?.code === "42703"
  );
}

function requireClient() {
  if (!isSupabaseConfigured || !supabase) {
    throw new CatalogAutomationUnavailableError(
      isDemoMode
        ? "L'assistant catalogue est indisponible en mode démo."
        : "L'assistant catalogue nécessite la configuration Supabase."
    );
  }
  return supabase;
}

export async function getCatalogDrafts(limit = 50): Promise<CatalogDraft[]> {
  const client = requireClient();
  const { data, error } = await client
    .from("ai_catalog_drafts")
    .select(DRAFT_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (isSchemaUnavailable(error)) throw new CatalogAutomationUnavailableError();
    throw new Error(error.message || "Impossible de charger les brouillons catalogue.");
  }
  return (data ?? []) as unknown as CatalogDraft[];
}

export async function createCatalogDraft(
  suggestion: Record<string, unknown> & { suggestion_source: CatalogSuggestionSource }
): Promise<CatalogDraft> {
  const client = requireClient();
  const { data, error } = await client
    .from("ai_catalog_drafts")
    .insert(suggestion)
    .select(DRAFT_COLUMNS)
    .single();

  if (error) {
    if (isSchemaUnavailable(error)) throw new CatalogAutomationUnavailableError();
    throw new Error(error.message || "Impossible d'enregistrer le brouillon.");
  }
  return data as unknown as CatalogDraft;
}

/**
 * Records a human decision. `patch` carries only the fields the reviewer edited;
 * provenance and lifecycle columns are not reachable from here by design.
 */
export async function reviewCatalogDraft(input: {
  draftId: string;
  decision: "approve" | "reject" | "reopen";
  reviewNote?: string | null;
  patch?: Record<string, unknown>;
}): Promise<CatalogDraft> {
  const client = requireClient();
  const { data, error } = await client.rpc("review_ai_catalog_draft", {
    p_draft_id: input.draftId,
    p_decision: input.decision,
    p_review_note: input.reviewNote?.trim() || null,
    p_patch: input.patch ?? {},
  });

  if (error) {
    if (isSchemaUnavailable(error)) throw new CatalogAutomationUnavailableError();
    throw new Error(error.message || "Impossible d'enregistrer la décision.");
  }
  return data as unknown as CatalogDraft;
}

/** Publishes an approved draft. The database refuses anything not yet approved. */
export async function applyCatalogDraft(draftId: string): Promise<{
  draft_id: string;
  product_id: string;
  alt_text_image_id: string | null;
}> {
  const client = requireClient();
  const { data, error } = await client.rpc("apply_ai_catalog_draft", {
    p_draft_id: draftId,
  });

  if (error) {
    if (isSchemaUnavailable(error)) throw new CatalogAutomationUnavailableError();
    throw new Error(error.message || "Impossible de publier ce brouillon.");
  }
  return data as { draft_id: string; product_id: string; alt_text_image_id: string | null };
}
