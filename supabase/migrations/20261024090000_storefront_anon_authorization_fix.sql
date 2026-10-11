-- DLXSTORE — restore anonymous storefront reads broken by the seller-AI RLS
--
-- 20261022090000_seller_ai_workflow_authorization.sql added SELECT policies on
-- public.products and public.product_images whose USING clause calls
-- public.can_manage_ai_product(...).  PostgreSQL evaluates RLS policy expressions
-- with the privileges of the querying role, but that function was deliberately
-- granted only to `authenticated` (20261022090000 line 45-46).  Anonymous
-- visitors therefore got, on any storefront product read:
--     ERROR: 42501 permission denied for function can_manage_ai_product
-- which the app turned into "La boutique est indisponible".
--
-- The seller policies are only meaningful to signed-in sellers, so scope them to
-- `authenticated`.  Anonymous reads then fall through to the existing public-read
-- policies ("Public can read visible products" / "... images for visible
-- products").  The same reasoning applies to the seller catalog-draft policies.
--
-- This is a forward-only correction; 20261022090000 is already applied in
-- production.

-- ==========================================================================
-- 1. Products / product images: seller reads are authenticated-only
-- ==========================================================================
DROP POLICY IF EXISTS "Sellers read own products for AI workflows" ON public.products;
CREATE POLICY "Sellers read own products for AI workflows"
  ON public.products FOR SELECT
  TO authenticated
  USING (public.can_manage_ai_product(id));

DROP POLICY IF EXISTS "Sellers read own product images for AI workflows" ON public.product_images;
CREATE POLICY "Sellers read own product images for AI workflows"
  ON public.product_images FOR SELECT
  TO authenticated
  USING (public.can_manage_ai_product(product_id));

-- ==========================================================================
-- 2. Catalog drafts: seller policies are authenticated-only
-- ==========================================================================
DROP POLICY IF EXISTS "Sellers read their own catalog drafts" ON public.ai_catalog_drafts;
CREATE POLICY "Sellers read their own catalog drafts"
  ON public.ai_catalog_drafts FOR SELECT
  TO authenticated
  USING (
    created_by = auth.uid()
    AND target_product_id IS NOT NULL
    AND public.can_manage_ai_product(target_product_id)
  );

DROP POLICY IF EXISTS "Sellers stage local drafts for own products" ON public.ai_catalog_drafts;
CREATE POLICY "Sellers stage local drafts for own products"
  ON public.ai_catalog_drafts FOR INSERT
  TO authenticated
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
