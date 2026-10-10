-- DLXSTORE — seller-authorized AI product and catalog workflows
--
-- Requires the marketplace ownership model from 20261017090000_marketplace_core.sql:
-- products.vendor_id -> vendors.id -> vendors.profile_id.  This migration does
-- not grant sellers any direct product/media writes, provider-result writes, or
-- catalogue-output promotion.  It only lets an ACTIVE vendor act on its own
-- products through the existing reviewed RPC boundaries.
--
-- Apply only after the remote migration ledger confirms the dependencies below:
--   * 20260930110000_visual_studio_job_hardening.sql
--   * 20261002090000_visual_studio_wardrobe_and_lifecycle.sql
--   * 20261003090000_ai_catalog_drafts.sql
--   * 20261017090000_marketplace_core.sql

-- ==========================================================================
-- 1. One ownership predicate for all seller AI operations
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.can_manage_ai_product(p_product_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  IF public.is_admin() THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.products product
    JOIN public.vendors vendor ON vendor.id = product.vendor_id
    WHERE product.id = p_product_id
      AND vendor.profile_id = auth.uid()
      AND vendor.status = 'active'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.can_manage_ai_product(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_ai_product(UUID) TO authenticated;

-- Sellers need to read their own inactive listings and their media in the two
-- workspaces.  There is deliberately no corresponding INSERT/UPDATE/DELETE
-- policy: canonical catalogue writes remain in their existing protected paths.
DROP POLICY IF EXISTS "Sellers read own products for AI workflows" ON public.products;
CREATE POLICY "Sellers read own products for AI workflows"
  ON public.products FOR SELECT
  USING (public.can_manage_ai_product(id));

DROP POLICY IF EXISTS "Sellers read own product images for AI workflows" ON public.product_images;
CREATE POLICY "Sellers read own product images for AI workflows"
  ON public.product_images FOR SELECT
  USING (public.can_manage_ai_product(product_id));

-- ==========================================================================
-- 2. Visual Studio: seller may queue only its own catalogue media
-- ==========================================================================
-- Replaces the earlier admin-only supplier condition.  The function still
-- validates product/image membership, preserves per-user idempotency, and owns
-- the job under auth.uid().  Result state and assets remain worker-only.
CREATE OR REPLACE FUNCTION public.create_visual_job(
  p_workflow TEXT,
  p_product_id UUID,
  p_avatar_id UUID,
  p_source_product_image_id UUID,
  p_request_key UUID,
  p_constraints JSONB DEFAULT '{}'::JSONB
)
RETURNS public.try_on_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_job public.try_on_jobs;
  v_workflow TEXT := lower(btrim(p_workflow));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF v_workflow NOT IN ('try_on', 'product_visualization', 'ghost_mannequin') THEN
    RAISE EXCEPTION 'Invalid visual workflow';
  END IF;

  IF v_workflow <> 'try_on' AND NOT public.can_manage_ai_product(p_product_id) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF p_request_key IS NULL THEN
    RAISE EXCEPTION 'A request key is required';
  END IF;

  IF jsonb_typeof(COALESCE(p_constraints, '{}'::JSONB)) <> 'object'
     OR pg_column_size(COALESCE(p_constraints, '{}'::JSONB)) > 8192 THEN
    RAISE EXCEPTION 'Invalid visual job constraints';
  END IF;

  IF v_workflow = 'try_on' AND (p_avatar_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.customer_avatars avatar
    WHERE avatar.id = p_avatar_id AND avatar.profile_id = v_uid
  )) THEN
    RAISE EXCEPTION 'Your Avatar is required for this visual job';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.product_images image
    JOIN public.products product ON product.id = image.product_id
    WHERE image.id = p_source_product_image_id
      AND image.product_id = p_product_id
      AND product.is_active = true
      AND product.is_archived = false
  ) THEN
    RAISE EXCEPTION 'The selected product image is unavailable';
  END IF;

  INSERT INTO public.try_on_jobs (
    profile_id, product_id, avatar_id, workflow, request_key,
    source_product_image_id, constraints, status
  ) VALUES (
    v_uid, p_product_id, p_avatar_id, v_workflow, p_request_key,
    p_source_product_image_id, COALESCE(p_constraints, '{}'::JSONB), 'queued'
  )
  ON CONFLICT (profile_id, request_key) WHERE request_key IS NOT NULL
  DO NOTHING
  RETURNING * INTO v_job;

  IF v_job.id IS NULL THEN
    SELECT * INTO v_job
    FROM public.try_on_jobs
    WHERE profile_id = v_uid AND request_key = p_request_key;
  END IF;

  INSERT INTO public.visual_job_assets (job_id, asset_role, source_product_image_id, source_url)
  SELECT v_job.id, 'catalog_source', image.id, image.image_url
  FROM public.product_images image
  WHERE image.id = p_source_product_image_id
  ON CONFLICT DO NOTHING;

  RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.create_visual_job(TEXT, UUID, UUID, UUID, UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_visual_job(TEXT, UUID, UUID, UUID, UUID, JSONB) TO authenticated;

-- ==========================================================================
-- 3. Catalog drafts: seller-owned staging and human decision gate
-- ==========================================================================
-- The browser may stage only deterministic local suggestions.  A future live
-- provider must create `suggestion_source = 'ai'` from a trusted worker; an
-- authenticated caller must not be able to forge AI provenance or provider IDs.
DROP POLICY IF EXISTS "Admins manage catalog drafts" ON public.ai_catalog_drafts;
CREATE POLICY "Admins manage catalog drafts"
  ON public.ai_catalog_drafts FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Sellers read their own catalog drafts" ON public.ai_catalog_drafts;
CREATE POLICY "Sellers read their own catalog drafts"
  ON public.ai_catalog_drafts FOR SELECT
  USING (
    created_by = auth.uid()
    AND target_product_id IS NOT NULL
    AND public.can_manage_ai_product(target_product_id)
  );

DROP POLICY IF EXISTS "Sellers stage local drafts for own products" ON public.ai_catalog_drafts;
CREATE POLICY "Sellers stage local drafts for own products"
  ON public.ai_catalog_drafts FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND suggestion_source = 'rule_based'
    AND provider IS NULL
    AND status = 'draft'
    AND target_product_id IS NOT NULL
    AND public.can_manage_ai_product(target_product_id)
    AND source_product_image_id IS NOT NULL
    AND source_product_image_id IN (
      SELECT image.id
      FROM public.product_images image
      WHERE image.product_id = target_product_id
    )
  );

