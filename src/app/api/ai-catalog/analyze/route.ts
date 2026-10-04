import { NextResponse } from "next/server";
import {
  CatalogProviderNotConfiguredError,
  describeCatalogProviderCapability,
  getCatalogAnalysisProvider,
  type CatalogAnalysisRequest,
  type CatalogSuggestion,
} from "../../../../services/ai-catalog/provider";
import { buildRuleBasedSuggestion } from "../../../../services/ai-catalog/rule-based";
import { validateProductImageUrl } from "../../../../lib/product-image";
import {
  isMissingSchemaError,
  readCallerRole,
  requireCaller,
  UserScopeAuthError,
} from "../../../../services/server/user-scope";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DRAFT_COLUMNS =
  "id, target_product_id, source_product_image_id, source_image_url, " +
  "suggested_name, suggested_description, suggested_slug, suggested_category_id, " +
  "suggested_category_label, suggested_brand, suggested_colors, suggested_sizes, " +
  "suggested_tags, suggested_seo_title, suggested_seo_description, " +
  "suggested_seo_keywords, suggested_alt_text, suggested_attributes, " +
  "status, review_note, reviewed_by, reviewed_at, published_product_image_id, " +
  "applied_at, created_by, created_at, updated_at";

type AnalyzeBody = {
  targetProductId?: string;
  sourceProductImageId?: string;
  sourceImageUrl?: string;
};

/**
 * Produces a catalog *draft*. It never writes to `products` or `product_images`.
 *
 * With a reviewed provider configured it calls the provider. Without one it uses
 * the deterministic local helper and records the draft as `rule_based`, so the
 * review queue shows the true provenance of every suggestion. Either way the
 * operator must review and approve before anything is published.
 */
