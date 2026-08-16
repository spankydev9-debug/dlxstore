-- Additive marketplace and geography foundation. Apply through the Supabase migration workflow.
CREATE TABLE IF NOT EXISTS public.partner_applications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), business_name TEXT NOT NULL, owner_name TEXT NOT NULL,
  phone TEXT NOT NULL, email TEXT, social_media TEXT, province TEXT NOT NULL, city TEXT NOT NULL,
  business_category TEXT NOT NULL, description TEXT NOT NULL, products_services TEXT, location TEXT,
  collaboration_type TEXT NOT NULL CHECK (collaboration_type IN ('vendor','brand','creator','partner')),
  additional_information TEXT, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reviewing','approved','declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
ALTER TABLE public.partner_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can submit partner applications" ON public.partner_applications FOR INSERT WITH CHECK (true);
CREATE POLICY "Admins can manage partner applications" ON public.partner_applications FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE TABLE IF NOT EXISTS public.delivery_zones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), country_code TEXT NOT NULL DEFAULT 'CD', province TEXT NOT NULL,
  city TEXT, territory TEXT, commune TEXT, active BOOLEAN NOT NULL DEFAULT false, fee NUMERIC NOT NULL DEFAULT 0 CHECK (fee >= 0), currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD','CDF')), created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
ALTER TABLE public.delivery_zones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can read active delivery zones" ON public.delivery_zones FOR SELECT USING (active = true);
CREATE POLICY "Admins can manage delivery zones" ON public.delivery_zones FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_zone_id UUID REFERENCES public.delivery_zones(id) ON DELETE SET NULL;

-- Do not trust role values supplied during sign-up metadata. Administrators are assigned
-- through an authenticated, privileged operational process, never by the browser.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (new.id, new.email, COALESCE(new.raw_user_meta_data->>'full_name', 'DLXSTORE Customer'), 'customer');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
