-- Fix customer order creation by ensuring RLS policies are compatible with create_customer_order RPC
-- The RPC function uses auth.uid() directly, so the INSERT policy must allow authenticated users
-- to insert orders where customer_id = auth.uid()

-- Drop the restrictive policy and replace with one that works with the RPC function
DROP POLICY IF EXISTS "Authenticated users can create their own orders" ON public.orders;

-- Create a policy that allows authenticated users to insert orders where customer_id matches their auth.uid()
-- This is compatible with the create_customer_order RPC which sets customer_id = auth.uid()
DROP POLICY IF EXISTS "Authenticated users can create their own orders" ON public.orders;
CREATE POLICY "Authenticated users can create their own orders" ON public.orders
  FOR INSERT WITH CHECK (auth.uid() = customer_id);

-- Ensure the order_items policy is also compatible
DROP POLICY IF EXISTS "Users can insert items into their own orders" ON public.order_items;
CREATE POLICY "Users can insert items into their own orders" ON public.order_items
  FOR INSERT WITH CHECK (EXISTS (
    SELECT 1 FROM public.orders 
    WHERE id = order_items.order_id AND customer_id = auth.uid()
  ));
