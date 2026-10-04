-- ============================================================================
-- Phase 20 (P14) — Marketplace: multi-vendor, order splitting, commissions
-- ============================================================================
--
-- Roadmap Phase 20. Goma -> Gisenyi -> other markets. DLX stops being only its
-- own inventory and becomes a marketplace where third-party sellers list, sell
-- and get paid. This migration delivers the money-and-ownership core; a
-- companion migration (20261017093000_marketplace_supply.sql) adds warehouses,
-- seller stock, suppliers and payouts.
--
-- What already existed and is deliberately extended rather than duplicated:
--
--   * public.vendors (20260816150200, 20260826170000) - the single partner/shop
--     table, with profile_id, slug, status and an inert commission_rate column.
--   * public.shop_products (20260826170000) - a product <-> shop M:N join that
--     models CURATION ("this product appears in my shop"), not ownership.
--   * public.partner_applications (20260816142900, 20260823132900) - seller
--     intake. Approving one changed a string and created nothing.
--   * public.delivery_zones (20260816142900) - already multi-zone capable.
--   * public.create_customer_order (20260823140000) - the single checkout write
--     path, which inserts one flat orders row plus flat order_items.
--   * public.deliveries (supabase/schema.sql) - UNIQUE(order_id), so exactly one
--     delivery per order.
--   * public.products.vendor_id (20260816142900) - DEAD and MISPOINTED: it
--     references public.profiles(id), not public.vendors(id), and no code has
--     ever read or written it.
--
-- Design notes:
--
--   * OWNERSHIP IS A SINGLE COLUMN, CURATION STAYS A JOIN. A product has at most
--     one seller (products.vendor_id), while shop_products keeps meaning "listed
--     in this storefront". Collapsing those two ideas would have broken the
--     existing shop pages.
--
--   * SUB-ORDERS ARE DERIVED FROM ORDER_ITEMS, NEVER DUPLICATED. A trigger
--     upserts one order_sub_orders row per (order, vendor) as items land, and
--     attributes each order_items row to it. create_customer_order is therefore
--     NOT rewritten: its arithmetic stays exactly as tested, and the split is
--     always consistent with the items because the items are the source of
--     truth. Rewriting a verified checkout RPC to also split orders would have
--     doubled the ways it could be wrong.
--
--   * COMMISSION IS NOT OWED UNTIL THE SELLER HAS EARNED IT. COD is the only
--     payment method in DLX, so a sub-order that is merely created has earned
--     nothing. The ledger entry is booked when the sub-order reaches
--     'delivered' and reversed if it is cancelled. A pending row is never
--     payable.
--
--   * THE COMMISSION RATE IS LOCKED AT SALE TIME. Changing vendors.commission_rate
--     affects future sales only; already-created sub-orders keep the rate they
--     were sold at. Rewriting historical sub-orders when a rate changes would
--     silently move money that was already promised to a seller.
--
--   * A SUSPENDED VENDOR STILL SELLS, AT ZERO COMMISSION. Dropping the
--     attribution would lose the order entirely; keeping it at the seller's
--     rate would pay a suspended seller. Zero is the honest middle: the
--     revenue is attributed, and no money is promised until an admin decides.
--
--   * 'refunded' IS ADDED TO orders.status. The status set was missing the one
--     state a marketplace needs to reverse a commission in. Note that the live
--     database never received the chk_order_status constraint that
--     supabase/schema.sql:84 declares; this migration adds it, widened by
--     'refunded', so a fresh install and a migrated database agree.
--
--   * GUEST CHECKOUT PRODUCES SUB-ORDERS TOO. A guest order is still a real sale
--     owed to a seller. Order splitting keys off products.vendor_id and never
--     off auth.uid(), so this happens for free.
--
-- All RPCs are SECURITY DEFINER with a pinned search_path and are granted only
-- to the roles that need them. Internal writers are revoked from PUBLIC *and*
-- anon, because Supabase's default ACL grants both roles and revoking only from
-- PUBLIC does nothing.

-- ============================================================================
-- 1. Product ownership
-- ============================================================================
-- products.vendor_id already exists but references public.profiles(id). It has
-- zero non-NULL rows and no reader anywhere in the codebase, so repointing it is
-- a pure correction: nothing can be lost because nothing was ever written.

DO $$
DECLARE
  v_constraint TEXT;
BEGIN
  SELECT conname INTO v_constraint
  FROM pg_constraint
  WHERE conrelid = 'public.products'::regclass
    AND contype = 'f'
    AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
                        WHERE attrelid = 'public.products'::regclass AND attname = 'vendor_id')];

  IF v_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.products DROP CONSTRAINT %I', v_constraint);
  END IF;
END;
$$;

DO $$
BEGIN
  ALTER TABLE public.products
    ADD CONSTRAINT products_vendor_id_fkey
    FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

COMMENT ON COLUMN public.products.vendor_id IS
  'Owning seller. NULL means DLX-owned stock: no sub-order, no commission, and the item is fulfilled in-house. Set once at listing time and never silently reassigned, because reassigning it would move commission on sales that already happened.';

CREATE INDEX IF NOT EXISTS idx_products_vendor_id
  ON public.products (vendor_id)
  WHERE vendor_id IS NOT NULL;

-- ============================================================================
-- 2. Order status gains 'refunded'
-- ============================================================================
-- The live database is missing chk_order_status entirely even though
-- supabase/schema.sql:84 declares it. Adding it here restores the declared
-- guarantee and widens the set with the one state a marketplace needs.

DO $$
BEGIN
  ALTER TABLE public.orders
    DROP CONSTRAINT IF EXISTS chk_order_status;
EXCEPTION WHEN undefined_object THEN NULL;
END;
$$;

DO $$
BEGIN
  ALTER TABLE public.orders
    ADD CONSTRAINT chk_order_status
    CHECK (status IN ('pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery',
                      'delivered', 'cancelled', 'refunded'));
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

-- ============================================================================
-- 3. Sub-orders
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.order_sub_orders (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  vendor_id          UUID NOT NULL REFERENCES public.vendors(id) ON DELETE RESTRICT,
  status             TEXT NOT NULL DEFAULT 'pending',
  subtotal           NUMERIC NOT NULL DEFAULT 0,
  commission_rate    NUMERIC NOT NULL DEFAULT 0,
  commission_amount  NUMERIC NOT NULL DEFAULT 0,
  vendor_net_amount  NUMERIC NOT NULL DEFAULT 0,
  currency           TEXT NOT NULL DEFAULT 'USD',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT order_sub_orders_unique_per_vendor UNIQUE (order_id, vendor_id),
  CONSTRAINT chk_sub_order_status
    CHECK (status IN ('pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery',
                      'delivered', 'cancelled', 'refunded')),
  CONSTRAINT chk_sub_order_amounts CHECK (
    subtotal >= 0 AND commission_rate >= 0 AND commission_rate <= 100
    AND commission_amount >= 0 AND vendor_net_amount >= 0
  )
);