-- A seller can review and apply only a draft it created for a product it still
-- owns.  The existing allowlist retains the ban on price, stock, SKU and
-- visibility changes.  Admins can review/apply any draft.
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
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF v_decision NOT IN ('approve', 'reject', 'reopen') THEN RAISE EXCEPTION 'Invalid review decision'; END IF;
  IF jsonb_typeof(v_patch) <> 'object' OR pg_column_size(v_patch) > 16384 THEN RAISE EXCEPTION 'Invalid draft patch'; END IF;

  SELECT * INTO v_draft FROM public.ai_catalog_drafts WHERE id = p_draft_id FOR UPDATE;
  IF v_draft.id IS NULL THEN RAISE EXCEPTION 'Catalog draft not found'; END IF;
  IF NOT public.is_admin() AND (
    v_draft.created_by <> v_uid OR v_draft.target_product_id IS NULL
    OR NOT public.can_manage_ai_product(v_draft.target_product_id)
  ) THEN RAISE EXCEPTION 'Permission denied'; END IF;

  IF v_patch ? 'suggested_category_id'
     AND NULLIF(btrim(COALESCE(v_patch ->> 'suggested_category_id', '')), '') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.categories WHERE id = NULLIF(btrim(v_patch ->> 'suggested_category_id'), '')::UUID) THEN
    RAISE EXCEPTION 'Unknown category';
  END IF;

  UPDATE public.ai_catalog_drafts
  SET suggested_name = CASE WHEN v_patch ? 'suggested_name' THEN NULLIF(btrim(v_patch ->> 'suggested_name'), '') ELSE suggested_name END,
      suggested_description = CASE WHEN v_patch ? 'suggested_description' THEN NULLIF(btrim(v_patch ->> 'suggested_description'), '') ELSE suggested_description END,
      suggested_slug = CASE WHEN v_patch ? 'suggested_slug' THEN NULLIF(btrim(v_patch ->> 'suggested_slug'), '') ELSE suggested_slug END,
      suggested_category_id = CASE WHEN v_patch ? 'suggested_category_id' THEN NULLIF(v_patch ->> 'suggested_category_id', '')::UUID ELSE suggested_category_id END,
      suggested_category_label = CASE WHEN v_patch ? 'suggested_category_label' THEN NULLIF(btrim(v_patch ->> 'suggested_category_label'), '') ELSE suggested_category_label END,
      suggested_brand = CASE WHEN v_patch ? 'suggested_brand' THEN NULLIF(btrim(v_patch ->> 'suggested_brand'), '') ELSE suggested_brand END,
      suggested_colors = CASE WHEN v_patch ? 'suggested_colors' AND jsonb_typeof(v_patch -> 'suggested_colors') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(v_patch -> 'suggested_colors')) ELSE suggested_colors END,
      suggested_sizes = CASE WHEN v_patch ? 'suggested_sizes' AND jsonb_typeof(v_patch -> 'suggested_sizes') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(v_patch -> 'suggested_sizes')) ELSE suggested_sizes END,
      suggested_tags = CASE WHEN v_patch ? 'suggested_tags' AND jsonb_typeof(v_patch -> 'suggested_tags') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(v_patch -> 'suggested_tags')) ELSE suggested_tags END,
      suggested_seo_title = CASE WHEN v_patch ? 'suggested_seo_title' THEN NULLIF(btrim(v_patch ->> 'suggested_seo_title'), '') ELSE suggested_seo_title END,
      suggested_seo_description = CASE WHEN v_patch ? 'suggested_seo_description' THEN NULLIF(btrim(v_patch ->> 'suggested_seo_description'), '') ELSE suggested_seo_description END,
      suggested_seo_keywords = CASE WHEN v_patch ? 'suggested_seo_keywords' THEN NULLIF(btrim(v_patch ->> 'suggested_seo_keywords'), '') ELSE suggested_seo_keywords END,
      suggested_alt_text = CASE WHEN v_patch ? 'suggested_alt_text' THEN NULLIF(btrim(v_patch ->> 'suggested_alt_text'), '') ELSE suggested_alt_text END,
      status = CASE WHEN v_decision = 'approve' THEN 'approved' WHEN v_decision = 'reject' THEN 'rejected' ELSE 'draft' END,
      review_note = NULLIF(btrim(COALESCE(p_review_note, '')), ''),
      reviewed_by = v_uid, reviewed_at = timezone('utc', now()), updated_at = timezone('utc', now())
  WHERE id = v_draft.id
  RETURNING * INTO v_draft;
  RETURN v_draft;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_ai_catalog_draft(p_draft_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid(); v_draft public.ai_catalog_drafts; v_product public.products; v_alt_image_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_draft FROM public.ai_catalog_drafts WHERE id = p_draft_id FOR UPDATE;
  IF v_draft.id IS NULL THEN RAISE EXCEPTION 'Catalog draft not found'; END IF;
  IF NOT public.is_admin() AND (v_draft.created_by <> v_uid OR v_draft.target_product_id IS NULL OR NOT public.can_manage_ai_product(v_draft.target_product_id)) THEN RAISE EXCEPTION 'Permission denied'; END IF;
  IF v_draft.status = 'published' THEN RAISE EXCEPTION 'This draft has already been published'; END IF;
  IF v_draft.status <> 'approved' THEN RAISE EXCEPTION 'Review and approve this draft before publishing it'; END IF;
  IF v_draft.target_product_id IS NULL THEN RAISE EXCEPTION 'Choose the product this draft describes before publishing'; END IF;
  IF v_draft.reviewed_by IS NULL THEN RAISE EXCEPTION 'This draft has no recorded reviewer'; END IF;
  SELECT * INTO v_product FROM public.products WHERE id = v_draft.target_product_id FOR UPDATE;
  IF v_product.id IS NULL THEN RAISE EXCEPTION 'Target product not found'; END IF;
  IF v_draft.source_product_image_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.product_images WHERE id = v_draft.source_product_image_id AND product_id = v_draft.target_product_id) THEN RAISE EXCEPTION 'The analyzed image does not belong to this product'; END IF;

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
  IF NULLIF(btrim(COALESCE(v_draft.suggested_alt_text, '')), '') IS NOT NULL AND v_draft.source_product_image_id IS NOT NULL THEN
    UPDATE public.product_images SET alt_text = v_draft.suggested_alt_text WHERE id = v_draft.source_product_image_id RETURNING id INTO v_alt_image_id;
  END IF;
  UPDATE public.ai_catalog_drafts SET status = 'published', published_product_image_id = v_alt_image_id, applied_at = timezone('utc', now()), updated_at = timezone('utc', now()) WHERE id = v_draft.id;
  RETURN jsonb_build_object('draft_id', v_draft.id, 'product_id', v_product.id, 'alt_text_image_id', v_alt_image_id, 'applied_by', v_uid);
END;
$$;

REVOKE ALL ON FUNCTION public.review_ai_catalog_draft(UUID, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_ai_catalog_draft(UUID, TEXT, TEXT, JSONB) TO authenticated;
REVOKE ALL ON FUNCTION public.apply_ai_catalog_draft(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_ai_catalog_draft(UUID) TO authenticated;

-- ==========================================================================
-- REVERSIBLE (before seller drafts/jobs are created)
--   DROP POLICY IF EXISTS "Sellers stage local drafts for own products" ON public.ai_catalog_drafts;
--   DROP POLICY IF EXISTS "Sellers read their own catalog drafts" ON public.ai_catalog_drafts;
--   DROP POLICY IF EXISTS "Sellers read own product images for AI workflows" ON public.product_images;
--   DROP POLICY IF EXISTS "Sellers read own products for AI workflows" ON public.products;
--   DROP FUNCTION IF EXISTS public.can_manage_ai_product(UUID);
--   -- Restore the preceding definitions of create_visual_job,
--   -- review_ai_catalog_draft, and apply_ai_catalog_draft from their source
--   -- migrations. After sellers have created drafts/jobs, use a forward
--   -- corrective migration instead to preserve their audit records.
-- ==========================================================================
