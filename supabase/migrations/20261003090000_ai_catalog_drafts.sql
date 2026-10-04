-- DLXSTORE — AI Catalog Automation: drafts, review gate, provenance
--
-- Adds the missing "AI suggests → human approves → product publishes" layer
-- (ROADMAP Phase 5). Extends existing product/media structures; creates no
-- duplicate catalogue. `products` and `product_images` remain canonical.
--
-- Design:
-- - `ai_catalog_drafts` is a staging area. AI (or a rule-based local fallback)
--   writes ONLY here. Nothing reaches `products` or `product_images` until a
--   human approves, and the write itself happens in
--   `apply_ai_catalog_draft`, which is admin-only and records provenance.
-- - AI never supplies price, stock, or availability. Those stay operator-owned
--   in the existing admin product form, so a model can never invent a price.
-- - Applying enriches an EXISTING product. Product creation is deliberately not
--   duplicated here: the admin form already owns that flow.
-- - `alt_text` is written to the existing additive `product_images.alt_text`
--   column (from `20260823150000_product_media_foundation.sql`).
--
-- PRE-APPLICATION REQUIREMENTS
-- ----------------------------
-- 1. Review the remote migration ledger and obtain explicit approval.
-- 2. Additive and idempotent: no data is rewritten, moved or deleted.
-- 3. This file is self-contained apart from `public.is_admin()`, the
--    pre-existing `products` / `product_images` / `categories` / `profiles`
--    tables, and the additive `product_images.alt_text` column. It does not
--    depend on the Visual Studio migrations.

-- ============================================================================
-- 1. SEO metadata (nullable; consumed by the marketing/SEO layer)
-- ============================================================================
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS seo_title TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS seo_description TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS seo_keywords TEXT;