ALTER TABLE public.order_sub_orders ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_order_sub_orders_order   ON public.order_sub_orders (order_id);
CREATE INDEX IF NOT EXISTS idx_order_sub_orders_vendor  ON public.order_sub_orders (vendor_id, status);
CREATE INDEX IF NOT EXISTS idx_order_sub_orders_pending ON public.order_sub_orders (order_id)
  WHERE status NOT IN ('delivered', 'cancelled', 'refunded');

COMMENT ON TABLE public.order_sub_orders IS
  'One row per seller per order. Derived from order_items by trigger, never written directly, so the split can never disagree with the items it summarises.';
COMMENT ON COLUMN public.order_sub_orders.commission_rate IS
  'vendors.commission_rate captured at sale time. Deliberately NOT re-read from vendors on update: a later rate change must not retroactively move money already promised to a seller.';
COMMENT ON COLUMN public.order_sub_orders.vendor_net_amount IS
  'What the seller is owed for this sub-order: subtotal minus commission. Not yet payable -- payability is decided by vendor_commission_ledger.status.';

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS sub_order_id UUID REFERENCES public.order_sub_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_order_items_sub_order ON public.order_items (sub_order_id)
  WHERE sub_order_id IS NOT NULL;

COMMENT ON COLUMN public.order_items.sub_order_id IS
  'NULL for DLX-owned items and for orders placed before P14. Filled in by sync_order_sub_order().';

-- ============================================================================
-- 4. Commission ledger
-- ============================================================================
-- Append-only. A row is created when a sub-order is delivered and reversed if
-- the sub-order is later cancelled or refunded. Nothing is ever UPDATEd in
-- place except status, so the payout history stays auditable.

CREATE TABLE IF NOT EXISTS public.vendor_commission_ledger (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id      UUID NOT NULL REFERENCES public.vendors(id) ON DELETE RESTRICT,
  sub_order_id   UUID NOT NULL REFERENCES public.order_sub_orders(id) ON DELETE CASCADE,
  order_id       UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL DEFAULT 'order_commission',
  amount         NUMERIC NOT NULL,
  rate           NUMERIC NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'USD',
  status         TEXT NOT NULL DEFAULT 'earned',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  reversed_at    TIMESTAMPTZ,
  CONSTRAINT vendor_commission_ledger_unique UNIQUE (sub_order_id, kind),
  CONSTRAINT chk_commission_ledger_status CHECK (status IN ('pending', 'earned', 'reversed', 'paid')),
  CONSTRAINT chk_commission_ledger_kind CHECK (kind IN ('order_commission', 'adjustment', 'refund')),
  CONSTRAINT chk_commission_ledger_amount CHECK (amount >= 0)
);

ALTER TABLE public.vendor_commission_ledger ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_commission_ledger_vendor ON public.vendor_commission_ledger (vendor_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_commission_ledger_unpaid
  ON public.vendor_commission_ledger (id)
  WHERE status = 'earned';

COMMENT ON COLUMN public.vendor_commission_ledger.status IS
  'pending = sub-order still open, not owed. earned = owed and not yet paid out. reversed = the sale was cancelled or refunded. paid = included in a settled payout.';
COMMENT ON COLUMN public.vendor_commission_ledger.amount IS
  'Always stored unsigned. Direction is carried by status, never by a negative number, so no sum can be misread by a sign convention.';

-- ============================================================================
-- 5. Payouts
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.vendor_payouts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id         UUID NOT NULL REFERENCES public.vendors(id) ON DELETE RESTRICT,
  status            TEXT NOT NULL DEFAULT 'requested',
  gross_amount      NUMERIC NOT NULL DEFAULT 0,
  commission_amount NUMERIC NOT NULL DEFAULT 0,
  net_amount        NUMERIC NOT NULL DEFAULT 0,
  currency          TEXT NOT NULL DEFAULT 'USD',
  method            TEXT,
  account_ref       TEXT,
  note              TEXT,
  requested_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  settled_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT chk_payout_status CHECK (status IN ('requested', 'processing', 'paid', 'cancelled')),
  CONSTRAINT chk_payout_amounts CHECK (
    gross_amount >= 0 AND commission_amount >= 0 AND net_amount >= 0
  )
);

-- At most one payout in flight per vendor. This must be a PARTIAL index scoped to
-- the open statuses: a plain UNIQUE (vendor_id) would also cover settled rows and
-- so would let a seller request exactly one payout for the entire life of the
-- account. Partial unique indexes cannot be DEFERRABLE, which is fine -- the
-- constraint we actually need is "no two open payouts at once", checked at once.
ALTER TABLE public.vendor_payouts
  DROP CONSTRAINT IF EXISTS vendor_payouts_one_open;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_payouts_one_open
  ON public.vendor_payouts (vendor_id)
  WHERE status IN ('requested', 'processing');

COMMENT ON INDEX public.idx_vendor_payouts_one_open IS
  'At most one in-flight payout per vendor. Scoped to requested/processing so settled history does not block future requests.';

ALTER TABLE public.vendor_payouts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.vendor_payout_items (
  payout_id UUID NOT NULL REFERENCES public.vendor_payouts(id) ON DELETE CASCADE,
  ledger_id UUID NOT NULL REFERENCES public.vendor_commission_ledger(id) ON DELETE RESTRICT,
  amount    NUMERIC NOT NULL,
  PRIMARY KEY (payout_id, ledger_id),
  CONSTRAINT chk_payout_item_amount CHECK (amount >= 0)
);

-- A ledger row may appear in at most one payout, ever. This is the database-level
-- guarantee that an earned commission cannot be paid twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payout_items_ledger_unique
  ON public.vendor_payout_items (ledger_id);

COMMENT ON COLUMN public.vendor_payouts.gross_amount IS
  'Sum of the seller subtotals covered by this payout.';
COMMENT ON COLUMN public.vendor_payouts.net_amount IS
  'gross_amount minus commission_amount. What actually reaches the seller.';

-- ============================================================================
-- 6. Per-vendor deliveries
-- ============================================================================
-- deliveries was UNIQUE(order_id), which structurally forbids splitting one
-- order across two couriers. Replaced with two partial unique indexes so the
-- constraint still holds for the single-vendor case.

