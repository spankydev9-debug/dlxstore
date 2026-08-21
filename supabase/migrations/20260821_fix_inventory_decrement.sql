-- Fix inventory management in create_customer_order RPC
-- This migration adds the missing stock decrement and inventory history recording
-- that was documented in the comments but not implemented in the original function.
-- 
-- SAFETY CHECK: This migration assumes the existing function does NOT decrement stock.
-- If stock is already being decremented elsewhere, this will cause double-decrementing.
-- The original function in 20260819_launch_hardening.sql only validates stock but does not decrement it.

-- First, check if there are any existing triggers or functions that might decrement stock
-- This is a safety check to prevent double-decrementing
DO $$
DECLARE
    trigger_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO trigger_count 
    FROM information_schema.triggers 
    WHERE event_object_table = 'products' 
    AND action_timing = 'AFTER' 
    AND event_manipulation = 'INSERT';
    
    IF trigger_count > 0 THEN
        RAISE EXCEPTION 'SAFETY ERROR: Found % existing AFTER INSERT triggers on products table. This may cause double-decrementing if they already handle stock. Please verify before applying this migration.', trigger_count;
    END IF;
    
    RAISE NOTICE 'Safety check passed: No AFTER INSERT triggers on products table that might conflict with stock decrement.';
END $$;

-- Drop the existing function to recreate it with the fix
DROP FUNCTION IF EXISTS public.create_customer_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, JSONB);

-- Recreate the function with proper inventory management
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

  -- Validate products and calculate gross amount
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

  -- Create the order
  INSERT INTO public.orders (
    customer_id, customer_name, phone_number, municipality, neighborhood, avenue, house_number,
    delivery_notes, coupon_code, discount_amount, total_amount, status
  ) VALUES (
    auth.uid(), btrim(p_customer_name), btrim(p_phone_number), btrim(p_municipality), btrim(p_neighborhood), btrim(p_avenue),
    NULLIF(btrim(p_house_number), ''), NULLIF(btrim(p_delivery_notes), ''), NULLIF(upper(btrim(p_coupon_code)), ''), p_discount_amount, p_total_amount, 'pending'
  ) RETURNING * INTO created_order;

  -- Create order items
  FOR item IN SELECT * FROM jsonb_to_recordset(p_items) AS row(product_id UUID, quantity INTEGER, size TEXT, color TEXT)
  LOOP
    SELECT price, discount_price INTO locked_product FROM public.products WHERE id = item.product_id;
    INSERT INTO public.order_items (order_id, product_id, quantity, price_at_sale, size, color)
    VALUES (created_order.id, item.product_id, item.quantity, COALESCE(locked_product.discount_price, locked_product.price), NULLIF(btrim(item.size), ''), NULLIF(btrim(item.color), ''));
  END LOOP;

  -- FIX: Decrement stock and record inventory history (the missing critical piece)
  FOR item IN SELECT * FROM jsonb_to_recordset(p_items) AS row(product_id UUID, quantity INTEGER, size TEXT, color TEXT)
  LOOP
    -- Decrement stock
    UPDATE public.products 
    SET stock_quantity = stock_quantity - item.quantity
    WHERE id = item.product_id;
    
    -- Record inventory history
    INSERT INTO public.inventory_history (product_id, quantity_changed, type, notes)
    VALUES (item.product_id, -item.quantity, 'sale', 'Order ' || created_order.id);
  END LOOP;

  RETURN created_order;
END;
$$;

-- Revoke and grant permissions
REVOKE ALL ON FUNCTION public.create_customer_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_customer_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, JSONB) TO authenticated;

-- Add comment explaining the fix
COMMENT ON FUNCTION public.create_customer_order IS 'Creates a customer order with items, validates inventory, decrements stock atomically, and records inventory history. SECURITY INVOKER ensures it runs with the user''s permissions and RLS policies.';