-- ============================================================================
-- 2. Drafts
-- ============================================================================
-- `suggestion_source` is honest about provenance:
--   'ai'         — a configured provider produced this
--   'rule_based' — deterministic local fallback, NOT a model
--   'manual'     — an operator typed it
-- The UI must never present 'rule_based' as AI output.
CREATE TABLE IF NOT EXISTS public.ai_catalog_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
  source_product_image_id UUID REFERENCES public.product_images(id) ON DELETE SET NULL,
  source_image_url TEXT,

  -- Suggestions. A draft may be partial; the reviewer decides what to keep.
  suggested_name TEXT,
  suggested_description TEXT,
  suggested_slug TEXT,
  suggested_category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  suggested_category_label TEXT,
  suggested_brand TEXT,
  suggested_colors TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  suggested_sizes TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  suggested_tags TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  suggested_seo_title TEXT,
  suggested_seo_description TEXT,
  suggested_seo_keywords TEXT,
  suggested_alt_text TEXT,
  suggested_attributes JSONB NOT NULL DEFAULT '{}'::JSONB,

  -- Per-field confidence so a reviewer can see what the model was unsure about.
  confidence JSONB NOT NULL DEFAULT '{}'::JSONB,
  -- Why the suggestion was produced, without storing any provider secret.
  rationale TEXT,

  suggestion_source TEXT NOT NULL DEFAULT 'rule_based'
    CHECK (suggestion_source IN ('ai', 'rule_based', 'manual')),
  provider TEXT,

  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'rejected', 'published')),
  review_note TEXT,
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  published_product_image_id UUID REFERENCES public.product_images(id) ON DELETE SET NULL,
  applied_at TIMESTAMPTZ,

  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS ai_catalog_drafts_status_created_idx
  ON public.ai_catalog_drafts (status, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_catalog_drafts_target_product_idx
  ON public.ai_catalog_drafts (target_product_id)
  WHERE target_product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ai_catalog_drafts_created_by_idx
  ON public.ai_catalog_drafts (created_by)
  WHERE created_by IS NOT NULL;

-- A target product may only have one live draft at a time, so a reviewer cannot
-- accidentally publish two competing suggestion sets for the same product.
CREATE UNIQUE INDEX IF NOT EXISTS ai_catalog_drafts_live_per_product_idx
  ON public.ai_catalog_drafts (target_product_id)
  WHERE target_product_id IS NOT NULL
    AND status IN ('draft', 'approved');

ALTER TABLE public.ai_catalog_drafts ENABLE ROW LEVEL SECURITY;

-- Supplier catalogue automation is an operator function. Customers never see or
-- create drafts, so the policies are admin-only rather than owner-scoped.
DROP POLICY IF EXISTS "Admins manage catalog drafts" ON public.ai_catalog_drafts;
CREATE POLICY "Admins manage catalog drafts"
  ON public.ai_catalog_drafts FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ============================================================================
-- 3. Review transitions
-- ============================================================================
-- The reviewer may freely edit the suggestions before approving; `reviewed_by`
-- is taken from the JWT so accountability is real, not client-asserted.
CREATE OR REPLACE FUNCTION public.review_ai_catalog_draft(
  p_draft_id UUID,
  p_decision TEXT,
  p_review_note TEXT DEFAULT NULL,
  p_patch JSONB DEFAULT '{}'::JSONB
)
RETURNS public.ai_catalog_drafts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_draft public.ai_catalog_drafts;
  v_decision TEXT := lower(btrim(COALESCE(p_decision, '')));
  v_patch JSONB := COALESCE(p_patch, '{}'::JSONB);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF v_decision NOT IN ('approve', 'reject', 'reopen') THEN
    RAISE EXCEPTION 'Invalid review decision';
  END IF;

  IF jsonb_typeof(v_patch) <> 'object' OR pg_column_size(v_patch) > 16384 THEN
    RAISE EXCEPTION 'Invalid draft patch';
  END IF;

  -- A reviewer may only assign a category that actually exists, so the draft can
  -- never carry a category id that would fail at publish time.
  IF v_patch ? 'suggested_category_id'
     AND NULLIF(btrim(COALESCE(v_patch ->> 'suggested_category_id', '')), '') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.categories
      WHERE id = NULLIF(btrim(v_patch ->> 'suggested_category_id'), '')::UUID
    ) THEN
      RAISE EXCEPTION 'Unknown category';
    END IF;
  END IF;

  SELECT * INTO v_draft
  FROM public.ai_catalog_drafts
  WHERE id = p_draft_id
  FOR UPDATE;

  IF v_draft.id IS NULL THEN
    RAISE EXCEPTION 'Catalog draft not found';
  END IF;

  -- Only the suggestion columns are patchable. Provenance and lifecycle columns
  -- are deliberately unreachable from the client.
  UPDATE public.ai_catalog_drafts
  SET suggested_name = CASE WHEN v_patch ? 'suggested_name' THEN NULLIF(btrim(v_patch ->> 'suggested_name'), '') ELSE suggested_name END,
      suggested_description = CASE WHEN v_patch ? 'suggested_description' THEN NULLIF(btrim(v_patch ->> 'suggested_description'), '') ELSE suggested_description END,
      suggested_slug = CASE WHEN v_patch ? 'suggested_slug' THEN NULLIF(btrim(v_patch ->> 'suggested_slug'), '') ELSE suggested_slug END,
      suggested_category_id = CASE WHEN v_patch ? 'suggested_category_id' THEN NULLIF(v_patch ->> 'suggested_category_id', '')::UUID ELSE suggested_category_id END,
      suggested_category_label = CASE WHEN v_patch ? 'suggested_category_label' THEN NULLIF(btrim(v_patch ->> 'suggested_category_label'), '') ELSE suggested_category_label END,
      suggested_brand = CASE WHEN v_patch ? 'suggested_brand' THEN NULLIF(btrim(v_patch ->> 'suggested_brand'), '') ELSE suggested_brand END,
      suggested_colors = CASE
              WHEN v_patch ? 'suggested_colors' AND jsonb_typeof(v_patch -> 'suggested_colors') = 'array'
              THEN ARRAY(SELECT jsonb_array_elements_text(v_patch -> 'suggested_colors'))
              ELSE suggested_colors
            END,
      suggested_sizes = CASE
              WHEN v_patch ? 'suggested_sizes' AND jsonb_typeof(v_patch -> 'suggested_sizes') = 'array'
              THEN ARRAY(SELECT jsonb_array_elements_text(v_patch -> 'suggested_sizes'))
              ELSE suggested_sizes
            END,
      suggested_tags = CASE
              WHEN v_patch ? 'suggested_tags' AND jsonb_typeof(v_patch -> 'suggested_tags') = 'array'
              THEN ARRAY(SELECT jsonb_array_elements_text(v_patch -> 'suggested_tags'))
              ELSE suggested_tags
            END,
      suggested_seo_title = CASE WHEN v_patch ? 'suggested_seo_title' THEN NULLIF(btrim(v_patch ->> 'suggested_seo_title'), '') ELSE suggested_seo_title END,
      suggested_seo_description = CASE WHEN v_patch ? 'suggested_seo_description' THEN NULLIF(btrim(v_patch ->> 'suggested_seo_description'), '') ELSE suggested_seo_description END,
      suggested_seo_keywords = CASE WHEN v_patch ? 'suggested_seo_keywords' THEN NULLIF(btrim(v_patch ->> 'suggested_seo_keywords'), '') ELSE suggested_seo_keywords END,
      suggested_alt_text = CASE WHEN v_patch ? 'suggested_alt_text' THEN NULLIF(btrim(v_patch ->> 'suggested_alt_text'), '') ELSE suggested_alt_text END,
      status = CASE
                 WHEN v_decision = 'approve' THEN 'approved'
                 WHEN v_decision = 'reject' THEN 'rejected'
                 ELSE 'draft'
               END,
      review_note = NULLIF(btrim(COALESCE(p_review_note, '')), ''),
      reviewed_by = v_uid,
      reviewed_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  WHERE id = v_draft.id
  RETURNING * INTO v_draft;

  RETURN v_draft;
END;
$$;