DO $$
BEGIN
  ALTER TABLE public.deliveries DROP CONSTRAINT IF EXISTS deliveries_order_id_key;
EXCEPTION WHEN undefined_object THEN NULL;
END;
$$;

ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES public.vendors(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_deliveries_platform_per_order
  ON public.deliveries (order_id)
  WHERE vendor_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_deliveries_vendor_per_order
  ON public.deliveries (order_id, vendor_id)
  WHERE vendor_id IS NOT NULL;

COMMENT ON COLUMN public.deliveries.vendor_id IS
  'NULL = the platform fulfils this leg in-house. Set when the leg belongs to one seller, so a two-seller order can travel as two deliveries.';

-- ============================================================================
-- 7. Vendor onboarding columns
-- ============================================================================
-- vendors.status had three values and nothing else. A marketplace seller needs
-- to be able to see and complete their own onboarding, which means the row has
-- to carry where they got to and how DLX will pay them.

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS legal_name       TEXT,
  ADD COLUMN IF NOT EXISTS contact_email    TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone    TEXT,
  ADD COLUMN IF NOT EXISTS payout_method    TEXT,
  ADD COLUMN IF NOT EXISTS payout_account_ref TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_step  TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_reason TEXT,
  ADD COLUMN IF NOT EXISTS source_application_id UUID REFERENCES public.partner_applications(id) ON DELETE SET NULL;

DO $$
BEGIN
  ALTER TABLE public.vendors
    ADD CONSTRAINT chk_vendor_onboarding_step
    CHECK (onboarding_step IN ('draft', 'documents', 'payout_details', 'review', 'approved'));
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  ALTER TABLE public.vendors
    ADD CONSTRAINT chk_vendor_payout_method
    CHECK (payout_method IS NULL OR payout_method IN ('mobile_money', 'bank_transfer', 'cash'));
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vendors_source_application
  ON public.vendors (source_application_id)
  WHERE source_application_id IS NOT NULL;

COMMENT ON COLUMN public.vendors.onboarding_step IS
  'Seller-facing progress marker. Deliberately separate from status: a seller can be onboarding_step=review while status is still active, because selling and being fully onboarded are different things.';
COMMENT ON COLUMN public.vendors.payout_account_ref IS
  'Opaque destination reference (a mobile-money number, a masked account). Free text because DLX settles in the field; it is never rendered in a public surface.';

-- A seller must be able to read their OWN row while it is still pending, which
-- is what makes onboarding possible.
DROP POLICY IF EXISTS "Vendors read their own shop record" ON public.vendors;
CREATE POLICY "Vendors read their own shop record"
  ON public.vendors FOR SELECT
  USING (profile_id = auth.uid() OR public.is_admin());

-- Public browsing of active shops goes through vendor_public_cards below, NOT
-- through this table. vendors carries payout_account_ref, payment_info,
-- contact_email and contact_phone, and row-level security cannot filter columns,
-- so a `status = 'active'` SELECT policy would hand every seller's payout
-- destination to anon. Dropping it is what makes the view mandatory.
DROP POLICY IF EXISTS "Public can read active vendors" ON public.vendors;
DROP POLICY IF EXISTS "Vendors can update their own shop" ON public.vendors;

-- Self-registration may create a shop record, but only as an unapproved stub.
-- Without the status/rate checks a seller could INSERT straight to 'active' at a
-- 0% commission and approve themselves, bypassing DLX entirely.
DROP POLICY IF EXISTS "Vendors create their own shop record" ON public.vendors;
CREATE POLICY "Vendors create their own shop record"
  ON public.vendors FOR INSERT
  WITH CHECK (profile_id = auth.uid() AND status = 'pending' AND commission_rate = 0);

-- Every seller write goes through an audited SECURITY DEFINER RPC, which keeps
-- commission_rate, status and payout details out of reach of a direct PostgREST
-- write. Column-level UPDATE is revoked below to make that structural rather than
-- dependent on this policy continuing to exist.
DROP POLICY IF EXISTS "Vendors update their own onboarding" ON public.vendors;

-- anon is revoked outright: the storefront must reach sellers through
-- vendor_public_cards, never the base table.
REVOKE ALL ON public.vendors FROM anon;

-- authenticated keeps table writes ONLY because the admin console manages vendor
-- records directly (PartnerControls). What makes that safe is the admin-only
-- "Admins can manage vendors" policy combined with the absence of any seller
-- UPDATE policy: a non-admin authenticated user matches no write policy, so RLS
-- denies them. Seller self-service writes go through update_my_vendor_onboarding,
-- which cannot touch commission_rate or status.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendors TO authenticated;

-- The only public projection of a seller. Every column here is already
-- customer-facing on the storefront; anything financial or private stays out.
-- A plain view runs with the view owner's rights, so anon can read it even
-- though anon has no grant on the base table.
--
-- DROP rather than CREATE OR REPLACE: replacing a view cannot rename or reorder
-- its columns, so adding `status` to an already-created view fails outright.
-- Nothing depends on this view, so dropping it is safe and keeps the migration
-- re-runnable.
DROP VIEW IF EXISTS public.vendor_public_cards;
CREATE VIEW public.vendor_public_cards AS
  SELECT id,
         business_name,
         slug,
         COALESCE(shop_name, business_name)  AS display_name,
         shop_description,
         description,
         shop_image_url,
         banner_image_url,
         province,
         city,
         is_featured,
         -- Every row is active by construction. Kept so callers that filter on
         -- status keep working against the view unchanged.
         'active'::TEXT AS status,
         created_at,
         updated_at
  FROM public.vendors
  WHERE status = 'active';

COMMENT ON VIEW public.vendor_public_cards IS
  'Customer-facing seller cards. Deliberately excludes payout_account_ref, payment_info, contact_email, contact_phone, commission_rate and suspended_reason: RLS cannot filter columns, so public reads of active vendors must go through this view instead of the base table.';

REVOKE ALL ON public.vendor_public_cards FROM PUBLIC;
GRANT SELECT ON public.vendor_public_cards TO anon, authenticated;

-- ============================================================================
-- 8. Triggers: derive the split, then book the commission
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_order_sub_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_vendor_id        UUID;
  v_commission_rate  NUMERIC := 0;
  v_line_total       NUMERIC;
  v_new_subtotal     NUMERIC;
  v_new_commission   NUMERIC;
  v_sub_order_id     UUID;
BEGIN
  SELECT p.vendor_id INTO v_vendor_id
  FROM public.order_items oi
  JOIN public.products p ON p.id = oi.product_id
  WHERE oi.id = NEW.id;

  -- DLX-owned stock: no third-party seller, so no sub-order and no commission.
  -- The item still ships with the order as an in-house leg.
  IF v_vendor_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- A suspended or pending vendor's items are still sold (dropping them would
  -- lose a real order) but earn no commission until an admin decides.
  SELECT v.commission_rate INTO v_commission_rate
  FROM public.vendors v
  WHERE v.id = v_vendor_id AND v.status = 'active';

  -- No row means the vendor is not active, and SELECT INTO assigns NULL when it
  -- matches nothing. Normalise here so a non-active seller books at 0% instead
  -- of violating the NOT NULL constraint on commission_rate.
  v_commission_rate := COALESCE(v_commission_rate, 0);

  v_line_total := COALESCE(NEW.price_at_sale, 0) * NEW.quantity;

  INSERT INTO public.order_sub_orders (
    order_id, vendor_id, subtotal, commission_rate, commission_amount, vendor_net_amount
  )
  VALUES (
    NEW.order_id, v_vendor_id, v_line_total, v_commission_rate,
    round(v_line_total * v_commission_rate / 100, 2),
    round(v_line_total * (100 - v_commission_rate) / 100, 2)
  )
  ON CONFLICT (order_id, vendor_id) DO UPDATE
  SET subtotal = public.order_sub_orders.subtotal + EXCLUDED.subtotal,
      commission_amount = round((public.order_sub_orders.subtotal + EXCLUDED.subtotal)
                                * public.order_sub_orders.commission_rate / 100, 2),
      vendor_net_amount = round((public.order_sub_orders.subtotal + EXCLUDED.subtotal)
                                * (100 - public.order_sub_orders.commission_rate) / 100, 2),
      updated_at = timezone('utc', now())
  RETURNING id INTO v_sub_order_id;

  -- Attribute the line to the sub-order it just contributed to. This is a plain
  -- UPDATE on an already-inserted row, not a recursive INSERT, so the trigger
  -- cannot loop.
  UPDATE public.order_items
  SET sub_order_id = v_sub_order_id
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_order_sub_order ON public.order_items;
CREATE TRIGGER trg_sync_order_sub_order
  AFTER INSERT ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.sync_order_sub_order();

