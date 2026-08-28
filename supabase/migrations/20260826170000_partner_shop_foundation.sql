-- DLXSTORE — Partner/Shop Foundation (Phase 3)
-- Consolidates and enhances the existing partner/vendor foundation into a simple,
-- unified partner/shop system as per roadmap guidance: one partner table,
-- one auth system, one media registry, avoid duplicated systems.
--
-- This migration enhances the existing vendors table and adds partner shop
-- storefront capabilities while preserving existing data and relationships.

-- 1. ENHANCE VENDORS TABLE TO BECOME UNIFIED PARTNER/SHOP TABLE
ALTER TABLE public.vendors 
  ADD COLUMN IF NOT EXISTS shop_name TEXT,
  ADD COLUMN IF NOT EXISTS shop_description TEXT,
  ADD COLUMN IF NOT EXISTS shop_image_url TEXT,
  ADD COLUMN IF NOT EXISTS banner_image_url TEXT,
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS commission_rate NUMERIC CHECK (commission_rate >= 0 AND commission_rate <= 100),
  ADD COLUMN IF NOT EXISTS payment_info JSONB,
  ADD COLUMN IF NOT EXISTS business_hours JSONB;

-- 2. ADD SHOP-PRODUCT RELATIONSHIP TABLE
CREATE TABLE IF NOT EXISTS public.shop_products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shop_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  is_visible BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE(shop_id, product_id)
);
ALTER TABLE public.shop_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public can read visible shop products" ON public.shop_products;
CREATE POLICY "Public can read visible shop products" ON public.shop_products 
  FOR SELECT USING (is_visible = true);
DROP POLICY IF EXISTS "Shop owners can manage their products" ON public.shop_products;
CREATE POLICY "Shop owners can manage their products" ON public.shop_products 
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.vendors 
      WHERE vendors.id = shop_products.shop_id 
      AND vendors.profile_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "Admins can manage shop products" ON public.shop_products;
CREATE POLICY "Admins can manage shop products" ON public.shop_products 
  FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- 3. ADD INDEXES FOR PERFORMANCE
CREATE INDEX IF NOT EXISTS shop_products_shop_id_idx ON public.shop_products(shop_id);
CREATE INDEX IF NOT EXISTS shop_products_product_id_idx ON public.shop_products(product_id);
CREATE INDEX IF NOT EXISTS vendors_status_idx ON public.vendors(status);
CREATE INDEX IF NOT EXISTS vendors_featured_idx ON public.vendors(is_featured) WHERE is_featured = true;

-- 4. UPDATE RLS POLICIES FOR VENDORS TO INCLUDE SHOP MANAGEMENT
DROP POLICY IF EXISTS "Public can read active vendors" ON public.vendors;
CREATE POLICY "Public can read active vendors" ON public.vendors 
  FOR SELECT USING (status = 'active');
DROP POLICY IF EXISTS "Vendors can update their own shop" ON public.vendors;
CREATE POLICY "Vendors can update their own shop" ON public.vendors 
  FOR UPDATE USING (profile_id = auth.uid());
DROP POLICY IF EXISTS "Admins can manage vendors" ON public.vendors;
CREATE POLICY "Admins can manage vendors" ON public.vendors 
  FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- 5. ADD HELPER FUNCTION FOR SHOP STATISTICS
CREATE OR REPLACE FUNCTION public.get_shop_stats(shop_id UUID)
RETURNS TABLE(
  product_count BIGINT,
  total_orders BIGINT,
  total_revenue NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(DISTINCT sp.product_id)::BIGINT,
    COUNT(DISTINCT o.id)::BIGINT,
    COALESCE(SUM(o.total_amount), 0)
  FROM public.shop_products sp
  LEFT JOIN public.order_items oi ON oi.product_id = sp.product_id
  LEFT JOIN public.orders o ON o.id = oi.order_id
  WHERE sp.shop_id = get_shop_stats.shop_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- REVERSIBLE (rollback)
--   DROP FUNCTION IF EXISTS public.get_shop_stats(UUID);
--   DROP INDEX IF EXISTS vendors_featured_idx;
--   DROP INDEX IF EXISTS vendors_status_idx;
--   DROP INDEX IF EXISTS shop_products_product_id_idx;
--   DROP INDEX IF EXISTS shop_products_shop_id_idx;
--   DROP TABLE IF EXISTS public.shop_products;
--   ALTER TABLE public.vendors 
--     DROP COLUMN IF EXISTS business_hours,
--     DROP COLUMN IF EXISTS payment_info,
--     DROP COLUMN IF EXISTS commission_rate,
--     DROP COLUMN IF EXISTS is_featured,
--     DROP COLUMN IF EXISTS banner_image_url,
--     DROP COLUMN IF EXISTS shop_image_url,
--     DROP COLUMN IF EXISTS shop_description,
--     DROP COLUMN IF EXISTS shop_name;