export async function POST(request: Request) {
  let caller: Awaited<ReturnType<typeof requireCaller>>;
  try {
    caller = await requireCaller(request);
  } catch (error) {
    if (error instanceof UserScopeAuthError) {
      return NextResponse.json({ error: "unauthorized", reason: error.reason }, { status: 401 });
    }
    return NextResponse.json({ error: "server_not_configured" }, { status: 503 });
  }

  // Catalog automation is an operator function. The database is the authority
  // (admin-only RLS on the drafts table); this avoids pointless work.
  const role = await readCallerRole(caller.client, caller.userId);
  if (role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: AnalyzeBody;
  try {
    body = (await request.json()) as AnalyzeBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const targetProductId = String(body.targetProductId ?? "").trim();
  const sourceProductImageId = String(body.sourceProductImageId ?? "").trim();

  if (!UUID_RE.test(targetProductId)) {
    return NextResponse.json({ error: "target_product_required" }, { status: 400 });
  }

  if (!UUID_RE.test(sourceProductImageId)) {
    return NextResponse.json({ error: "source_image_required" }, { status: 400 });
  }

  // The image must be one of the target product's own media rows, and its stored
  // URL is authoritative. Deriving the URL from the database (rather than
  // trusting a client-supplied one) keeps the provider away from arbitrary URLs
  // and prevents pairing product A with product B's image, which would
  // otherwise write alt text onto the wrong product at publish time.
  const { data: mediaRow, error: mediaError } = await caller.client
    .from("product_images")
    .select("id, image_url")
    .eq("id", sourceProductImageId)
    .eq("product_id", targetProductId)
    .maybeSingle();

  if (mediaError) {
    if (isMissingSchemaError(mediaError)) {
      return NextResponse.json({ error: "schema_unavailable" }, { status: 503 });
    }
    return NextResponse.json({ error: "image_lookup_failed" }, { status: 400 });
  }

  if (!mediaRow) {
    return NextResponse.json(
      { error: "image_not_in_product", detail: "Cette image n'appartient pas à cet article." },
      { status: 400 }
    );
  }

  // Reuses the single image allowlist the whole storefront already uses.
  const validation = validateProductImageUrl(String(mediaRow.image_url));
  if (!validation.isAllowed) {
    return NextResponse.json(
      { error: "invalid_source_image", detail: validation.reason },
      { status: 400 }
    );
  }

  const sourceMediaId = String(mediaRow.id);
  const sourceImageUrl = String(mediaRow.image_url);

  // Real product, so suggestions are grounded in actual catalogue data.
  const { data: product, error: productError } = await caller.client
    .from("products")
    .select("id, name, brand, category_id, sizes, colors, slug")
    .eq("id", targetProductId)
    .maybeSingle();

  if (productError) {
    if (isMissingSchemaError(productError)) {
      return NextResponse.json({ error: "schema_unavailable" }, { status: 503 });
    }
    return NextResponse.json({ error: "product_lookup_failed" }, { status: 400 });
  }
  if (!product) {
    return NextResponse.json({ error: "product_not_found" }, { status: 404 });
  }

  // The model may only choose among categories that actually exist and are live.
  const { data: categories } = await caller.client
    .from("categories")
    .select("id, name")
    .is("is_active", true)
    .order("display_order", { ascending: true });

  const candidateCategories = (categories ?? []).map((category) => ({
    id: String(category.id),
    name: String(category.name),
  }));

  const analysisRequest: CatalogAnalysisRequest = {
    sourceImageUrl,
    context: {
      productId: product.id,
      name: product.name,
      brand: product.brand,
    },
    candidateCategories,
  };

  const capability = describeCatalogProviderCapability();

  let suggestion: CatalogSuggestion;
  let providerName: string | null = null;

  try {
    const provider = getCatalogAnalysisProvider();
    suggestion = await provider.analyze(analysisRequest);
    // Reaching here means a reviewed adapter is compiled in.
    providerName = "configured";
    suggestion = { ...suggestion, source: "ai" };
  } catch (error) {
    if (!(error instanceof CatalogProviderNotConfiguredError)) {
      // A provider that exists but failed is a real error, not a fallback.
      return NextResponse.json(
        { error: "provider_failed", detail: "L'analyse IA a échoué." },
        { status: 502 }
      );
    }
    // Honest, deterministic fallback. Never presented as AI output.
    suggestion = buildRuleBasedSuggestion(analysisRequest, {
      brand: product.brand,
      sizes: Array.isArray(product.sizes) ? (product.sizes as string[]) : [],
      colors: Array.isArray(product.colors) ? (product.colors as string[]) : [],
    });
  }

  // Refuse to persist a category the model invented.
  const allowedCategoryIds = new Set(candidateCategories.map((entry) => entry.id));
  if (suggestion.categoryId && !allowedCategoryIds.has(suggestion.categoryId)) {
    suggestion.categoryId = null;
    suggestion.categoryLabel = undefined;
  }

  const { data: draft, error: insertError } = await caller.client
    .from("ai_catalog_drafts")
    .insert({
      target_product_id: product.id,
      source_product_image_id: sourceMediaId,
      source_image_url: sourceImageUrl,
      suggested_name: suggestion.name ?? null,
      suggested_description: suggestion.description ?? null,
      suggested_slug: suggestion.slug ?? null,
      suggested_category_id: suggestion.categoryId ?? null,
      suggested_category_label: suggestion.categoryLabel ?? null,
      suggested_brand: suggestion.brand ?? null,
      suggested_colors: suggestion.colors ?? [],
      suggested_sizes: suggestion.sizes ?? [],
      suggested_tags: suggestion.tags ?? [],
      suggested_seo_title: suggestion.seoTitle ?? null,
      suggested_seo_description: suggestion.seoDescription ?? null,
      suggested_seo_keywords: suggestion.seoKeywords ?? null,
      suggested_alt_text: suggestion.altText ?? null,
      suggested_attributes: suggestion.attributes ?? {},
      confidence: suggestion.confidence ?? {},
      rationale: suggestion.rationale ?? null,
      suggestion_source: suggestion.source,
      provider: providerName,
      created_by: caller.userId,
    })
    .select(DRAFT_COLUMNS)
    .single();

  if (insertError) {
    if (isMissingSchemaError(insertError)) {
      return NextResponse.json(
        {
          error: "schema_unavailable",
          detail: "La migration de l'assistant catalogue n'est pas appliquée.",
        },
        { status: 503 }
      );
    }
    // 23505: this product already has a draft awaiting review. Publishing or
    // rejecting the existing one frees the slot.
    if (insertError.code === "23505") {
      return NextResponse.json(
        {
          error: "draft_already_open",
          detail:
            "Cet article a déjà un brouillon en attente. Validez-le ou rejetez-le avant d'en créer un nouveau.",
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "draft_failed", detail: insertError.message },
      { status: 400 }
    );
  }

  return NextResponse.json(
    {
      draft,
      // The client labels the draft from `draft.suggestion_source`; this is only
      // a convenience signal about provider configuration.
      providerAvailable: capability.available,
      providerReason: capability.reason,
    },
    { status: 201 }
  );
}