COMMENT ON FUNCTION public.sync_order_sub_order() IS
  'Derives one sub-order per (order, vendor) from order_items. Runs AFTER INSERT so it can also attribute the line, and so the checkout RPC never needs to know marketplaces exist. SECURITY DEFINER because order_sub_orders deliberately has no customer INSERT policy: checkout reaches this through create_customer_order, which is itself SECURITY DEFINER, but order_items also carries a direct customer INSERT policy, and an invoker trigger firing on that path would be refused by RLS with a misleading permission error.';

CREATE OR REPLACE FUNCTION public.book_vendor_commission()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO public
AS $$
BEGIN
  -- COD is the only payment method in DLX, so a sub-order earns commission when
  -- it is actually delivered, not when it is created.
  IF NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'delivered' THEN
    INSERT INTO public.vendor_commission_ledger (
      vendor_id, sub_order_id, order_id, kind, amount, rate, currency, status
    )
    VALUES (
      NEW.vendor_id, NEW.id, NEW.order_id, 'order_commission',
      NEW.commission_amount, NEW.commission_rate, NEW.currency, 'earned'
    )
    ON CONFLICT (sub_order_id, kind) DO NOTHING;
  ELSIF NEW.status IN ('cancelled', 'refunded') AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.vendor_commission_ledger
    SET status = 'reversed', reversed_at = timezone('utc', now())
    WHERE sub_order_id = NEW.id AND status IN ('earned', 'pending');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_book_vendor_commission ON public.order_sub_orders;
CREATE TRIGGER trg_book_vendor_commission
  AFTER UPDATE OF status ON public.order_sub_orders
  FOR EACH ROW EXECUTE FUNCTION public.book_vendor_commission();

-- ============================================================================
-- 9. My vendor (seller self-service)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_my_vendor()
RETURNS public.vendors
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.vendors;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required' USING ERRCODE = '28000';
  END IF;

  -- may_be_null is required on purpose: a signed-in customer who has not
  -- onboarded must get NULL, not an exception the UI has to special-case.
  SELECT * INTO v_row
  FROM public.vendors
  WHERE profile_id = auth.uid()
  ORDER BY created_at
  LIMIT 1;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_vendor_id()
RETURNS UUID
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
  SELECT id INTO v_id FROM public.vendors WHERE profile_id = auth.uid() LIMIT 1;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_my_vendor_onboarding(
  p_legal_name        TEXT DEFAULT NULL,
  p_contact_email     TEXT DEFAULT NULL,
  p_contact_phone     TEXT DEFAULT NULL,
  p_payout_method     TEXT DEFAULT NULL,
  p_payout_account_ref TEXT DEFAULT NULL,
  p_business_hours    JSONB  DEFAULT NULL,
  p_description       TEXT DEFAULT NULL
)
RETURNS public.vendors
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id     UUID;
  v_vendor public.vendors;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required' USING ERRCODE = '28000';
  END IF;

  v_id := public.get_my_vendor_id();
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'No seller account exists for this user';
  END IF;

  -- validate everything BEFORE writing anything, so a bad payout method cannot
  -- leave a half-updated profile behind.
  IF p_contact_email IS NOT NULL AND p_contact_email <> ''
     AND p_contact_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Invalid contact email';
  END IF;
  IF p_contact_phone IS NOT NULL AND p_contact_phone <> ''
     AND p_contact_phone !~ '^\+[0-9]{7,15}$' THEN
    RAISE EXCEPTION 'Contact phone must be in international format';
  END IF;
  IF p_payout_method IS NOT NULL AND p_payout_method <> ''
     AND p_payout_method NOT IN ('mobile_money', 'bank_transfer', 'cash') THEN
    RAISE EXCEPTION 'Unsupported payout method';
  END IF;

  UPDATE public.vendors SET
    legal_name         = COALESCE(NULLIF(btrim(p_legal_name), ''), legal_name),
    contact_email      = COALESCE(NULLIF(btrim(p_contact_email), ''), contact_email),
    contact_phone      = COALESCE(NULLIF(btrim(p_contact_phone), ''), contact_phone),
    payout_method      = COALESCE(NULLIF(btrim(p_payout_method), ''), payout_method),
    payout_account_ref = COALESCE(NULLIF(btrim(p_payout_account_ref), ''), payout_account_ref),
    business_hours     = COALESCE(p_business_hours, business_hours),
    description        = COALESCE(NULLIF(btrim(p_description), ''), description),
    -- 'draft' is reset to 'documents' once there is anything to review, so the
    -- seller cannot sit on 'draft' after submitting real details.
    onboarding_step    = CASE
                           WHEN onboarding_step = 'draft'
                             AND (NULLIF(btrim(p_legal_name), '') IS NOT NULL
                                  OR NULLIF(btrim(p_payout_account_ref), '') IS NOT NULL)
                             THEN 'documents'
                           ELSE onboarding_step
                         END,
    updated_at         = timezone('utc', now())
  WHERE id = v_id
  RETURNING * INTO v_vendor;

  RETURN v_vendor;
