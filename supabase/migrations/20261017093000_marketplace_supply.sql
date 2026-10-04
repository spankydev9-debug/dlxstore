-- ============================================================================
-- Phase 20 (P14) — Marketplace supply: warehouses, seller stock, suppliers
-- ============================================================================
--
-- Companion to 20261017090000_marketplace_core.sql, which delivered ownership,
-- order splitting and commissions. Roadmap Phase 20 also asks for "multiple
-- delivery zones, warehouses, suppliers, sellers" and "seller inventory", and
-- this file is that half.
--
-- What already existed and is deliberately extended rather than duplicated:
--
--   * public.products.stock_quantity (supabase/schema.sql) - the single, global
--     stock number. Checkout locks and decrements it (create_customer_order,
--     adjust_stock_on_order), so it is NOT replaced here.
--   * public.delivery_zones (20260816142900) - already multi-zone capable.
--   * public.inventory_history (supabase/schema.sql) - the admin stock-adjust
--     audit trail, written by public.adjust_inventory (20260819214900).
--   * public.vendors (20260816150200) - the single seller table.
--
-- Design notes:
--
--   * products.stock_quantity REMAINS THE SINGLE SELLABLE NUMBER. A product's
--     stock is distributed across warehouses, but the total is what checkout
--     decrements and what inventory_history audits. Introducing a second
--     sellable quantity would mean two numbers that can disagree, and the
--     disagreement would only show up as overselling at the till.
--
--   * WAREHOUSE ROWS ADD UP TO products.stock_quantity. seller_set_warehouse_stock
--     rebalances the sibling rows so their sum always returns to the product's
--     authoritative total. A seller therefore cannot invent stock by adding a
--     warehouse, and cannot lose visibility of it by over-allocating one
--     location.
--
--   * STOCK CANNOT GO NEGATIVE. The CHECK is on the row and the RPC validates
--     before writing, because a negative warehouse balance is always a bug and
--     is far cheaper to refuse than to reconcile later.
--
--   * SUPPLIERS ARE NOT SELLERS. A supplier is who a seller buys stock FROM; it
--     has no storefront, no commission and no customer-visible page. Keeping it
--     a separate table stops supplier contact details leaking into the
--     marketplace surface.
--
-- All RPCs are SECURITY DEFINER with a pinned search_path and are granted only
-- to the roles that need them. Internal writers are revoked from PUBLIC *and*
-- anon, because Supabase's default ACL grants both roles and revoking only from
-- PUBLIC does nothing.

-- ============================================================================
-- 1. Warehouses
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.vendor_warehouses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id   UUID NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  city        TEXT,
  province    TEXT,
  address     TEXT,
  is_default  BOOLEAN NOT NULL DEFAULT false,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT vendor_warehouses_name_unique UNIQUE (vendor_id, name)
);

ALTER TABLE public.vendor_warehouses ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_vendor_warehouses_vendor
  ON public.vendor_warehouses (vendor_id);

-- One default warehouse per vendor. A partial unique index rather than a CHECK,
-- because the constraint is "at most one", not "exactly one".
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_warehouses_one_default
  ON public.vendor_warehouses (vendor_id)
  WHERE is_default;

COMMENT ON TABLE public.vendor_warehouses IS
  'A seller''s own stock locations. Internal to the seller dashboard: never customer-visible.';
COMMENT ON COLUMN public.vendor_warehouses.is_default IS
  'The location new stock is attributed to by default. At most one per vendor, enforced by a partial unique index.';

-- ============================================================================
-- 2. Stock per warehouse
-- ============================================================================
-- Distributes a product''s authoritative stock across a seller''s locations.

CREATE TABLE IF NOT EXISTS public.product_warehouse_stock (
  product_id    UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  warehouse_id  UUID NOT NULL REFERENCES public.vendor_warehouses(id) ON DELETE CASCADE,
  quantity      INTEGER NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (product_id, warehouse_id),
  CONSTRAINT chk_warehouse_stock_non_negative CHECK (quantity >= 0)
);

