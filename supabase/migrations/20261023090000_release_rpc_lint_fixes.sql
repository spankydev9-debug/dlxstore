-- DLXSTORE — forward fixes for verified production RPC lint errors
--
-- `supabase db lint --linked` identified four existing function-body errors.
-- This is intentionally a forward-only, code-only repair: it does not alter
-- tables, data, policies, buckets, grants, or function signatures.  It keeps
-- the existing SECURITY DEFINER/search_path conventions and reissues the
-- existing authenticated grants explicitly.
--
-- The seller product-list repair is required by the seller AI workspaces: they
-- call seller_list_my_products() to select only the caller's own products.

-- The participant alias is cpr inside the JSON aggregate.  The old `cp`
-- reference made the realtime conversation RPC fail before it could return.
CREATE OR REPLACE FUNCTION public.get_conversation_with_realtime_data(
  p_conversation_id UUID
)
RETURNS TABLE (
  conversation_id UUID,
  conversation_type TEXT,
  conversation_title TEXT,
  conversation_status TEXT,
  last_message_at TIMESTAMPTZ,
  participants JSONB,
  typing_users JSONB,
  pinned_messages JSONB,
  unread_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.can_access_conversation(p_conversation_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.type,
    c.title,
    c.status,
    c.last_message_at,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'profile_id', p.id,
        'full_name', p.full_name,
        'role', p.role,
        'phone', p.phone,
        'email', p.email,
        'presence', jsonb_build_object('status', up.status, 'last_seen_at', up.last_seen_at),
        'last_read_at', cpr.last_read_at,
        'last_delivered_at', cpr.last_delivered_at
      ) ORDER BY (p.id = v_uid) DESC, p.full_name)
      FROM public.conversation_participants cpr
      JOIN public.profiles p ON p.id = cpr.profile_id
      LEFT JOIN public.user_presence up ON up.user_id = p.id
      WHERE cpr.conversation_id = c.id
    ), '[]'::JSONB),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', ti.user_id,
        'full_name', p.full_name,
        'is_typing', ti.is_typing,
        'last_updated_at', ti.last_updated_at
      ))
      FROM public.typing_indicators ti
      JOIN public.profiles p ON p.id = ti.user_id
      WHERE ti.conversation_id = c.id
        AND ti.is_typing = true
        AND ti.last_updated_at > now() - interval '10 seconds'
    ), '[]'::JSONB),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'message_id', pm.message_id,
        'pinned_by', pm.pinned_by,
        'pinned_by_name', pb.full_name,
        'pinned_at', pm.pinned_at,
        'note', pm.note
      ) ORDER BY pm.pinned_at DESC)
      FROM public.pinned_messages pm
      JOIN public.profiles pb ON pb.id = pm.pinned_by
      WHERE pm.conversation_id = c.id
    ), '[]'::JSONB),
    (
      SELECT count(*)::BIGINT
      FROM public.messages m
      WHERE m.conversation_id = c.id
        AND m.sender_id <> v_uid
        AND m.deleted_at IS NULL
        AND m.created_at > COALESCE((
          SELECT participant.last_read_at
          FROM public.conversation_participants participant
          WHERE participant.conversation_id = c.id AND participant.profile_id = v_uid
        ), 'epoch'::TIMESTAMPTZ)
    )
  FROM public.conversations c
  WHERE c.id = p_conversation_id;
END;
$$;

