-- DLXSTORE — unified Avatar / Visual Studio job hardening
--
-- PRE-APPLICATION REQUIREMENTS
-- ----------------------------
-- 1. Confirm the remote migration ledger before applying. This migration
--    extends the existing `customer_avatars` and `try_on_jobs` tables; it does
--    not replace either one or migrate existing Avatar data.
-- 2. Configure a trusted server-side worker/provider adapter before creating
--    production jobs. There is intentionally no browser write policy for job
--    results, provider fields, asset records, or private storage objects.
-- 3. Review retention, provider data-processing terms, and cost limits before
--    allowing customer-uploaded inputs.
--
-- Design:
-- - `customer_avatars` remains the sole customer mannequin/identity record.
-- - `try_on_jobs` remains the single async visual-job ledger, now differentiated
--   by workflow rather than creating a competing Ghost Mannequin table.
-- - `visual_job_assets` records immutable source/output provenance. The source
--   catalogue image is never overwritten by a generated result.
-- - `visual-workspace` is private. Only a trusted server process should upload
--   or promote objects; approved catalogue media still uses `product-images`.

ALTER TABLE public.try_on_jobs
  ADD COLUMN IF NOT EXISTS workflow TEXT NOT NULL DEFAULT 'try_on'
    CHECK (workflow IN ('try_on', 'product_visualization', 'ghost_mannequin')),
  ADD COLUMN IF NOT EXISTS request_key UUID,
  ADD COLUMN IF NOT EXISTS provider_job_id TEXT,
  ADD COLUMN IF NOT EXISTS source_product_image_id UUID
    REFERENCES public.product_images(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS result_asset_path TEXT,
  ADD COLUMN IF NOT EXISTS approved_product_image_id UUID
    REFERENCES public.product_images(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS constraints JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS error_code TEXT,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (attempt_count >= 0);

-- A client retries with the same request key. The unique index makes that
-- retry idempotent per owner without changing or deduplicating historical jobs.
CREATE UNIQUE INDEX IF NOT EXISTS try_on_jobs_profile_request_key_idx
  ON public.try_on_jobs (profile_id, request_key)
  WHERE request_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS try_on_jobs_profile_workflow_created_idx
  ON public.try_on_jobs (profile_id, workflow, created_at DESC);

CREATE INDEX IF NOT EXISTS try_on_jobs_provider_job_idx
  ON public.try_on_jobs (provider, provider_job_id)
  WHERE provider_job_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.visual_job_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.try_on_jobs(id) ON DELETE CASCADE,
  asset_role TEXT NOT NULL CHECK (asset_role IN (
    'catalog_source',
    'customer_input',
    'provider_output',
    'approved_catalog_output'
  )),
  source_product_image_id UUID REFERENCES public.product_images(id) ON DELETE RESTRICT,
  storage_object_path TEXT,
  source_url TEXT,
  mime_type TEXT,
  byte_size BIGINT CHECK (byte_size IS NULL OR byte_size > 0),
  sha256 TEXT,
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CHECK (storage_object_path IS NOT NULL OR source_url IS NOT NULL),
  CHECK (asset_role <> 'catalog_source' OR source_product_image_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS visual_job_assets_job_role_idx
  ON public.visual_job_assets (job_id, asset_role, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS visual_job_assets_job_role_path_idx
  ON public.visual_job_assets (job_id, asset_role, storage_object_path)
  WHERE storage_object_path IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS visual_job_assets_catalog_source_idx
  ON public.visual_job_assets (job_id, source_product_image_id)
  WHERE asset_role = 'catalog_source';

ALTER TABLE public.visual_job_assets ENABLE ROW LEVEL SECURITY;

-- The original owner-wide ALL policy allowed clients to set provider status,
-- result URLs, and errors. Replace it with a request/read-only customer model.
DROP POLICY IF EXISTS "Customers manage their own try-on jobs" ON public.try_on_jobs;
DROP POLICY IF EXISTS "Admins can read try-on jobs" ON public.try_on_jobs;

DROP POLICY IF EXISTS "Customers read their own visual jobs" ON public.try_on_jobs;
CREATE POLICY "Customers read their own visual jobs"
  ON public.try_on_jobs FOR SELECT
  USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "Admins read all visual jobs" ON public.try_on_jobs;
CREATE POLICY "Admins read all visual jobs"
  ON public.try_on_jobs FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "Visual-job owners read their assets" ON public.visual_job_assets;
CREATE POLICY "Visual-job owners read their assets"
  ON public.visual_job_assets FOR SELECT
  USING (EXISTS (
    SELECT 1
    FROM public.try_on_jobs job
    WHERE job.id = visual_job_assets.job_id
      AND (job.profile_id = auth.uid() OR public.is_admin())
  ));

-- Private by design: no authenticated client policies. A server-side worker
-- using a service-role credential owns uploads and writes to this bucket.
INSERT INTO storage.buckets (id, name, public)
VALUES ('visual-workspace', 'visual-workspace', false)
ON CONFLICT (id) DO UPDATE SET public = false;

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

  -- Supplier/admin visual workflows must never be requested by a normal
  -- customer browser. They are queued only through an authorized operator.
  IF v_workflow <> 'try_on' AND NOT public.is_admin() THEN
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

  -- The job must be tied to an actual media row belonging to the selected
  -- product. This prevents a client from passing an unrelated source image.
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
    profile_id,
    product_id,
    avatar_id,
    workflow,
    request_key,
    source_product_image_id,
    constraints,
    status
  ) VALUES (
    v_uid,
    p_product_id,
    p_avatar_id,
    v_workflow,
    p_request_key,
    p_source_product_image_id,
    COALESCE(p_constraints, '{}'::JSONB),
    'queued'
  )
  ON CONFLICT (profile_id, request_key) WHERE request_key IS NOT NULL
  DO NOTHING
  RETURNING * INTO v_job;

  IF v_job.id IS NULL THEN
    SELECT * INTO v_job
    FROM public.try_on_jobs
    WHERE profile_id = v_uid AND request_key = p_request_key;
  END IF;

  -- Preserve explicit provenance for the source that the provider is allowed
  -- to process. The source product image remains immutable and separately
  -- retained in the catalogue media system.
  INSERT INTO public.visual_job_assets (job_id, asset_role, source_product_image_id, source_url)
  SELECT v_job.id, 'catalog_source', image.id, image.image_url
  FROM public.product_images image
  WHERE image.id = p_source_product_image_id
  ON CONFLICT DO NOTHING;

  RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.create_visual_job(TEXT, UUID, UUID, UUID, UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_visual_job(TEXT, UUID, UUID, UUID, UUID, JSONB) TO authenticated;

-- A trusted worker, not an authenticated browser, must transition job status,
-- store provider results, write visual_job_assets, and promote approved output
-- into public.product_images after an explicit admin approval decision.