REVOKE ALL ON FUNCTION public.review_ai_catalog_draft(UUID, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_ai_catalog_draft(UUID, TEXT, TEXT, JSONB) TO authenticated;

-- ============================================================================
-- 4. Apply an approved draft to the catalogue
-- ============================================================================
-- This is the ONLY path from a suggestion to the live catalogue. It is
-- admin-only, requires the draft to be `approved`, and only overwrites the
-- fields a reviewer actually kept. Price, stock, SKU and visibility are never
-- touched: a model must not be able to change what DLXSTORE sells or for how
-- much.
CREATE OR REPLACE FUNCTION public.apply_ai_catalog_draft(p_draft_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_draft public.ai_catalog_drafts;
  v_product public.products;
  v_alt_image_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  SELECT * INTO v_draft
  FROM public.ai_catalog_drafts
  WHERE id = p_draft_id
  FOR UPDATE;

  IF v_draft.id IS NULL THEN
    RAISE EXCEPTION 'Catalog draft not found';
  END IF;

  IF v_draft.status = 'published' THEN
    RAISE EXCEPTION 'This draft has already been published';
  END IF;

  -- The whole point of the feature: nothing is applied before a human approves.
  IF v_draft.status <> 'approved' THEN
    RAISE EXCEPTION 'Review and approve this draft before publishing it';
  END IF;

  IF v_draft.target_product_id IS NULL THEN
    RAISE EXCEPTION 'Choose the product this draft describes before publishing';
  END IF;

  SELECT * INTO v_product
  FROM public.products
  WHERE id = v_draft.target_product_id
  FOR UPDATE;

  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'Target product not found';
  END IF;

  -- Accountability: a draft must name the human who approved it.
  IF v_draft.reviewed_by IS NULL THEN
    RAISE EXCEPTION 'This draft has no recorded reviewer';
  END IF;

  -- The analyzed image must belong to the product being enriched. Without this,
  -- a draft could write alt text onto an unrelated product's image.
  IF v_draft.source_product_image_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.product_images
      WHERE id = v_draft.source_product_image_id
        AND product_id = v_draft.target_product_id
    ) THEN
      RAISE EXCEPTION 'The analyzed image does not belong to this product';
    END IF;
  END IF;

  UPDATE public.products
  SET name = COALESCE(NULLIF(btrim(COALESCE(v_draft.suggested_name, '')), ''), name),
      description = COALESCE(NULLIF(btrim(COALESCE(v_draft.suggested_description, '')), ''), description),
      slug = COALESCE(NULLIF(btrim(COALESCE(v_draft.suggested_slug, '')), ''), slug),
      category_id = COALESCE(v_draft.suggested_category_id, category_id),
      brand = COALESCE(NULLIF(btrim(COALESCE(v_draft.suggested_brand, '')), ''), brand),
      colors = CASE WHEN cardinality(v_draft.suggested_colors) > 0 THEN v_draft.suggested_colors ELSE colors END,
      sizes = CASE WHEN cardinality(v_draft.suggested_sizes) > 0 THEN v_draft.suggested_sizes ELSE sizes END,
      tags = CASE WHEN cardinality(v_draft.suggested_tags) > 0 THEN v_draft.suggested_tags ELSE tags END,
      seo_title = COALESCE(NULLIF(btrim(COALESCE(v_draft.suggested_seo_title, '')), ''), seo_title),
      seo_description = COALESCE(NULLIF(btrim(COALESCE(v_draft.suggested_seo_description, '')), ''), seo_description),
      seo_keywords = COALESCE(NULLIF(btrim(COALESCE(v_draft.suggested_seo_keywords, '')), ''), seo_keywords)
  WHERE id = v_product.id;

  -- Alt text goes to the existing additive media column, on the image the
  -- reviewer actually looked at.
  IF NULLIF(btrim(COALESCE(v_draft.suggested_alt_text, '')), '') IS NOT NULL
     AND v_draft.source_product_image_id IS NOT NULL THEN
    UPDATE public.product_images
    SET alt_text = v_draft.suggested_alt_text
    WHERE id = v_draft.source_product_image_id
    RETURNING id INTO v_alt_image_id;
  END IF;

  UPDATE public.ai_catalog_drafts
  SET status = 'published',
      published_product_image_id = v_alt_image_id,
      applied_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  WHERE id = v_draft.id;

  RETURN jsonb_build_object(
    'draft_id', v_draft.id,
    'product_id', v_product.id,
    'alt_text_image_id', v_alt_image_id,
    'applied_by', v_uid
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_ai_catalog_draft(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_ai_catalog_draft(UUID) TO authenticated;

-- ============================================================================
-- REVERSIBLE (rollback)
--   DROP FUNCTION IF EXISTS public.apply_ai_catalog_draft(UUID);
--   DROP FUNCTION IF EXISTS public.review_ai_catalog_draft(UUID, TEXT, TEXT, JSONB);
--   DROP TABLE IF EXISTS public.ai_catalog_drafts;
--   ALTER TABLE public.products
--     DROP COLUMN IF EXISTS seo_title,
--     DROP COLUMN IF EXISTS seo_description,
--     DROP COLUMN IF EXISTS seo_keywords;
-- ============================================================================
