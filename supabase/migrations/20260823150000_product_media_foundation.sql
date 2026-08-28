-- DLXSTORE — Product Media Foundation (Phase 1)
-- Additive + reversible. Preserves every existing product_images row and the
-- existing `images: string[]` service shape. No data is migrated, deleted, or
-- rewritten, and existing image URLs (including Unsplash) are left untouched.
--
-- These new nullable columns prepare product media for future reuse without
-- changing behaviour today:
--   * owner_type / owner_id : future partner/shop ownership (informational now)
--   * storage_object_path   : tracks DLX-owned objects for later cleanup/optimization
--   * alt_text              : future product/SEO alternative text (informational now)
--
-- No RLS policies are changed: product media remains public-read through the
-- existing product-visibility policy on public.product_images.

ALTER TABLE public.product_images ADD COLUMN IF NOT EXISTS alt_text TEXT;
-- 'partner' | 'admin' ... future extension point; nullable and non-enforced on purpose.
ALTER TABLE public.product_images ADD COLUMN IF NOT EXISTS owner_type TEXT;
-- Owner entity id (future partner/vendor/profile). Plain UUID, no FK, to avoid
-- premature coupling while RLS remains product-scoped.
ALTER TABLE public.product_images ADD COLUMN IF NOT EXISTS owner_id UUID;
ALTER TABLE public.product_images ADD COLUMN IF NOT EXISTS storage_object_path TEXT;

-- Foreign-key side index (Postgres does not auto-index the referencing column).
CREATE INDEX IF NOT EXISTS product_images_product_id_idx ON public.product_images (product_id);

-- ============================================================================
-- REVERSIBLE (rollback)
--   ALTER TABLE public.product_images
--     DROP COLUMN IF EXISTS alt_text,
--     DROP COLUMN IF EXISTS owner_type,
--     DROP COLUMN IF EXISTS owner_id,
--     DROP COLUMN IF EXISTS storage_object_path;
--   DROP INDEX IF EXISTS product_images_product_id_idx;
-- ============================================================================