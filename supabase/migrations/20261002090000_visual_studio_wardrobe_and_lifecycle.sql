-- DLXSTORE — Visual Studio wardrobe + job lifecycle + catalogue promotion
--
-- Extends `20260930110000_visual_studio_job_hardening.sql`. It does NOT replace
-- `customer_avatars`, `try_on_jobs`, `visual_job_assets` or the private
-- `visual-workspace` bucket, and it never moves, deletes or overwrites an
-- original supplier/catalogue image.
--
-- What it adds:
--   1. `canceled` as a first-class job status, so a customer can stop a queued
--      or failed job instead of leaving it stranded.
--   2. `visual_wardrobe_items` — the customer's saved product/media pairings
--      (the wardrobe) that a try-on session is built from. Owner-only.
--   3. `retry_visual_job` — a real retry with a fresh request key and an
--      incremented `attempt_count`, instead of colliding with the idempotency
--      index.
--   4. `promote_visual_job_output` — admin-only promotion of an APPROVED
--      generated asset into public catalogue media, recording provenance. The
--      bytes are moved by a trusted server worker first; this function only
--      authorizes and records, so a browser can never self-approve a generated
--      image into the catalogue.
--
-- PRE-APPLICATION REQUIREMENTS
-- ----------------------------
-- 1. Review the remote migration ledger and obtain explicit approval. This file
--    is additive and idempotent but must not be applied unattended.
-- 2. A trusted server worker using a service-role credential owns the
--    `visual-workspace` -> `product-images` object copy performed before
--    `promote_visual_job_output` is called.
-- 3. Requires the applied objects from `20260930110000_visual_studio_job_hardening.sql`
--    (try_on_jobs columns, visual_job_assets, create_visual_job, is_admin).

-- ============================================================================
-- 1. Job status: add `canceled`
-- ============================================================================
-- The inline CHECK created in `20260829060000` is named `try_on_jobs_status_check`
-- by Postgres. Dropping by name is idempotent; the original allowed values are
-- all preserved.
ALTER TABLE public.try_on_jobs DROP CONSTRAINT IF EXISTS try_on_jobs_status_check;

ALTER TABLE public.try_on_jobs
  ADD CONSTRAINT try_on_jobs_status_check
  CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'canceled'));

-- ============================================================================
-- 2. Wardrobe — saved product/media pairings per customer
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.visual_wardrobe_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  source_product_image_id UUID REFERENCES public.product_images(id) ON DELETE SET NULL,
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  -- One saved pairing per product/image. A NULL image is treated as "any image".
  UNIQUE (profile_id, product_id, source_product_image_id)
);

CREATE INDEX IF NOT EXISTS visual_wardrobe_items_profile_created_idx
  ON public.visual_wardrobe_items (profile_id, created_at DESC);

-- A NULL source image is treated as "any image for this product". Postgres
-- treats NULLs as distinct in a UNIQUE constraint, so without this the same
-- product could be saved repeatedly with no specific image.
CREATE UNIQUE INDEX IF NOT EXISTS visual_wardrobe_items_profile_product_any_image_idx
  ON public.visual_wardrobe_items (profile_id, product_id)
  WHERE source_product_image_id IS NULL;

ALTER TABLE public.visual_wardrobe_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Customers manage their own wardrobe" ON public.visual_wardrobe_items;
CREATE POLICY "Customers manage their own wardrobe"
  ON public.visual_wardrobe_items FOR ALL
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

DROP POLICY IF EXISTS "Admins read all wardrobe items" ON public.visual_wardrobe_items;
CREATE POLICY "Admins read all wardrobe items"
  ON public.visual_wardrobe_items FOR SELECT
  USING (public.is_admin());

