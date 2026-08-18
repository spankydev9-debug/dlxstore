-- Coupons, order discounts, and food marketplace foundation. Additive only.

CREATE TABLE IF NOT EXISTS public.coupons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('percentage', 'fixed')),
  value NUMERIC NOT NULL CHECK (value > 0),
  min_order NUMERIC NOT NULL DEFAULT 0 CHECK (min_order >= 0),
  max_uses INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  audience TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'returning', 'referral', 'campaign')),
  campaign_id TEXT,
  expires_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read active coupons for validation"
  ON public.coupons FOR SELECT USING (active = true);

CREATE POLICY "Admins can manage coupons"
  ON public.coupons FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS coupon_code TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS discount_amount NUMERIC NOT NULL DEFAULT 0 CHECK (discount_amount >= 0);

CREATE TABLE IF NOT EXISTS public.food_vendors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  province TEXT NOT NULL,
  city TEXT NOT NULL,
  description TEXT,
  is_24_7 BOOLEAN NOT NULL DEFAULT false,
  hours JSONB NOT NULL DEFAULT '[]'::jsonb,
  food_categories TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.food_vendors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read active food vendors"
  ON public.food_vendors FOR SELECT USING (active = true);

CREATE POLICY "Admins can manage food vendors"
  ON public.food_vendors FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS product_type TEXT NOT NULL DEFAULT 'standard'
  CHECK (product_type IN ('standard', 'food'));

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS food_vendor_id UUID
  REFERENCES public.food_vendors(id) ON DELETE SET NULL;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS food_category TEXT;

-- Enforce coupon availability and usage in the database, never in the browser.
CREATE OR REPLACE FUNCTION public.apply_order_coupon()
RETURNS TRIGGER AS $$
DECLARE selected_coupon public.coupons%ROWTYPE; gross_amount NUMERIC; expected_discount NUMERIC;
BEGIN
  IF NEW.coupon_code IS NULL OR btrim(NEW.coupon_code) = '' THEN NEW.coupon_code := NULL; NEW.discount_amount := 0; RETURN NEW; END IF;
  SELECT * INTO selected_coupon FROM public.coupons WHERE code = upper(btrim(NEW.coupon_code)) FOR UPDATE;
  IF NOT FOUND OR NOT selected_coupon.active OR (selected_coupon.expires_at IS NOT NULL AND selected_coupon.expires_at <= now()) OR (selected_coupon.max_uses IS NOT NULL AND selected_coupon.used_count >= selected_coupon.max_uses) THEN RAISE EXCEPTION 'Coupon is invalid or unavailable'; END IF;
  gross_amount := NEW.total_amount + COALESCE(NEW.discount_amount, 0);
  IF gross_amount < selected_coupon.min_order THEN RAISE EXCEPTION 'Coupon minimum order not reached'; END IF;
  expected_discount := CASE WHEN selected_coupon.type = 'percentage' THEN round(gross_amount * selected_coupon.value / 100, 2) ELSE least(selected_coupon.value, gross_amount) END;
  IF COALESCE(NEW.discount_amount, 0) <> expected_discount THEN RAISE EXCEPTION 'Coupon discount does not match'; END IF;
  NEW.coupon_code := selected_coupon.code; UPDATE public.coupons SET used_count = used_count + 1 WHERE id = selected_coupon.id; RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS apply_coupon_on_order ON public.orders;
CREATE TRIGGER apply_coupon_on_order BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.apply_order_coupon();
