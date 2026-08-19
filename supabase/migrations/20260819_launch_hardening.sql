-- Launch hardening: catalogue controls, storage, transactional checkout, and safe operational handoff.
-- Apply through the Supabase CLI/dashboard before deploying this application version.

-- Store operators can control visibility, lifecycle, tags, and stock thresholds without code edits.
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}'::TEXT[];
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER NOT NULL DEFAULT 3 CHECK (low_stock_threshold >= 0);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS whatsapp_handoff_status TEXT NOT NULL DEFAULT 'not_attempted'
  CHECK (whatsapp_handoff_status IN ('not_attempted', 'link_opened', 'unavailable', 'not_configured'));
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS whatsapp_handoff_at TIMESTAMPTZ;

-- Only active catalogue content is public. Administrators retain access through the existing admin policies.
DROP POLICY IF EXISTS "Categories are readable by everyone" ON public.categories;
CREATE POLICY "Public can read active categories" ON public.categories FOR SELECT USING (is_active = true);
DROP POLICY IF EXISTS "Products are readable by everyone" ON public.products;
CREATE POLICY "Public can read visible products" ON public.products FOR SELECT USING (is_active = true AND is_archived = false);
DROP POLICY IF EXISTS "Product images are readable by everyone" ON public.product_images;
CREATE POLICY "Public can read images for visible products" ON public.product_images FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.products WHERE products.id = product_images.product_id AND products.is_active = true AND products.is_archived = false)
);

-- Product assets are deliberately public for storefront image delivery, while writes remain admin-only.
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "Public can read product images" ON storage.objects;
CREATE POLICY "Public can read product images" ON storage.objects FOR SELECT USING (bucket_id = 'product-images');
DROP POLICY IF EXISTS "Admins can manage product image objects" ON storage.objects;
CREATE POLICY "Admins can manage product image objects" ON storage.objects FOR ALL
  USING (bucket_id = 'product-images' AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (bucket_id = 'product-images' AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- One database operation safely adjusts stock and records the audit trail. The browser never performs a read-modify-write cycle.
CREATE OR REPLACE FUNCTION public.adjust_inventory(
  p_product_id UUID,
  p_quantity_changed INTEGER,
  p_type TEXT,
  p_notes TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE current_stock INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Only administrators can adjust inventory';
  END IF;
  IF p_quantity_changed = 0 OR p_type NOT IN ('sale', 'restock', 'manual_adjustment') THEN
    RAISE EXCEPTION 'Invalid inventory adjustment';
  END IF;

  SELECT stock_quantity INTO current_stock FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
  IF current_stock + p_quantity_changed < 0 THEN RAISE EXCEPTION 'Insufficient inventory'; END IF;

  UPDATE public.products SET stock_quantity = current_stock + p_quantity_changed WHERE id = p_product_id;
  INSERT INTO public.inventory_history (product_id, quantity_changed, type, notes)
  VALUES (p_product_id, p_quantity_changed, p_type, p_notes);
END;
$$;

-- The checkout RPC validates ownership, locks inventory, derives prices from the catalogue, and creates the order/items atomically.
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
SECURITY INVOKER
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

-- This only records the browser handoff result. It does not claim WhatsApp Business delivery or webhook automation.
CREATE OR REPLACE FUNCTION public.record_order_whatsapp_handoff(p_order_id UUID, p_status TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_status NOT IN ('link_opened', 'unavailable', 'not_configured') THEN RAISE EXCEPTION 'Invalid order handoff update'; END IF;
  UPDATE public.orders
  SET whatsapp_handoff_status = p_status, whatsapp_handoff_at = timezone('utc', now()), updated_at = timezone('utc', now())
  WHERE id = p_order_id AND customer_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_inventory(UUID, INTEGER, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_customer_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_order_whatsapp_handoff(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.adjust_inventory(UUID, INTEGER, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_customer_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_order_whatsapp_handoff(UUID, TEXT) TO authenticated;

-- Realtime is opportunistic; the tracking page still polls safely when replication is unavailable.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