-- Saves a product/media pairing for the caller's own wardrobe.
--
-- Done server-side so `auth.uid()` supplies the owner without the client having
-- to assert it, and so saving the same pairing twice updates the existing row
-- instead of inserting a duplicate (including the NULL-image case the unique
-- index covers).
CREATE OR REPLACE FUNCTION public.save_wardrobe_item(
  p_product_id UUID,
  p_source_product_image_id UUID DEFAULT NULL,
  p_label TEXT DEFAULT NULL
)
RETURNS public.visual_wardrobe_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_item public.visual_wardrobe_items;
  v_clean_label TEXT := NULLIF(btrim(COALESCE(p_label, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.product_images image
    JOIN public.products product ON product.id = image.product_id
    WHERE image.id = p_source_product_image_id
      AND image.product_id = p_product_id
  ) THEN
    RAISE EXCEPTION 'The selected product image is unavailable';
  END IF;

  SELECT * INTO v_item
  FROM public.visual_wardrobe_items
  WHERE profile_id = v_uid
    AND product_id = p_product_id
    AND (
      (p_source_product_image_id IS NULL AND source_product_image_id IS NULL)
      OR source_product_image_id = p_source_product_image_id
    )
  LIMIT 1;

  IF v_item.id IS NOT NULL THEN
    UPDATE public.visual_wardrobe_items
    SET label = COALESCE(v_clean_label, v_item.label),
        updated_at = timezone('utc', now())
    WHERE id = v_item.id
    RETURNING * INTO v_item;

    RETURN v_item;
  END IF;

  INSERT INTO public.visual_wardrobe_items (
    profile_id,
    product_id,
    source_product_image_id,
    label
  ) VALUES (
    v_uid,
    p_product_id,
    p_source_product_image_id,
    v_clean_label
  )
  RETURNING * INTO v_item;

  RETURN v_item;
END;
$$;

REVOKE ALL ON FUNCTION public.save_wardrobe_item(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_wardrobe_item(UUID, UUID, TEXT) TO authenticated;

-- ============================================================================
-- 3. Cancel a job
-- ============================================================================
-- Only the owner (or an admin) may cancel, and only while the job has not
-- already produced a result. A running job is left alone so a trusted worker
-- is never asked to abandon an in-flight provider call.
CREATE OR REPLACE FUNCTION public.cancel_visual_job(p_job_id UUID)
RETURNS public.try_on_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_job public.try_on_jobs;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_job
  FROM public.try_on_jobs
  WHERE id = p_job_id
    AND (profile_id = v_uid OR public.is_admin());

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'Visual job not found';
  END IF;

  IF v_job.status NOT IN ('queued', 'failed') THEN
    RAISE EXCEPTION 'This visual job can no longer be canceled';
  END IF;

  UPDATE public.try_on_jobs
  SET status = 'canceled',
      error_code = 'canceled_by_user',
      error = 'Canceled by the owner before a result was produced.',
      updated_at = timezone('utc', now())
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_visual_job(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_visual_job(UUID) TO authenticated;

-- ============================================================================
-- 4. Retry a job
-- ============================================================================
-- The original request key is preserved for audit, and a NEW key is generated
-- so the `try_on_jobs_profile_request_key_idx` idempotency index does not turn
-- a legitimate retry into a silent no-op. Calling this twice in a row yields one
-- fresh queued job per terminal-state job, which is the intended behavior.
CREATE OR REPLACE FUNCTION public.retry_visual_job(p_job_id UUID)
RETURNS public.try_on_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_job public.try_on_jobs;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_job
  FROM public.try_on_jobs
  WHERE id = p_job_id
    AND (profile_id = v_uid OR public.is_admin());

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'Visual job not found';
  END IF;

  IF v_job.status NOT IN ('failed', 'canceled') THEN
    RAISE EXCEPTION 'Only a failed or canceled visual job can be retried';
  END IF;

  -- The source media and avatar must still be valid, otherwise the retry would
  -- resurrect a request the original validation rejected.
  IF NOT EXISTS (
    SELECT 1
    FROM public.product_images image
    JOIN public.products product ON product.id = image.product_id
    WHERE image.id = v_job.source_product_image_id
      AND image.product_id = v_job.product_id
      AND product.is_active = true
      AND product.is_archived = false
  ) THEN
    RAISE EXCEPTION 'The original product image is no longer available';
  END IF;

  UPDATE public.try_on_jobs
  SET status = 'queued',
      request_key = gen_random_uuid(),
      provider = NULL,
      provider_job_id = NULL,
      result_asset_path = NULL,
      error = NULL,
      error_code = NULL,
      started_at = NULL,
      completed_at = NULL,
      attempt_count = attempt_count + 1,
      updated_at = timezone('utc', now())
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.retry_visual_job(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retry_visual_job(UUID) TO authenticated;

-- ============================================================================
-- 5. Promote an approved generated asset into catalogue media
-- ============================================================================
-- Called by a trusted worker ONLY after it has copied the provider output out of
-- the private `visual-workspace` bucket into the public `product-images` bucket.
-- This function performs the authorization decision and writes the provenance:
--
--   * admin-only (an operator makes the visual judgement, not the model);
--   * supplier/catalogue workflows only — a customer try-on result is never
--     promoted into the catalogue;
--   * the job must be `completed` with a `provider_output` asset;
--   * promoting the same job twice is a no-op, so a retried worker call is safe.
CREATE OR REPLACE FUNCTION public.promote_visual_job_output(
  p_job_id UUID,
  p_public_url TEXT,
  p_storage_object_path TEXT,
  p_alt_text TEXT DEFAULT NULL,
  p_make_primary BOOLEAN DEFAULT false
)
RETURNS public.product_images
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.try_on_jobs;
  v_asset public.visual_job_assets;
  v_image public.product_images;
  v_next_order INTEGER;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF p_public_url IS NULL OR btrim(p_public_url) = ''
     OR p_storage_object_path IS NULL OR btrim(p_storage_object_path) = '' THEN
    RAISE EXCEPTION 'A promoted asset requires a public URL and a storage object path';
  END IF;

  SELECT * INTO v_job
  FROM public.try_on_jobs
  WHERE id = p_job_id;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'Visual job not found';
  END IF;

  IF v_job.workflow NOT IN ('product_visualization', 'ghost_mannequin') THEN
    RAISE EXCEPTION 'Only an approved supplier visual job can be published to the catalogue';
  END IF;

  IF v_job.status <> 'completed' THEN
    RAISE EXCEPTION 'Only a completed visual job can be published';
  END IF;

  -- Already promoted: return the existing row so a repeated worker call is safe.
  IF v_job.approved_product_image_id IS NOT NULL THEN
    SELECT * INTO v_image
    FROM public.product_images
    WHERE id = v_job.approved_product_image_id;

    IF v_image.id IS NOT NULL THEN
      RETURN v_image;
    END IF;
  END IF;

  SELECT * INTO v_asset
  FROM public.visual_job_assets
  WHERE job_id = v_job.id
    AND asset_role = 'provider_output'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_asset.id IS NULL THEN
    RAISE EXCEPTION 'This visual job has no generated output to publish';
  END IF;

  SELECT COALESCE(MAX(display_order), -1) + 1 INTO v_next_order
  FROM public.product_images
  WHERE product_id = v_job.product_id;

  INSERT INTO public.product_images (
    product_id,
    image_url,
    is_primary,
    display_order,
    alt_text,
    storage_object_path,
    owner_type,
    owner_id
  ) VALUES (
    v_job.product_id,
    p_public_url,
    COALESCE(p_make_primary, false),
    v_next_order,
    NULLIF(btrim(COALESCE(p_alt_text, '')), ''),
    p_storage_object_path,
    'generated',
    v_job.profile_id
  )
  RETURNING * INTO v_image;

  -- Record the approved, catalogue-visible copy alongside the immutable
  -- provider output so provenance survives into the media table.
  INSERT INTO public.visual_job_assets (
    job_id,
    asset_role,
    source_product_image_id,
    storage_object_path,
    source_url
  ) VALUES (
    v_job.id,
    'approved_catalog_output',
    v_image.id,
    p_storage_object_path,
    p_public_url
  )
  ON CONFLICT DO NOTHING;

  UPDATE public.try_on_jobs
  SET approved_product_image_id = v_image.id,
      updated_at = timezone('utc', now())
  WHERE id = v_job.id;

  RETURN v_image;
END;
$$;

REVOKE ALL ON FUNCTION public.promote_visual_job_output(UUID, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promote_visual_job_output(UUID, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;

-- ============================================================================
-- REVERSIBLE (rollback)
--   DROP FUNCTION IF EXISTS public.promote_visual_job_output(UUID, TEXT, TEXT, TEXT, BOOLEAN);
--   DROP FUNCTION IF EXISTS public.save_wardrobe_item(UUID, UUID, TEXT);
--   DROP FUNCTION IF EXISTS public.retry_visual_job(UUID);
--   DROP FUNCTION IF EXISTS public.cancel_visual_job(UUID);
--   DROP TABLE IF EXISTS public.visual_wardrobe_items;
--   ALTER TABLE public.try_on_jobs DROP CONSTRAINT IF EXISTS try_on_jobs_status_check;
--   ALTER TABLE public.try_on_jobs
--     ADD CONSTRAINT try_on_jobs_status_check
--     CHECK (status IN ('queued', 'processing', 'completed', 'failed'));
-- ============================================================================
