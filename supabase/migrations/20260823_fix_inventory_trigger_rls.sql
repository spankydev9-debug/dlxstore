-- Fix the inventory trigger RLS conflict that blocks checkout.
-- The existing adjust_stock_on_order() trigger (from schema.sql) inserts into inventory_history,
-- but the RLS policy requires admin role, causing the trigger to fail for customer orders.
-- This fix adds SET search_path = public to the existing SECURITY DEFINER function to properly bypass RLS.

-- Also ensure orders table has whatsapp_handoff columns from launch hardening migration
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS whatsapp_handoff_status TEXT NOT NULL DEFAULT 'not_attempted'
  CHECK (whatsapp_handoff_status IN ('not_attempted', 'link_opened', 'unavailable', 'not_configured'));
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS whatsapp_handoff_at TIMESTAMPTZ;

-- Update the existing trigger function to add SET search_path = public for proper RLS bypass
CREATE OR REPLACE FUNCTION public.adjust_stock_on_order()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.products
  SET stock_quantity = stock_quantity - new.quantity
  WHERE id = new.product_id;

  INSERT INTO public.inventory_history (product_id, quantity_changed, type, notes)
  VALUES (
    new.product_id,
    -new.quantity,
    'sale',
    'Order placement (Item ID: ' || new.id || ')'
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