-- Orders have UUID ids, not an order_number column.  This retains the project
-- wide user-facing reference convention used by communication notifications.
CREATE OR REPLACE FUNCTION public.seller_list_sub_orders(p_status TEXT DEFAULT NULL)
RETURNS TABLE (
  sub_order_id UUID,
  order_id UUID,
  order_ref TEXT,
  status TEXT,
  customer_name TEXT,
  city TEXT,
  subtotal NUMERIC,
  commission NUMERIC,
  net_amount NUMERIC,
  item_count BIGINT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required' USING ERRCODE = '28000';
  END IF;
  v_id := public.get_my_vendor_id();
  IF v_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.order_id,
    'D-' || upper(left(o.id::TEXT, 8)),
    s.status,
    o.customer_name,
    o.municipality,
    s.subtotal,
    s.commission_amount,
    s.vendor_net_amount,
    (SELECT count(*)::BIGINT FROM public.order_items oi WHERE oi.sub_order_id = s.id),
    s.created_at
  FROM public.order_sub_orders s
  JOIN public.orders o ON o.id = s.order_id
  WHERE s.vendor_id = v_id
    AND (p_status IS NULL OR p_status = '' OR s.status = p_status)
  ORDER BY s.created_at DESC
  LIMIT 200;
END;
$$;

-- Products keep their media in product_images.  Return a deterministic primary
-- image rather than referring to the nonexistent products.image_url column.
CREATE OR REPLACE FUNCTION public.seller_list_my_products()
RETURNS TABLE (
  product_id UUID,
  name TEXT,
  slug TEXT,
  image_url TEXT,
  stock_quantity INTEGER,
  is_active BOOLEAN,
  warehouse_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required' USING ERRCODE = '28000';
  END IF;
  v_id := public.get_my_vendor_id();
  IF v_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    pr.id,
    pr.name,
    pr.slug,
    (
      SELECT pi.image_url
      FROM public.product_images pi
      WHERE pi.product_id = pr.id
      ORDER BY pi.is_primary DESC, pi.display_order ASC, pi.id
      LIMIT 1
    ),
    pr.stock_quantity,
    pr.is_active,
    (SELECT count(*)::BIGINT FROM public.product_warehouse_stock stock
      WHERE stock.product_id = pr.id AND stock.quantity > 0)
  FROM public.products pr
  WHERE pr.vendor_id = v_id
  ORDER BY pr.name;
END;
$$;

-- Qualify every column reference that collides with the TABLE-return column
-- names, so PL/pgSQL cannot resolve it as an output variable.
CREATE OR REPLACE FUNCTION public.seller_set_warehouse_stock(
  p_product_id UUID,
  p_warehouse_id UUID,
  p_quantity INTEGER
)
RETURNS TABLE (
  product_id UUID,
  total_allocated BIGINT,
  product_stock INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_owned BOOLEAN;
  v_total INTEGER;
  v_alloc BIGINT;
  v_room INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required' USING ERRCODE = '28000';
  END IF;
  IF p_quantity IS NULL OR p_quantity < 0 THEN
    RAISE EXCEPTION 'Quantity cannot be negative';
  END IF;
  v_id := public.get_my_vendor_id();
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'No seller account exists for this user';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.vendor_warehouses warehouse
    WHERE warehouse.id = p_warehouse_id AND warehouse.vendor_id = v_id
  ) THEN
    RAISE EXCEPTION 'Warehouse not found';
  END IF;
  SELECT product.vendor_id = v_id INTO v_owned
  FROM public.products product WHERE product.id = p_product_id;
  IF v_owned IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;
  IF NOT v_owned THEN RAISE EXCEPTION 'This product does not belong to you'; END IF;
  SELECT product.stock_quantity INTO v_total
  FROM public.products product WHERE product.id = p_product_id FOR UPDATE;

  IF NOT EXISTS (
    SELECT 1 FROM public.product_warehouse_stock stock
    WHERE stock.product_id = p_product_id AND stock.warehouse_id = p_warehouse_id
  ) THEN
    INSERT INTO public.product_warehouse_stock (product_id, warehouse_id, quantity)
    VALUES (p_product_id, p_warehouse_id, 0);
  END IF;
  SELECT COALESCE(sum(stock.quantity), 0) INTO v_alloc
  FROM public.product_warehouse_stock stock WHERE stock.product_id = p_product_id;
  v_room := v_total - (v_alloc - COALESCE((
    SELECT stock.quantity FROM public.product_warehouse_stock stock
    WHERE stock.product_id = p_product_id AND stock.warehouse_id = p_warehouse_id
  ), 0));
  IF p_quantity > v_room THEN
    RAISE EXCEPTION 'Only % units are unassigned for this product', v_room;
  END IF;
  UPDATE public.product_warehouse_stock stock
  SET quantity = p_quantity, updated_at = timezone('utc', now())
  WHERE stock.product_id = p_product_id AND stock.warehouse_id = p_warehouse_id;
  SELECT COALESCE(sum(stock.quantity), 0) INTO v_alloc
  FROM public.product_warehouse_stock stock WHERE stock.product_id = p_product_id;
  IF v_alloc > v_total THEN
    UPDATE public.product_warehouse_stock stock
    SET quantity = stock.quantity - (v_alloc - v_total), updated_at = timezone('utc', now())
    WHERE stock.id = (
      SELECT allocation.id FROM public.product_warehouse_stock allocation
      WHERE allocation.product_id = p_product_id
      ORDER BY allocation.quantity DESC, allocation.warehouse_id
      LIMIT 1
    );
    SELECT COALESCE(sum(stock.quantity), 0) INTO v_alloc
    FROM public.product_warehouse_stock stock WHERE stock.product_id = p_product_id;
  END IF;
  RETURN QUERY SELECT p_product_id, v_alloc, v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.get_conversation_with_realtime_data(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_conversation_with_realtime_data(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.seller_list_sub_orders(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seller_list_sub_orders(TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.seller_list_my_products() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seller_list_my_products() TO authenticated;
REVOKE ALL ON FUNCTION public.seller_set_warehouse_stock(UUID, UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seller_set_warehouse_stock(UUID, UUID, INTEGER) TO authenticated;

-- Rollback: restore the preceding function bodies from their defining
-- migrations. No data rollback is required because this migration has no DML.