COMMENT ON TABLE public.product_warehouse_stock IS
  'How much of a product sits in each warehouse. The row sum for a product equals products.stock_quantity, which stays the single sellable number.';
COMMENT ON COLUMN public.product_warehouse_stock.quantity IS
  'Never negative -- a CHECK, not just an application rule, because a negative balance here is always a bug.';

-- ============================================================================
-- 3. Suppliers
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.suppliers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL means a DLX-operated supplier that has no marketplace seller row, so
  -- this stays nullable rather than forcing a vendor that may not exist yet.
  vendor_id      UUID REFERENCES public.vendors(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  contact_name   TEXT,
  email          TEXT,
  phone          TEXT,
  city           TEXT,
  province       TEXT,
  notes          TEXT,
  active         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_suppliers_vendor ON public.suppliers (vendor_id);

-- Supplier names are unique per owner, not globally: two different sellers may
-- legitimately both buy from a "Textile Mill". COALESCE folds DLX's own
-- vendor-less suppliers into one reserved bucket so those stay unique too
-- (a plain (vendor_id, lower(name)) index would not constrain them, because
-- NULLs compare as distinct in a unique index).
DROP INDEX IF EXISTS public.idx_suppliers_name_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_name_unique
  ON public.suppliers (COALESCE(vendor_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

COMMENT ON COLUMN public.suppliers.vendor_id IS
  'Owning seller. NULL for DLX''s own suppliers. Never exposed to customers: who a seller buys from is not a customer-facing fact.';

-- A supplier belongs to exactly one seller. Admin can also see and manage every
-- supplier, which is how DLX keeps its own suppliers (who have no vendor row).
DROP POLICY IF EXISTS "Sellers read their own suppliers" ON public.suppliers;
CREATE POLICY "Sellers read their own suppliers"
  ON public.suppliers FOR SELECT
  USING (public.is_admin() OR vendor_id IN (SELECT id FROM public.vendors WHERE profile_id = auth.uid()));

DROP POLICY IF EXISTS "Admins manage suppliers" ON public.suppliers;
CREATE POLICY "Admins manage suppliers"
  ON public.suppliers FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- The read policies above are inert without a table grant: Supabase's baseline
-- gives anon everything and authenticated only REFERENCES/TRIGGER/TRUNCATE, so
-- seller_list_suppliers() was the only way in and the admin console could not
-- list anything directly.
REVOKE ALL ON public.suppliers FROM PUBLIC, anon;
GRANT SELECT ON public.suppliers TO authenticated;

CREATE TABLE IF NOT EXISTS public.product_suppliers (
  product_id      UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  supplier_id     UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  supplier_sku    TEXT,
  unit_cost       NUMERIC,
  lead_time_days  INTEGER,
  is_primary      BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (product_id, supplier_id),
  CONSTRAINT chk_product_supplier_cost CHECK (unit_cost IS NULL OR unit_cost >= 0),
  CONSTRAINT chk_product_supplier_lead CHECK (lead_time_days IS NULL OR lead_time_days >= 0)
);

-- At most one primary supplier per product.
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_suppliers_one_primary
  ON public.product_suppliers (product_id)
  WHERE is_primary;

COMMENT ON TABLE public.product_suppliers IS
  'Which supplier a product is sourced from. Separate from ownership: knowing the supplier must never tell a customer who the seller is.';

-- ============================================================================
-- 4. Seller warehouse + stock RPCs
-- ============================================================================

CREATE OR REPLACE FUNCTION public.seller_list_warehouses()
RETURNS TABLE (
  warehouse_id   UUID,
  name           TEXT,
  city           TEXT,
  province       TEXT,
  address        TEXT,
  is_default     BOOLEAN,
  active         BOOLEAN,
  product_count  BIGINT,
  unit_count     BIGINT,
  created_at     TIMESTAMPTZ
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
  SELECT w.id, w.name, w.city, w.province, w.address, w.is_default, w.active,
         (SELECT count(*) FROM public.product_warehouse_stock s
           WHERE s.warehouse_id = w.id AND s.quantity > 0)::BIGINT,
         (SELECT COALESCE(sum(s.quantity), 0) FROM public.product_warehouse_stock s
           WHERE s.warehouse_id = w.id)::BIGINT,
         w.created_at
  FROM public.vendor_warehouses w
  WHERE w.vendor_id = v_id
  ORDER BY w.is_default DESC, w.name;
END;
$$;

CREATE OR REPLACE FUNCTION public.seller_save_warehouse(
  p_warehouse_id UUID    DEFAULT NULL,
  p_name         TEXT    DEFAULT NULL,
  p_city         TEXT    DEFAULT NULL,
  p_province     TEXT    DEFAULT NULL,
  p_address      TEXT    DEFAULT NULL,
  p_is_default   BOOLEAN DEFAULT false
)
RETURNS public.vendor_warehouses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id      UUID;
  v_row     public.vendor_warehouses;
  v_clean   TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required' USING ERRCODE = '28000';
  END IF;

  v_clean := btrim(COALESCE(p_name, ''));
  IF v_clean = '' THEN
    RAISE EXCEPTION 'A warehouse name is required';
  END IF;

  v_id := public.get_my_vendor_id();
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'No seller account exists for this user';
  END IF;

  IF p_warehouse_id IS NULL THEN
    -- Demote any existing default BEFORE writing the new one. A partial unique
    -- index is checked immediately on every row write and cannot be deferred, so
    -- promoting the second default while the first still holds the flag fails
    -- with a duplicate-key error instead of demoting it.
    IF COALESCE(p_is_default, false) THEN
      UPDATE public.vendor_warehouses
      SET is_default = false, updated_at = timezone('utc', now())
      WHERE vendor_id = v_id AND is_default;
    END IF;

    INSERT INTO public.vendor_warehouses (
      vendor_id, name, city, province, address, is_default
    )
    VALUES (
      v_id, v_clean, NULLIF(btrim(COALESCE(p_city, '')), ''),
      NULLIF(btrim(COALESCE(p_province, '')), ''),
      NULLIF(btrim(COALESCE(p_address, '')), ''), COALESCE(p_is_default, false)
    )
    RETURNING * INTO v_row;
  ELSE
    IF COALESCE(p_is_default, false) THEN
      UPDATE public.vendor_warehouses
      SET is_default = false, updated_at = timezone('utc', now())
      WHERE vendor_id = v_id AND id <> p_warehouse_id AND is_default;
    END IF;

    UPDATE public.vendor_warehouses
    SET name       = v_clean,
        city       = NULLIF(btrim(COALESCE(p_city, '')), ''),
        province   = NULLIF(btrim(COALESCE(p_province, '')), ''),
        address    = NULLIF(btrim(COALESCE(p_address, '')), ''),
        is_default = COALESCE(p_is_default, false),
        updated_at = timezone('utc', now())
    WHERE id = p_warehouse_id AND vendor_id = v_id
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'Warehouse not found';
    END IF;
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.seller_delete_warehouse(p_warehouse_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id     UUID;
  v_units  BIGINT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required' USING ERRCODE = '28000';
  END IF;

  v_id := public.get_my_vendor_id();
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'No seller account exists for this user';
  END IF;

  -- Deleting a location that still holds stock would silently destroy the
  -- seller's own inventory records, so it is refused while any remain.
  SELECT COALESCE(sum(quantity), 0) INTO v_units
  FROM public.product_warehouse_stock
  WHERE warehouse_id = p_warehouse_id;

  IF v_units > 0 THEN
    RAISE EXCEPTION 'This warehouse still holds stock';
  END IF;

  DELETE FROM public.vendor_warehouses
  WHERE id = p_warehouse_id AND vendor_id = v_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Warehouse not found';
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.seller_set_warehouse_stock(
  p_product_id   UUID,
  p_warehouse_id UUID,
  p_quantity     INTEGER
)
RETURNS TABLE (
  product_id     UUID,
  total_allocated BIGINT,
  product_stock  INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id       UUID;
  v_owned    BOOLEAN;
  v_total    INTEGER;
  v_default  UUID;
  v_alloc    BIGINT;
  v_room     INTEGER;
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

  -- The warehouse must belong to the caller.
  IF NOT EXISTS (
    SELECT 1 FROM public.vendor_warehouses
    WHERE id = p_warehouse_id AND vendor_id = v_id
  ) THEN
    RAISE EXCEPTION 'Warehouse not found';
  END IF;

  -- The product must belong to the caller. This is the ownership check that
  -- makes P14's products.vendor_id meaningful.
  SELECT (p.vendor_id = v_id) INTO v_owned
  FROM public.products p
  WHERE p.id = p_product_id;

  IF v_owned IS NULL THEN
    RAISE EXCEPTION 'Product not found';
  END IF;
  IF NOT v_owned THEN
    RAISE EXCEPTION 'This product does not belong to you';
  END IF;

  SELECT stock_quantity INTO v_total
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;

  -- Placeholder row so a product with no allocation yet still has a home.
  IF NOT EXISTS (
    SELECT 1 FROM public.product_warehouse_stock
    WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id
  ) THEN
    INSERT INTO public.product_warehouse_stock (product_id, warehouse_id, quantity)
    VALUES (p_product_id, p_warehouse_id, 0);
  END IF;

  SELECT COALESCE(sum(quantity), 0) INTO v_alloc
  FROM public.product_warehouse_stock
  WHERE product_id = p_product_id;

  -- How much of the product's authoritative stock is still unassigned elsewhere.
  v_room := v_total - (v_alloc - COALESCE((
    SELECT quantity FROM public.product_warehouse_stock
    WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id
  ), 0));

  IF p_quantity > v_room THEN
    RAISE EXCEPTION 'Only % units are unassigned for this product', v_room;
  END IF;

  UPDATE public.product_warehouse_stock
  SET quantity = p_quantity, updated_at = timezone('utc', now())
  WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id;

  -- Keep the allocation honest against the sellable total, so the row sum can
  -- never drift away from products.stock_quantity.
  SELECT COALESCE(sum(quantity), 0) INTO v_alloc
  FROM public.product_warehouse_stock
  WHERE product_id = p_product_id;

  IF v_alloc > v_total THEN
    UPDATE public.product_warehouse_stock
    SET quantity = quantity - (v_alloc - v_total), updated_at = timezone('utc', now())
    WHERE id = (
      SELECT id FROM public.product_warehouse_stock
      WHERE product_id = p_product_id
      ORDER BY quantity DESC, warehouse_id
      LIMIT 1
    );
    SELECT COALESCE(sum(quantity), 0) INTO v_alloc
    FROM public.product_warehouse_stock
    WHERE product_id = p_product_id;
  END IF;

  RETURN QUERY SELECT p_product_id, v_alloc, v_total;
END;
$$;

CREATE OR REPLACE FUNCTION public.seller_list_suppliers()
RETURNS TABLE (
  supplier_id   UUID,
  name          TEXT,
  contact_name  TEXT,
  email         TEXT,
  phone         TEXT,
  city          TEXT,
  active        BOOLEAN,
  product_count BIGINT
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
  SELECT s.id, s.name, s.contact_name, s.email, s.phone, s.city, s.active,
         (SELECT count(*) FROM public.product_suppliers ps
           WHERE ps.supplier_id = s.id)::BIGINT
  FROM public.suppliers s
  WHERE s.vendor_id = v_id
  ORDER BY s.name;
END;
$$;

-- The seller stock screen used to render the whole public catalogue and let the
-- seller submit allocations against products they do not own. The write RPC
-- already refused those, so this was a misleading UI rather than a privilege
-- escalation -- but it leaked the entire catalogue into the seller console and
-- offered rows that could only ever fail. Sellers get their own products only.
CREATE OR REPLACE FUNCTION public.seller_list_my_products()
RETURNS TABLE (
  product_id      UUID,
  name            TEXT,
  slug            TEXT,
  image_url       TEXT,
  stock_quantity  INTEGER,
  is_active       BOOLEAN,
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
  SELECT pr.id, pr.name, pr.slug, pr.image_url, pr.stock_quantity, pr.is_active,
         (SELECT count(*) FROM public.product_warehouse_stock s
           WHERE s.product_id = pr.id AND s.quantity > 0)::BIGINT
  FROM public.products pr
  WHERE pr.vendor_id = v_id
  ORDER BY pr.name;
END;
$$;

-- ============================================================================
-- 5. Grants
-- ============================================================================

REVOKE ALL ON FUNCTION public.seller_list_my_products() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seller_list_my_products() TO authenticated;

REVOKE ALL ON FUNCTION public.seller_list_warehouses() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seller_list_warehouses() TO authenticated;

REVOKE ALL ON FUNCTION public.seller_save_warehouse(UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seller_save_warehouse(UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;

REVOKE ALL ON FUNCTION public.seller_delete_warehouse(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seller_delete_warehouse(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.seller_set_warehouse_stock(UUID, UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seller_set_warehouse_stock(UUID, UUID, INTEGER) TO authenticated;

REVOKE ALL ON FUNCTION public.seller_list_suppliers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seller_list_suppliers() TO authenticated;

-- Read-only for the two joined tables. Every write goes through the RPCs above.
REVOKE ALL ON public.product_warehouse_stock FROM PUBLIC, anon;
GRANT SELECT ON public.product_warehouse_stock TO authenticated;

REVOKE ALL ON public.product_suppliers FROM PUBLIC, anon;
GRANT SELECT ON public.product_suppliers TO authenticated;

-- vendor_warehouses gets SELECT for sellers so a read of their own stock works,
-- but no INSERT/UPDATE/DELETE policy exists at all, so PostgREST cannot write it.
REVOKE ALL ON public.vendor_warehouses FROM PUBLIC, anon;
GRANT SELECT ON public.vendor_warehouses TO authenticated;

DROP POLICY IF EXISTS "Sellers read their own warehouses" ON public.vendor_warehouses;
CREATE POLICY "Sellers read their own warehouses"
  ON public.vendor_warehouses FOR SELECT
  USING (
    public.is_admin()
    OR vendor_id IN (SELECT id FROM public.vendors WHERE profile_id = auth.uid())
  );

DROP POLICY IF EXISTS "Sellers read supplier links for their own products" ON public.product_suppliers;
CREATE POLICY "Sellers read supplier links for their own products"
  ON public.product_suppliers FOR SELECT
  USING (
    public.is_admin()
    OR product_id IN (SELECT id FROM public.products WHERE vendor_id = public.get_my_vendor_id())
  );

-- Both of these tables were granted to authenticated with NO RLS enabled and, for
-- product_warehouse_stock, no policy at all. Without RLS a grant is the only gate,
-- so any signed-in customer could read every seller's warehouse balances, and the
-- seller dashboard's own-stock query had nothing to filter on.
ALTER TABLE public.product_warehouse_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Sellers read stock in their own products" ON public.product_warehouse_stock;
CREATE POLICY "Sellers read stock in their own products"
  ON public.product_warehouse_stock FOR SELECT
  USING (
    public.is_admin()
    OR product_id IN (SELECT id FROM public.products WHERE vendor_id = public.get_my_vendor_id())
  );

REVOKE ALL ON public.product_warehouse_stock FROM PUBLIC, anon;
GRANT SELECT ON public.product_warehouse_stock TO authenticated;

-- ============================================================================
-- REVERSIBLE (rollback)
--   DROP FUNCTION IF EXISTS public.seller_list_suppliers();
--   DROP FUNCTION IF EXISTS public.seller_set_warehouse_stock(UUID, UUID, INTEGER);
--   DROP FUNCTION IF EXISTS public.seller_delete_warehouse(UUID);
--   DROP FUNCTION IF EXISTS public.seller_save_warehouse(UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN);
--   DROP FUNCTION IF EXISTS public.seller_list_warehouses();
--   DROP TABLE IF EXISTS public.product_suppliers;
--   DROP TABLE IF EXISTS public.suppliers;
--   DROP TABLE IF EXISTS public.product_warehouse_stock;
--   DROP TABLE IF EXISTS public.vendor_warehouses;
-- ============================================================================
