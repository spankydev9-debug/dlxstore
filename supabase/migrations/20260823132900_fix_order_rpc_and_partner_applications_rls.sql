
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = "admin"
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon;

-- Fix create_customer_order RPC to run with SECURITY DEFINER so that SELECT ... FOR UPDATE on public.products works for customer checkout under RLS.
CREATE OR REPLACE FUNCTION public.create_customer_order(
  p_customer_name TEXT,
  p_phone_number TEXT,
  p_municipality TEXT,
  p_neighborhood TEXT,
  p_avenue TEXT,
  p_house_number TEXT,
  p_delivery_notes TEXT,
  p_coupon_code TEXT,
  p_discount_amount NUMERIC,
  p_total_amount NUMERIC,
  p_items JSONB
) RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item RECORD;
  locked_product RECORD;
  gross_amount NUMERIC := 0;
  created_order public.orders;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication is required'; END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'At least one item is required'; END IF;
  IF p_discount_amount < 0 THEN RAISE EXCEPTION 'Invalid discount'; END IF;
  IF (p_coupon_code IS NULL OR btrim(p_coupon_code) = '') AND p_discount_amount <> 0 THEN RAISE EXCEPTION 'A coupon is required for a discount'; END IF;

  FOR item IN SELECT * FROM jsonb_to_recordset(p_items) AS row(product_id UUID, quantity INTEGER, size TEXT, color TEXT)
  LOOP
    IF item.product_id IS NULL OR item.quantity IS NULL OR item.quantity <= 0 THEN RAISE EXCEPTION 'Invalid order item'; END IF;
    SELECT id, stock_quantity, price, discount_price INTO locked_product FROM public.products
      WHERE id = item.product_id AND is_active = true AND is_archived = false FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'A requested product is unavailable'; END IF;
    IF locked_product.stock_quantity < item.quantity THEN RAISE EXCEPTION 'Insufficient inventory for a requested product'; END IF;
    gross_amount := gross_amount + COALESCE(locked_product.discount_price, locked_product.price) * item.quantity;
  END LOOP;

  IF round(gross_amount - p_discount_amount, 2) <> round(p_total_amount, 2) OR p_total_amount < 0 THEN
    RAISE EXCEPTION 'Order total does not match the current catalogue';
  END IF;

  INSERT INTO public.orders (
    customer_id, customer_name, phone_number, municipality, neighborhood, avenue, house_number,
    delivery_notes, coupon_code, discount_amount, total_amount, status
  ) VALUES (
    auth.uid(), btrim(p_customer_name), btrim(p_phone_number), btrim(p_municipality), btrim(p_neighborhood), btrim(p_avenue),
    NULLIF(btrim(p_house_number), ''), NULLIF(btrim(p_delivery_notes), ''), NULLIF(upper(btrim(p_coupon_code)), ''), p_discount_amount, p_total_amount, 'pending'
  ) RETURNING * INTO created_order;

  FOR item IN SELECT * FROM jsonb_to_recordset(p_items) AS row(product_id UUID, quantity INTEGER, size TEXT, color TEXT)
  LOOP
    SELECT price, discount_price INTO locked_product FROM public.products WHERE id = item.product_id;
    INSERT INTO public.order_items (order_id, product_id, quantity, price_at_sale, size, color)
    VALUES (created_order.id, item.product_id, item.quantity, COALESCE(locked_product.discount_price, locked_product.price), NULLIF(btrim(item.size), ''), NULLIF(btrim(item.color), ''));
  END LOOP;
  RETURN created_order;
END;
$$;

-- Partner Applications: add applicant_id and set up RLS policies so authenticated users can submit and view their own applications
ALTER TABLE public.partner_applications ADD COLUMN IF NOT EXISTS applicant_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL DEFAULT auth.uid();

DROP POLICY IF EXISTS "Anyone can submit partner applications" ON public.partner_applications;
DROP POLICY IF EXISTS "Authenticated users can submit partner applications" ON public.partner_applications;
DROP POLICY IF EXISTS "Users can view their own partner applications" ON public.partner_applications;
DROP POLICY IF EXISTS "Admins can manage partner applications" ON public.partner_applications;

-- Policy for insertion: authenticated customers can submit their own applications
DROP POLICY IF EXISTS "Authenticated users can submit partner applications" ON public.partner_applications;
CREATE POLICY "Authenticated users can submit partner applications" ON public.partner_applications
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated' AND (applicant_id IS NULL OR applicant_id = auth.uid())
  );

-- Policy for select: users can view their own applications, admins can view all
DROP POLICY IF EXISTS "Users can view their own partner applications" ON public.partner_applications;
CREATE POLICY "Users can view their own partner applications" ON public.partner_applications
  FOR SELECT USING (
    applicant_id = auth.uid() OR public.is_admin()
  );

-- Policy for admin full access: admins can manage (SELECT, UPDATE, DELETE) all partner applications
DROP POLICY IF EXISTS "Admins can manage partner applications" ON public.partner_applications;
CREATE POLICY "Admins can manage partner applications" ON public.partner_applications
  FOR ALL USING (
    public.is_admin()
  );
