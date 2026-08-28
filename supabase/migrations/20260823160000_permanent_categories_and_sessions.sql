-- DLXSTORE — Permanent Categories + Sessions (Phase 2)
-- Additive + reversible. Preserves existing categories and product links.
-- The 3 seed categories are reused (ids untouched); 8 new categories added
-- idempotently by slug. Then a reusable Sessions system (sessions +
-- session_products) is added with RLS mirroring the existing admin model.
-- Sections ARE NOT categories: a product keeps ONE permanent category but may
-- belong to MANY sections.

-- 1. PERMANENT CATEGORIES (idempotent by stable slug)
INSERT INTO public.categories (name, slug, description, image_url, is_active, display_order)
VALUES
  ('Électronique & High-Tech', 'electronique',       'Électronique et high-tech.', NULL, true, 1),
  ('Maison & Énergie',         'maison-energie',     'Maison et énergie.',        NULL, true, 2),
  ('Mode & Vêtements',         'mode-vetements',     'Mode et vêtements.',        NULL, true, 3),
  ('Fashion & Streetwear',     'fashion-streetwear', 'Fashion et streetwear.',    NULL, true, 4),
  ('Fragrance & Cologne',      'fragrance',          'Fragrances et colognes.',   NULL, true, 5),
  ('Beauté & Soins',           'beaute-soins',       'Beauté et soins.',          NULL, true, 6),
  ('Sport & Fitness',          'sport-fitness',      'Sport et fitness.',         NULL, true, 7),
  ('Chaussures',               'chaussures',         'Chaussures.',               NULL, true, 8),
  ('Accessoires',              'accessoires',        'Accessoires.',              NULL, true, 9),
  ('DLX Food',                 'dlx-food',           'Alimentation et épicerie.', NULL, true, 10),
  ('Autres',                   'autres',             'Autres articles.',          NULL, true, 11)
ON CONFLICT (slug) DO UPDATE SET display_order = EXCLUDED.display_order, is_active = TRUE;

-- 2. SESSIONS
CREATE TABLE IF NOT EXISTS public.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  image_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public can read active sessions" ON public.sessions;
CREATE POLICY "Public can read active sessions" ON public.sessions FOR SELECT USING (is_active = true);
DROP POLICY IF EXISTS "Admins can manage sessions" ON public.sessions;
CREATE POLICY "Admins can manage sessions" ON public.sessions FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- 3. SESSION_PRODUCTS (many-to-many)
CREATE TABLE IF NOT EXISTS public.session_products (
  session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (session_id, product_id)
);
ALTER TABLE public.session_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public can read session products for active sessions" ON public.session_products;
CREATE POLICY "Public can read session products for active sessions" ON public.session_products
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.sessions WHERE sessions.id = session_products.session_id AND sessions.is_active = true));
DROP POLICY IF EXISTS "Admins can manage session products" ON public.session_products;
CREATE POLICY "Admins can manage session products" ON public.session_products FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE INDEX IF NOT EXISTS session_products_product_id_idx ON public.session_products (product_id);
CREATE INDEX IF NOT EXISTS session_products_session_id_idx ON public.session_products (session_id);

-- 4. SEED DEFAULT SESSIONS (idempotent by slug)
INSERT INTO public.sessions (name, slug, description, is_active, display_order)
VALUES
  ('The New Drop',   'the-new-drop',   'Freshly added products, first to know.', true, 1),
  ('Couples Goals',  'couples-goals',   'Two people, one vibe.',        true, 2),
  ('Best Sellers',   'best-sellers',    'Our most loved products.',     true, 3),
  ('Trending Now',   'trending-now',    'What everyone is looking at.',  true, 4)
ON CONFLICT (slug) DO NOTHING;

-- REVERSIBLE (rollback)
--   DROP TABLE IF EXISTS public.session_products;
--   DROP TABLE IF EXISTS public.sessions;
--   The 8 added categories are left in place (products may reference them).