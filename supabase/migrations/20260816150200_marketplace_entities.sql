-- Additive entities for the future multi-vendor marketplace. No existing records are removed or changed.
CREATE TABLE IF NOT EXISTS public.vendors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), profile_id UUID UNIQUE REFERENCES public.profiles(id) ON DELETE SET NULL,
  business_name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, description TEXT, province TEXT NOT NULL,
  city TEXT, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()), updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE TABLE IF NOT EXISTS public.brands (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), vendor_id UUID REFERENCES public.vendors(id) ON DELETE SET NULL,
  name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, description TEXT, logo_url TEXT, featured BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES public.brands(id) ON DELETE SET NULL;
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public can read active vendors" ON public.vendors;
CREATE POLICY "Public can read active vendors" ON public.vendors FOR SELECT USING (status = 'active');
DROP POLICY IF EXISTS "Public can read brands" ON public.brands;
CREATE POLICY "Public can read brands" ON public.brands FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admins can manage vendors" ON public.vendors;
CREATE POLICY "Admins can manage vendors" ON public.vendors FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
DROP POLICY IF EXISTS "Admins can manage brands" ON public.brands;
CREATE POLICY "Admins can manage brands" ON public.brands FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