END;
$$;

-- ============================================================================
-- 10. Seller dashboard and seller-owned writes
-- ============================================================================

CREATE OR REPLACE FUNCTION public.seller_dashboard()
RETURNS TABLE (
  product_count        BIGINT,
  sub_order_count      BIGINT,
  units_sold           BIGINT,
  gross_revenue        NUMERIC,
  commission_paid      NUMERIC,
  commission_pending   NUMERIC,
  commission_reversed  NUMERIC,
  pending_payout_net   NUMERIC,
  active_payout_status TEXT
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
    -- Return a zeroed row rather than no rows: the dashboard renders zeroes,
    -- and "you have no sales" is different from "you are not a seller".
    RETURN QUERY SELECT 0::BIGINT, 0::BIGINT, 0::BIGINT, 0::NUMERIC, 0::NUMERIC,
                        0::NUMERIC, 0::NUMERIC, 0::NUMERIC, NULL::TEXT;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    (SELECT count(*) FROM public.products p WHERE p.vendor_id = v_id),
    (SELECT count(*) FROM public.order_sub_orders s WHERE s.vendor_id = v_id),
    COALESCE((SELECT sum(oi.quantity) FROM public.order_items oi
              JOIN public.order_sub_orders s ON s.id = oi.sub_order_id
              WHERE s.vendor_id = v_id), 0)::BIGINT,
    COALESCE((SELECT sum(s.subtotal) FROM public.order_sub_orders s
              WHERE s.vendor_id = v_id
                AND s.status NOT IN ('cancelled', 'refunded')), 0),
    COALESCE((SELECT sum(l.amount) FROM public.vendor_commission_ledger l
              WHERE l.vendor_id = v_id AND l.status = 'paid'), 0),
    -- 'earned' is owed-but-unpaid. This is the number a seller is chasing.
    COALESCE((SELECT sum(l.amount) FROM public.vendor_commission_ledger l
              WHERE l.vendor_id = v_id AND l.status = 'earned'), 0),
    COALESCE((SELECT sum(l.amount) FROM public.vendor_commission_ledger l
              WHERE l.vendor_id = v_id AND l.status = 'reversed'), 0),
    COALESCE((SELECT sum(pi.amount) FROM public.vendor_payout_items pi
              JOIN public.vendor_payouts p ON p.id = pi.payout_id
              WHERE p.vendor_id = v_id AND p.status IN ('requested', 'processing')), 0),
    (SELECT p2.status FROM public.vendor_payouts p2
     WHERE p2.vendor_id = v_id AND p2.status IN ('requested', 'processing')
     ORDER BY p2.requested_at LIMIT 1);
END;
$$;

CREATE OR REPLACE FUNCTION public.seller_list_sub_orders(p_status TEXT DEFAULT NULL)
RETURNS TABLE (
  sub_order_id  UUID,
  order_id      UUID,
  order_ref     TEXT,
  status        TEXT,
  customer_name TEXT,
  city          TEXT,
  subtotal      NUMERIC,
  commission    NUMERIC,
  net_amount    NUMERIC,
  item_count    BIGINT,
  created_at    TIMESTAMPTZ
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
    o.order_number::TEXT,
    s.status,
    o.customer_name,
    o.municipality,
    s.subtotal,
    s.commission_amount,
    s.vendor_net_amount,
    (SELECT count(*) FROM public.order_items oi WHERE oi.sub_order_id = s.id)::BIGINT,
    s.created_at
  FROM public.order_sub_orders s
  JOIN public.orders o ON o.id = s.order_id
  WHERE s.vendor_id = v_id
    AND (p_status IS NULL OR p_status = '' OR s.status = p_status)
  ORDER BY s.created_at DESC
  LIMIT 200;
END;
$$;

CREATE OR REPLACE FUNCTION public.seller_update_sub_order_status(
  p_sub_order_id UUID,
  p_status       TEXT
)
RETURNS public.order_sub_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id       UUID;
  v_vendor   UUID;
  v_sub      public.order_sub_orders;
  v_parent   TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required' USING ERRCODE = '28000';
  END IF;

  IF p_status NOT IN ('confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled') THEN
    RAISE EXCEPTION 'Seller cannot set that status';
  END IF;

  v_id := public.get_my_vendor_id();
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'No seller account exists for this user';
  END IF;

  -- Lock the sub-order first, then read the parent status separately. Selecting
  -- s.* together with o.status into a record plus a scalar is not valid
  -- plpgsql, and taking the lock before the ownership check is what stops two
  -- concurrent sellers from racing the same row.
  SELECT s.vendor_id INTO v_vendor
  FROM public.order_sub_orders s
  WHERE s.id = p_sub_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sub-order not found';
  END IF;
  IF v_vendor <> v_id THEN
    RAISE EXCEPTION 'Sub-order belongs to another seller';
  END IF;

  SELECT o.status INTO v_parent
  FROM public.order_sub_orders s
  JOIN public.orders o ON o.id = s.order_id
  WHERE s.id = p_sub_order_id;

  -- A seller must not be able to mark a whole order delivered through their own
  -- sub-order and thereby cash a commission while another seller has not shipped.
  -- Delivery is confirmed by DLX staff, not self-certified by the seller.
  IF p_status = 'delivered' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Delivery must be confirmed by DLX staff';
  END IF;

  IF v_parent IN ('cancelled', 'refunded') AND p_status NOT IN ('cancelled') THEN
    RAISE EXCEPTION 'The parent order is already closed';
  END IF;

  UPDATE public.order_sub_orders
  SET status = p_status, updated_at = timezone('utc', now())
  WHERE id = p_sub_order_id
  RETURNING * INTO v_sub;

  RETURN v_sub;
END;
$$;

CREATE OR REPLACE FUNCTION public.seller_request_payout(
  p_method        TEXT,
  p_account_ref   TEXT
)
RETURNS TABLE (
  payout_id      UUID,
  entry_count    BIGINT,
  gross_amount   NUMERIC,
  commission     NUMERIC,
  net_amount     NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id        UUID;
  v_payout    UUID;
  v_rows      BIGINT;
  v_gross     NUMERIC;
  v_comm      NUMERIC;
  v_net       NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required' USING ERRCODE = '28000';
  END IF;

  IF p_method NOT IN ('mobile_money', 'bank_transfer', 'cash') THEN
    RAISE EXCEPTION 'Unsupported payout method';
  END IF;
  IF p_account_ref IS NULL OR btrim(p_account_ref) = '' THEN
    RAISE EXCEPTION 'A payout destination is required';
  END IF;

  v_id := public.get_my_vendor_id();
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'No seller account exists for this user';
  END IF;

  -- Refuse only when one really is open. This must be EXISTS, not NOT EXISTS:
  -- an inverted guard raises "already in progress" for a seller who has none and
  -- then lets a seller with an open payout request a second, paying the same
  -- ledger rows twice.
  IF EXISTS (
    SELECT 1 FROM public.vendor_payouts
    WHERE vendor_id = v_id AND status IN ('requested', 'processing')
  ) THEN
    RAISE EXCEPTION 'A payout is already in progress';
  END IF;

  SELECT count(*), COALESCE(sum(s.subtotal), 0), COALESCE(sum(l.amount), 0),
         COALESCE(sum(s.vendor_net_amount), 0)
  INTO v_rows, v_gross, v_comm, v_net
  FROM public.vendor_commission_ledger l
  JOIN public.order_sub_orders s ON s.id = l.sub_order_id
  WHERE l.vendor_id = v_id
    AND l.status = 'earned'
    AND NOT EXISTS (SELECT 1 FROM public.vendor_payout_items pi WHERE pi.ledger_id = l.id);

  IF v_rows = 0 THEN
    RAISE EXCEPTION 'There is nothing settled to pay out yet';
  END IF;

  INSERT INTO public.vendor_payouts (
    vendor_id, status, gross_amount, commission_amount, net_amount, method, account_ref
  )
  VALUES (v_id, 'requested', v_gross, v_comm, v_net, p_method, btrim(p_account_ref))
  RETURNING id INTO v_payout;

  INSERT INTO public.vendor_payout_items (payout_id, ledger_id, amount)
  SELECT v_payout, l.id, s.vendor_net_amount
  FROM public.vendor_commission_ledger l
  JOIN public.order_sub_orders s ON s.id = l.sub_order_id
  WHERE l.vendor_id = v_id
    AND l.status = 'earned'
    AND NOT EXISTS (SELECT 1 FROM public.vendor_payout_items pi WHERE pi.ledger_id = l.id);

  -- Marking the ledger 'paid' here would be a lie: the money has not moved yet.
  -- DLX marks it paid when the payout is settled (admin_settle_payout).
  RETURN QUERY SELECT v_payout, v_rows, v_gross, v_comm, v_net;
END;
$$;

-- ============================================================================
-- 11. Admin surface
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_approve_partner_application(
  p_application_id UUID,
  p_commission_rate NUMERIC DEFAULT NULL
)
RETURNS public.vendors
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app      public.partner_applications;
  v_vendor   public.vendors;
  v_slug     TEXT;
  v_suffix   TEXT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT * INTO v_app
  FROM public.partner_applications
  WHERE id = p_application_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found';
  END IF;
  IF v_app.status = 'approved' THEN
    RAISE EXCEPTION 'Application is already approved';
  END IF;

  IF p_commission_rate IS NOT NULL
     AND (p_commission_rate < 0 OR p_commission_rate > 100) THEN
    RAISE EXCEPTION 'Commission rate must be between 0 and 100';
  END IF;

  -- Idempotent by construction: one vendors row per application, enforced by the
  -- partial unique index on source_application_id.
  SELECT * INTO v_vendor
  FROM public.vendors
  WHERE source_application_id = p_application_id;

  IF v_vendor.id IS NULL THEN
    v_slug := lower(regexp_replace(trim(v_app.business_name), '[^a-zA-Z0-9]+', '-', 'g'));

    IF v_slug = '' OR v_slug IS NULL THEN
      v_slug := 'shop';
    END IF;
    v_slug := left(v_slug, 48);

    -- Slugs are UNIQUE, so resolve collisions deterministically rather than
    -- letting the insert fail with an opaque 23505.
    IF EXISTS (SELECT 1 FROM public.vendors WHERE slug = v_slug) THEN
      v_suffix := '-' || substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 6);
      v_slug := v_slug || v_suffix;
    END IF;

    INSERT INTO public.vendors (
      profile_id, business_name, slug, description, province, city, status,
      legal_name, contact_email, contact_phone, commission_rate,
      onboarding_step, source_application_id
    )
    VALUES (
      v_app.applicant_id, v_app.business_name, v_slug, v_app.description,
      v_app.province, v_app.city, 'active',
      v_app.owner_name, v_app.email, v_app.phone,
      COALESCE(p_commission_rate, 0), 'approved', p_application_id
    )
    RETURNING * INTO v_vendor;
  ELSE
    UPDATE public.vendors
    SET status = 'active',
        commission_rate = COALESCE(p_commission_rate, commission_rate),
        onboarding_step = 'approved',
        updated_at = timezone('utc', now())
    WHERE id = v_vendor.id
    RETURNING * INTO v_vendor;
  END IF;

  UPDATE public.partner_applications
  SET status = 'approved'
  WHERE id = p_application_id;

  RETURN v_vendor;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_marketplace_overview()
RETURNS TABLE (
  vendor_count        BIGINT,
  active_vendor_count BIGINT,
  pending_applications BIGINT,
  sub_order_count     BIGINT,
  open_sub_orders     BIGINT,
  marketplace_gmv     NUMERIC,
  platform_commission NUMERIC,
  commission_earned   NUMERIC,
  commission_paid     NUMERIC,
  commission_reversed NUMERIC,
  payout_pending      BIGINT,
  payout_pending_net  NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT count(*) FROM public.vendors),
    (SELECT count(*) FROM public.vendors WHERE status = 'active'),
    (SELECT count(*) FROM public.partner_applications WHERE status IN ('pending', 'reviewing')),
    (SELECT count(*) FROM public.order_sub_orders),
    (SELECT count(*) FROM public.order_sub_orders
      WHERE status NOT IN ('delivered', 'cancelled', 'refunded')),
    COALESCE((SELECT sum(subtotal) FROM public.order_sub_orders
              WHERE status NOT IN ('cancelled', 'refunded')), 0),
    COALESCE((SELECT sum(commission_amount) FROM public.order_sub_orders
              WHERE status NOT IN ('cancelled', 'refunded')), 0),
    COALESCE((SELECT sum(amount) FROM public.vendor_commission_ledger WHERE status = 'earned'), 0),
    COALESCE((SELECT sum(amount) FROM public.vendor_commission_ledger WHERE status = 'paid'), 0),
    COALESCE((SELECT sum(amount) FROM public.vendor_commission_ledger WHERE status = 'reversed'), 0),
    (SELECT count(*) FROM public.vendor_payouts WHERE status IN ('requested', 'processing')),
    COALESCE((SELECT sum(net_amount) FROM public.vendor_payouts
              WHERE status IN ('requested', 'processing')), 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_payouts(p_status TEXT DEFAULT NULL)
RETURNS TABLE (
  payout_id     UUID,
  vendor_id     UUID,
  vendor_name   TEXT,
  status        TEXT,
  gross_amount  NUMERIC,
  commission    NUMERIC,
  net_amount    NUMERIC,
  method        TEXT,
  account_ref   TEXT,
  requested_at  TIMESTAMPTZ,
  settled_at    TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT p.id, p.vendor_id, v.business_name, p.status,
         p.gross_amount, p.commission_amount, p.net_amount,
         p.method, p.account_ref, p.requested_at, p.settled_at
  FROM public.vendor_payouts p
  JOIN public.vendors v ON v.id = p.vendor_id
  WHERE p_status IS NULL OR p_status = '' OR p.status = p_status
  ORDER BY p.requested_at DESC
  LIMIT 200;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_settle_payout(
  p_payout_id UUID,
  p_status    TEXT DEFAULT 'paid'
)
RETURNS public.vendor_payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payout public.vendor_payouts;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  IF p_status NOT IN ('processing', 'paid', 'cancelled') THEN
    RAISE EXCEPTION 'Unsupported payout status';
  END IF;

  SELECT * INTO v_payout FROM public.vendor_payouts WHERE id = p_payout_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payout not found';
  END IF;
  IF v_payout.status = 'paid' THEN
    RAISE EXCEPTION 'Payout is already settled';
  END IF;

  IF p_status = 'cancelled' THEN
    -- Cancelling releases the ledger rows back to 'earned' so they can be
    -- requested again, rather than stranding the seller's money.
    UPDATE public.vendor_commission_ledger l
    SET status = 'earned'
    FROM public.vendor_payout_items pi
    WHERE pi.payout_id = p_payout_id AND pi.ledger_id = l.id AND l.status = 'paid';

    -- The payout_items rows must go too. idx_payout_items_ledger_unique allows a
    -- ledger row in at most one payout, ever, which is what stops a double pay.
    -- If they survived cancellation the seller could never re-request that money:
    -- the re-request would collide on that index. The payout row itself is kept
    -- as the audit record of the cancelled attempt, and it still carries the
    -- gross/commission/net totals of what was attempted.
    DELETE FROM public.vendor_payout_items WHERE payout_id = p_payout_id;

    UPDATE public.vendor_payouts
    SET status = 'cancelled'
    WHERE id = p_payout_id
    RETURNING * INTO v_payout;
    RETURN v_payout;
  END IF;

  UPDATE public.vendor_payouts
  SET status = p_status,
      settled_at = CASE WHEN p_status = 'paid' THEN timezone('utc', now()) ELSE settled_at END
  WHERE id = p_payout_id
  RETURNING * INTO v_payout;

  IF p_status = 'paid' THEN
    UPDATE public.vendor_commission_ledger l
    SET status = 'paid'
    FROM public.vendor_payout_items pi
    WHERE pi.payout_id = p_payout_id AND pi.ledger_id = l.id;
  END IF;

  RETURN v_payout;
END;
$$;

-- ============================================================================
-- 12. Sub-order fan-out to the parent order
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_parent_order_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO public
AS $$
DECLARE
  v_open  BIGINT;
  v_total BIGINT;
BEGIN
  -- Only when every leg of a multi-vendor order has reached the same terminal
  -- state does the parent order reflect it. Partial delivery must NOT mark the
  -- whole order delivered, because that would fire the P13 "delivered"
  -- notification and the loyalty points hook for goods that never arrived.
  IF NEW.status NOT IN ('delivered', 'cancelled', 'refunded') THEN
    RETURN NEW;
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE status = NEW.status)
  INTO v_total, v_open
  FROM public.order_sub_orders
  WHERE order_id = NEW.order_id;

  IF v_total > 0 AND v_open = v_total THEN
    UPDATE public.orders
    SET status = NEW.status
    WHERE id = NEW.order_id
      AND status NOT IN ('cancelled', 'refunded');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_parent_order_status ON public.order_sub_orders;
CREATE TRIGGER trg_sync_parent_order_status
  AFTER UPDATE OF status ON public.order_sub_orders
  FOR EACH ROW EXECUTE FUNCTION public.sync_parent_order_status();

COMMENT ON FUNCTION public.sync_parent_order_status() IS
  'Promotes the parent order only when ALL of its sub-orders agree. A two-seller order where one seller has delivered and the other has not stays short of "delivered" on purpose.';

-- ============================================================================
-- 13. RLS for the new tables
-- ============================================================================
-- Deliberately no browser INSERT/UPDATE/DELETE policy on any of these. They are
-- written only by the SECURITY DEFINER functions above, so a direct PostgREST
-- write is impossible and the money path cannot be bypassed from the client.

DROP POLICY IF EXISTS "Customers read their own sub-orders" ON public.order_sub_orders;
CREATE POLICY "Customers read their own sub-orders"
  ON public.order_sub_orders FOR SELECT
  USING (
    public.is_admin()
    OR vendor_id IN (SELECT id FROM public.vendors WHERE profile_id = auth.uid())
    OR order_id IN (SELECT id FROM public.orders WHERE customer_id = auth.uid())
  );

DROP POLICY IF EXISTS "Admins manage sub-orders" ON public.order_sub_orders;
CREATE POLICY "Admins manage sub-orders"
  ON public.order_sub_orders FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Sellers read their own commission ledger" ON public.vendor_commission_ledger;
CREATE POLICY "Sellers read their own commission ledger"
  ON public.vendor_commission_ledger FOR SELECT
  USING (
    public.is_admin()
    OR vendor_id IN (SELECT id FROM public.vendors WHERE profile_id = auth.uid())
  );

DROP POLICY IF EXISTS "Admins manage the commission ledger" ON public.vendor_commission_ledger;
CREATE POLICY "Admins manage the commission ledger"
  ON public.vendor_commission_ledger FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Sellers read their own payouts" ON public.vendor_payouts;
CREATE POLICY "Sellers read their own payouts"
  ON public.vendor_payouts FOR SELECT
  USING (
    public.is_admin()
    OR vendor_id IN (SELECT id FROM public.vendors WHERE profile_id = auth.uid())
  );

DROP POLICY IF EXISTS "Admins manage payouts" ON public.vendor_payouts;
CREATE POLICY "Admins manage payouts"
  ON public.vendor_payouts FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Payout items follow their payout" ON public.vendor_payout_items;
CREATE POLICY "Payout items follow their payout"
  ON public.vendor_payout_items FOR SELECT
  USING (
    public.is_admin()
    OR payout_id IN (
      SELECT p.id FROM public.vendor_payouts p
      JOIN public.vendors v ON v.id = p.vendor_id
      WHERE v.profile_id = auth.uid()
    )
  );

-- Sellers keep their own stock and warehouse edits possible through the RPCs
-- only; no table policy grants them direct writes.

-- ============================================================================
-- 14. Grants
-- ============================================================================

-- 1. Internal plumbing: revoke from PUBLIC *and* anon (anon included because
--    Supabase's default ACL grants both and revoking only PUBLIC does nothing).
REVOKE ALL ON FUNCTION public.sync_order_sub_order() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.book_vendor_commission() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_parent_order_status() FROM PUBLIC, anon, authenticated;

-- 2. Seller self-service. Each function resolves the vendor from auth.uid() in
--    its body, so the grant is a usability decision, not the security boundary.
REVOKE ALL ON FUNCTION public.get_my_vendor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_vendor() TO authenticated;

REVOKE ALL ON FUNCTION public.get_my_vendor_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_vendor_id() TO authenticated;

REVOKE ALL ON FUNCTION public.update_my_vendor_onboarding(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_my_vendor_onboarding(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.seller_dashboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seller_dashboard() TO authenticated;

REVOKE ALL ON FUNCTION public.seller_list_sub_orders(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seller_list_sub_orders(TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.seller_update_sub_order_status(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seller_update_sub_order_status(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.seller_request_payout(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seller_request_payout(TEXT, TEXT) TO authenticated;

-- 3. Admin surface.
REVOKE ALL ON FUNCTION public.admin_approve_partner_application(UUID, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_approve_partner_application(UUID, NUMERIC) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_marketplace_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_marketplace_overview() TO authenticated;

REVOKE ALL ON FUNCTION public.admin_list_payouts(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_payouts(TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_settle_payout(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_settle_payout(UUID, TEXT) TO authenticated;

-- 4. Table access: read-only. Every write goes through the functions above.
REVOKE ALL ON public.order_sub_orders FROM PUBLIC, anon;
GRANT SELECT ON public.order_sub_orders TO authenticated;

REVOKE ALL ON public.vendor_commission_ledger FROM PUBLIC, anon;
GRANT SELECT ON public.vendor_commission_ledger TO authenticated;

REVOKE ALL ON public.vendor_payouts FROM PUBLIC, anon;
GRANT SELECT ON public.vendor_payouts TO authenticated;

REVOKE ALL ON public.vendor_payout_items FROM PUBLIC, anon;
GRANT SELECT ON public.vendor_payout_items TO authenticated;

-- ============================================================================
-- REVERSIBLE (rollback)
--   DROP FUNCTION IF EXISTS public.admin_settle_payout(UUID, TEXT);
--   DROP FUNCTION IF EXISTS public.admin_list_payouts(TEXT);
--   DROP FUNCTION IF EXISTS public.admin_marketplace_overview();
--   DROP FUNCTION IF EXISTS public.admin_approve_partner_application(UUID, NUMERIC);
--   DROP FUNCTION IF EXISTS public.seller_request_payout(TEXT, TEXT);
--   DROP FUNCTION IF EXISTS public.seller_update_sub_order_status(UUID, TEXT);
--   DROP FUNCTION IF EXISTS public.seller_list_sub_orders(TEXT);
--   DROP FUNCTION IF EXISTS public.seller_dashboard();
--   DROP FUNCTION IF EXISTS public.update_my_vendor_onboarding(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT);
--   DROP FUNCTION IF EXISTS public.get_my_vendor_id();
--   DROP FUNCTION IF EXISTS public.get_my_vendor();
--   DROP TRIGGER IF EXISTS trg_sync_parent_order_status ON public.order_sub_orders;
--   DROP TRIGGER IF EXISTS trg_book_vendor_commission ON public.order_sub_orders;
--   DROP TRIGGER IF EXISTS trg_sync_order_sub_order ON public.order_items;
--   DROP FUNCTION IF EXISTS public.sync_parent_order_status();
--   DROP FUNCTION IF EXISTS public.sync_order_sub_order();
--   DROP FUNCTION IF EXISTS public.book_vendor_commission();
--   DROP TABLE IF EXISTS public.vendor_payout_items;
--   DROP TABLE IF EXISTS public.vendor_payouts;
--   DROP TABLE IF EXISTS public.vendor_commission_ledger;
--   DROP TABLE IF EXISTS public.order_sub_orders;
--   ALTER TABLE public.order_items DROP COLUMN IF EXISTS sub_order_id;
--   ALTER TABLE public.deliveries DROP COLUMN IF EXISTS vendor_id;
--   ALTER TABLE public.vendors
--     DROP CONSTRAINT IF EXISTS chk_vendor_payout_method,
--     DROP CONSTRAINT IF EXISTS chk_vendor_onboarding_step,
--     DROP COLUMN IF EXISTS source_application_id,
--     DROP COLUMN IF EXISTS suspended_reason,
--     DROP COLUMN IF EXISTS onboarding_completed_at,
--     DROP COLUMN IF EXISTS onboarding_step,
--     DROP COLUMN IF EXISTS payout_account_ref,
--     DROP COLUMN IF EXISTS payout_method,
--     DROP COLUMN IF EXISTS contact_phone,
--     DROP COLUMN IF EXISTS contact_email,
--     DROP COLUMN IF EXISTS legal_name;
--   ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_vendor_id_fkey;
--   -- Note: rolling back repoints products.vendor_id to nothing. Re-adding the
--   -- original profiles(id) FK is deliberately NOT automated: any non-NULL
--   -- value written while P14 was live would be a profile id and would fail
--   -- the constraint. Inspect before re-adding.
-- ============================================================================
