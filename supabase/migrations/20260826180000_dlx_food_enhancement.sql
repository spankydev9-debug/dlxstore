-- DLXSTORE — DLX Food Enhancement (Phase 4)
-- Enhances the existing food foundation with better admin controls and
-- integration with the shared product infrastructure. Preserves existing data.
--
-- This migration adds enhanced food vendor management capabilities while
-- building on the existing foundation from 20260818190600_coupons_food_foundation.sql

-- 1. ADD ENHANCED FOOD VENDOR COLUMNS
ALTER TABLE public.food_vendors 
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS banner_image_url TEXT,
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS minimum_order_amount NUMERIC DEFAULT 0 CHECK (minimum_order_amount >= 0),
  ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC DEFAULT 0 CHECK (delivery_fee >= 0),
  ADD COLUMN IF NOT EXISTS rating NUMERIC CHECK (rating >= 0 AND rating <= 5),
  ADD COLUMN IF NOT EXISTS preparation_time_minutes INTEGER;

-- 2. ADD FOOD CATEGORY TABLE FOR BETTER ORGANIZATION
CREATE TABLE IF NOT EXISTS public.food_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  icon_emoji TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
ALTER TABLE public.food_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public can read active food categories" ON public.food_categories;
CREATE POLICY "Public can read active food categories" ON public.food_categories 
  FOR SELECT USING (is_active = true);
DROP POLICY IF EXISTS "Admins can manage food categories" ON public.food_categories;
CREATE POLICY "Admins can manage food categories" ON public.food_categories 
  FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- 3. SEED DEFAULT FOOD CATEGORIES (idempotent by slug)
INSERT INTO public.food_categories (name, slug, description, icon_emoji, is_active, display_order)
VALUES
  ('Grillades', 'grillades', 'Plats grillés et barbecue', '🍖', true, 1),
  ('Fast Food', 'fast-food', 'Restauration rapide', '🍔', true, 2),
  ('Boulangerie', 'boulangerie', 'Pains, viennoiseries et pâtisseries', '🥐', true, 3),
  ('Cuisine congolaise', 'cuisine-congolaise', 'Plats traditionnels congolais', '🍲', true, 4),
  ('Pâtisserie', 'patisserie', 'Desserts et gâteaux', '🍰', true, 5),
  ('Boissons', 'boissons', 'Boissons et rafraîchissements', '🥤', true, 6),
  ('Petit-déjeuner', 'petit-dejeuner', 'Formules petit-déjeuner', '🍳', true, 7),
  ('Snacks', 'snacks', 'Encas et snacks', '🍿', true, 8)
ON CONFLICT (slug) DO UPDATE SET display_order = EXCLUDED.display_order, is_active = TRUE;

-- 4. ADD INDEXES FOR PERFORMANCE
CREATE INDEX IF NOT EXISTS food_vendors_featured_idx ON public.food_vendors(is_featured) WHERE is_featured = true;
CREATE INDEX IF NOT EXISTS food_vendors_rating_idx ON public.food_vendors(rating DESC);
CREATE INDEX IF NOT EXISTS products_food_type_idx ON public.products(product_type) WHERE product_type = 'food';
CREATE INDEX IF NOT EXISTS products_food_vendor_idx ON public.products(food_vendor_id) WHERE food_vendor_id IS NOT NULL;

-- 5. UPDATE RLS POLICIES FOR ENHANCED FOOD VENDOR MANAGEMENT
DROP POLICY IF EXISTS "Public can read active food vendors" ON public.food_vendors;
CREATE POLICY "Public can read active food vendors" ON public.food_vendors 
  FOR SELECT USING (active = true);
DROP POLICY IF EXISTS "Admins can manage food vendors" ON public.food_vendors;
CREATE POLICY "Admins can manage food vendors" ON public.food_vendors 
  FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- REVERSIBLE (rollback)
--   DROP INDEX IF EXISTS products_food_vendor_idx;
--   DROP INDEX IF EXISTS products_food_type_idx;
--   DROP INDEX IF EXISTS food_vendors_rating_idx;
--   DROP INDEX IF EXISTS food_vendors_featured_idx;
--   DROP TABLE IF EXISTS public.food_categories;
--   ALTER TABLE public.food_vendors 
--     DROP COLUMN IF EXISTS preparation_time_minutes,
--     DROP COLUMN IF EXISTS delivery_fee,
--     DROP COLUMN IF EXISTS minimum_order_amount,
--     DROP COLUMN IF EXISTS rating,
--     DROP COLUMN IF EXISTS is_featured,
--     DROP COLUMN IF EXISTS banner_image_url,
--     DROP COLUMN IF EXISTS image_url,
--     DROP COLUMN IF EXISTS email,
--     DROP COLUMN IF EXISTS phone;
