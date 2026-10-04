-- ==========================================================================
-- DLXSTORE P14 marketplace suite (97 assertions).
-- Run against the local stack:
--   docker cp supabase/tests/<file> supabase_db_dlxstore:/tmp/t.sql
--   docker exec supabase_db_dlxstore psql -U postgres -d postgres -f /tmp/t.sql
-- ==========================================================================

-- ============================================================================
-- P14 behavioural suite — marketplace core + supply
-- ============================================================================
-- Runs as postgres. Auth is faked by writing auth.uid()/auth.role() straight
-- into the request GUCs, which is the only way to exercise RLS without the Go
-- True auth server running.
--
-- Counted: PASS / FAIL lines. Anything that raises an expected error prints the
-- error text instead of a PASS, so the expected-denial count is meaningful.

\set ON_ERROR_STOP off
\timing off

-- ---------------------------------------------------------------------------
-- Harness
-- ---------------------------------------------------------------------------
-- auth.uid() reads request.jwt.claims. This file is NOT wrapped in BEGIN, so
-- every statement is its own implicit transaction and is_local=true would be
-- discarded immediately. Session-level (false) is required, as in the P13 suite.
CREATE OR REPLACE FUNCTION pg_temp.p14_actor(p_uid UUID, p_role TEXT)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, false);
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.p14_anon()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', NULL, false);
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.p14_assert(BOOLEAN, TEXT)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF $1 THEN RAISE NOTICE 'PASS: %', $2; ELSE RAISE NOTICE 'FAIL: %', $2; END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
TRUNCATE public.vendor_payout_items, public.vendor_payouts,
         public.vendor_commission_ledger, public.order_sub_orders,
         public.order_items, public.orders, public.deliveries,
         public.product_warehouse_stock, public.vendor_warehouses,
         public.product_suppliers, public.suppliers,
         public.shop_products, public.partner_applications,
         public.products, public.vendors, public.profiles RESTART IDENTITY CASCADE;

-- id labels are short fixed uuids so failures are readable
-- profiles.id has a FK to auth.users(id), so the auth rows must exist first.
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'admin@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'seller-a@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'seller-b@example.test'),
  ('44444444-4444-4444-4444-444444444444', 'buyer@example.test'),
  ('55555555-5555-5555-5555-555555555555', 'applicant-1@example.test'),
  ('66666666-6666-6666-6666-666666666666', 'applicant-2@example.test'),
  ('77777777-7777-7777-7777-777777777777', 'newcomer@example.test');

INSERT INTO public.profiles (id, full_name, role) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Admin Root',  'admin'),
  ('22222222-2222-2222-2222-222222222222', 'Seller A',   'customer'),
  ('33333333-3333-3333-3333-333333333333', 'Seller B',   'customer'),
  ('44444444-4444-4444-4444-444444444444', 'Plain Buyer','customer'),
  ('55555555-5555-5555-5555-555555555555', 'Applicant One','customer'),
  ('66666666-6666-6666-6666-666666666666', 'Applicant Two','customer'),
  ('77777777-7777-7777-7777-777777777777', 'Newcomer','customer');

INSERT INTO public.vendors (id, profile_id, business_name, slug, province, city, status, commission_rate) VALUES
  ('aaaaaaa1-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'Seller A Shop', 'seller-a', 'North Kivu', 'Goma', 'active', 10),
  ('aaaaaaa2-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333',
   'Seller B Shop', 'seller-b', 'North Kivu', 'Goma', 'active', 20),
  ('aaaaaaa3-0000-0000-0000-000000000003', NULL,
   'Suspended Shop', 'suspended-shop', 'South Kivu', 'Bukavu', 'suspended', 30);

INSERT INTO public.products (id, name, slug, price, stock_quantity, vendor_id) VALUES
  ('bbbbbbb1-0000-0000-0000-000000000001', 'A Product',  'a-product',  100.00, 50, 'aaaaaaa1-0000-0000-0000-000000000001'),
  ('bbbbbbb2-0000-0000-0000-000000000002', 'A Product 2','a-product-2', 50.00, 40, 'aaaaaaa1-0000-0000-0000-000000000001'),
  ('bbbbbbb3-0000-0000-0000-000000000003', 'B Product',  'b-product',  200.00, 30, 'aaaaaaa2-0000-0000-0000-000000000002'),
  ('bbbbbbb4-0000-0000-0000-000000000004', 'DLX Product','dlx-product',  20.00, 999, NULL),
  ('bbbbbbb5-0000-0000-0000-000000000005', 'Suspended P','suspended-p',  80.00, 10, 'aaaaaaa3-0000-0000-0000-000000000003');

SELECT pg_temp.p14_assert(
  (SELECT count(*) FROM public.products WHERE vendor_id IS NOT NULL) = 4,
  'products.vendor_id now holds real seller references');

-- ===========================================================================
-- 1. Ownership
-- ===========================================================================
SELECT pg_temp.p14_assert(
  (SELECT pg_get_constraintdef(oid) LIKE '%REFERENCES vendors(id)%'
   FROM pg_constraint WHERE conrelid='public.products'::regclass
     AND conname='products_vendor_id_fkey'),
  'products.vendor_id FK now points at vendors, not profiles');

-- ===========================================================================
-- 2. Sub-order derivation (guest order, no auth.uid at all)
-- ===========================================================================
SELECT pg_temp.p14_anon();

INSERT INTO public.orders (id, customer_id, customer_name, phone_number, municipality,
                           neighborhood, avenue, total_amount, status)
VALUES ('dddddddd-0000-0000-0000-000000000001', NULL, 'Guest Buyer', '+243991234567',
        'Goma', 'Katindo', 'Av. Kivu', 400.00, 'pending');

INSERT INTO public.order_items (order_id, product_id, quantity, price_at_sale) VALUES
  ('dddddddd-0000-0000-0000-000000000001', 'bbbbbbb1-0000-0000-0000-000000000001', 2, 100.00),
  ('dddddddd-0000-0000-0000-000000000001', 'bbbbbbb3-0000-0000-0000-000000000003', 1, 200.00),
  ('dddddddd-0000-0000-0000-000000000001', 'bbbbbbb4-0000-0000-0000-000000000004', 5,  20.00);

SELECT pg_temp.p14_assert(
  (SELECT count(*) FROM public.order_sub_orders
   WHERE order_id='dddddddd-0000-0000-0000-000000000001') = 2,
  'multi-vendor guest order split into exactly 2 sub-orders');

SELECT pg_temp.p14_assert(
  (SELECT subtotal FROM public.order_sub_orders s
    JOIN public.vendors v ON v.id=s.vendor_id
   WHERE s.order_id='dddddddd-0000-0000-0000-000000000001'
     AND v.business_name='Seller A Shop') = 200.00,
  'Seller A subtotal = 2 x 100');

SELECT pg_temp.p14_assert(
  (SELECT subtotal FROM public.order_sub_orders s
    JOIN public.vendors v ON v.id=s.vendor_id
   WHERE s.order_id='dddddddd-0000-0000-0000-000000000001'
     AND v.business_name='Seller B Shop') = 200.00,
  'Seller B subtotal = 1 x 200');

SELECT pg_temp.p14_assert(
  (SELECT commission_amount FROM public.order_sub_orders s
    JOIN public.vendors v ON v.id=s.vendor_id
   WHERE s.order_id='dddddddd-0000-0000-0000-000000000001'
     AND v.business_name='Seller A Shop') = 20.00,
  'Seller A commission = 10% of 200 = 20');

SELECT pg_temp.p14_assert(
  (SELECT vendor_net_amount FROM public.order_sub_orders s
    JOIN public.vendors v ON v.id=s.vendor_id
   WHERE s.order_id='dddddddd-0000-0000-0000-000000000001'
     AND v.business_name='Seller B Shop') = 160.00,
  'Seller B net = 200 - 40 (20%) = 160');

SELECT pg_temp.p14_assert(
   (SELECT count(*) FROM public.order_items
    WHERE order_id='dddddddd-0000-0000-0000-000000000001'
      AND sub_order_id IS NOT NULL) = 2,
   'both seller lines so far are attributed to a sub-order');

SELECT pg_temp.p14_assert(
  (SELECT sub_order_id IS NULL FROM public.order_items
   WHERE order_id='dddddddd-0000-0000-0000-000000000001'
     AND product_id='bbbbbbb4-0000-0000-0000-000000000004') = true,
  'DLX-owned item gets NO sub-order (platform fulfils in-house)');

SELECT pg_temp.p14_assert(
  (SELECT count(*) FROM public.order_sub_orders s
    JOIN public.vendors v ON v.id=s.vendor_id
   WHERE s.order_id='dddddddd-0000-0000-0000-000000000001'
     AND v.business_name='Suspended Shop') = 0,
  'suspended vendor absent from a clean order');

-- aggregation across two lines from the same seller
INSERT INTO public.order_items (order_id, product_id, quantity, price_at_sale)
VALUES ('dddddddd-0000-0000-0000-000000000001', 'bbbbbbb2-0000-0000-0000-000000000002', 1, 50.00);

SELECT pg_temp.p14_assert(
  (SELECT count(*) FROM public.order_sub_orders
   WHERE order_id='dddddddd-0000-0000-0000-000000000001') = 2,
  'a second line from Seller A does NOT create a third sub-order');

SELECT pg_temp.p14_assert(
  (SELECT subtotal FROM public.order_sub_orders s
    JOIN public.vendors v ON v.id=s.vendor_id
   WHERE s.order_id='dddddddd-0000-0000-0000-000000000001'
     AND v.business_name='Seller A Shop') = 250.00,
  'Seller A subtotal accumulates to 250 across both lines');

SELECT pg_temp.p14_assert(
  (SELECT commission_amount FROM public.order_sub_orders s
    JOIN public.vendors v ON v.id=s.vendor_id
   WHERE s.order_id='dddddddd-0000-0000-0000-000000000001'
     AND v.business_name='Seller A Shop') = 25.00,
  'Seller A commission recomputed to 25 on accumulation');

SELECT pg_temp.p14_assert(
  (SELECT vendor_net_amount FROM public.order_sub_orders s
    JOIN public.vendors v ON v.id=s.vendor_id
   WHERE s.order_id='dddddddd-0000-0000-0000-000000000001'
     AND v.business_name='Seller A Shop') = 225.00,
  'Seller A net stays consistent with subtotal minus commission');

-- after the second Seller A line lands, all three seller lines are attributed
SELECT pg_temp.p14_assert(
  (SELECT count(*) FROM public.order_items
    WHERE order_id='dddddddd-0000-0000-0000-000000000001'
      AND sub_order_id IS NOT NULL) = 3,
   'all 3 seller items attributed once the second Seller A line is added');

-- a suspended seller's item still attributes, at zero commission
INSERT INTO public.orders (id, customer_id, customer_name, phone_number, municipality,
                           neighborhood, avenue, total_amount, status)
VALUES ('dddddddd-0000-0000-0000-000000000002', NULL, 'Guest Two', '+243991234567',
        'Goma', 'Katindo', 'Av. Kivu', 80.00, 'pending');
INSERT INTO public.order_items (order_id, product_id, quantity, price_at_sale)
VALUES ('dddddddd-0000-0000-0000-000000000002', 'bbbbbbb5-0000-0000-0000-000000000005', 1, 80.00);

SELECT pg_temp.p14_assert(
  (SELECT count(*) FROM public.order_sub_orders
    WHERE order_id='dddddddd-0000-0000-0000-000000000002') = 1,
  'suspended vendor item still produces a sub-order (sale not lost)');

SELECT pg_temp.p14_assert(
  (SELECT commission_rate FROM public.order_sub_orders
    WHERE order_id='dddddddd-0000-0000-0000-000000000002') = 0,
  'suspended vendor books at 0% commission, not their 30% rate');

SELECT pg_temp.p14_assert(
  (SELECT commission_amount FROM public.order_sub_orders
    WHERE order_id='dddddddd-0000-0000-0000-000000000002') = 0.00,
  'suspended vendor commission amount is 0.00');

-- ===========================================================================
-- 3. Commission ledger lifecycle
-- ===========================================================================
SELECT pg_temp.p14_assert(
  (SELECT count(*) FROM public.vendor_commission_ledger) = 0,
  'creating sub-orders books NO commission (COD is not paid yet)');

UPDATE public.order_sub_orders SET status='delivered'
 WHERE order_id='dddddddd-0000-0000-0000-000000000001'
   AND vendor_id='aaaaaaa1-0000-0000-0000-000000000001';

SELECT pg_temp.p14_assert(
  (SELECT count(*) FROM public.vendor_commission_ledger) = 1,
  'delivering a sub-order books exactly one ledger row');

SELECT pg_temp.p14_assert(
  (SELECT amount FROM public.vendor_commission_ledger
    WHERE vendor_id='aaaaaaa1-0000-0000-0000-000000000001') = 25.00,
  'ledger amount equals the sub-order commission');

SELECT pg_temp.p14_assert(
  (SELECT status FROM public.vendor_commission_ledger
    WHERE vendor_id='aaaaaaa1-0000-0000-0000-000000000001') = 'earned',
  'ledger status is earned (owed, not yet paid)');

UPDATE public.order_sub_orders SET status='delivered'
 WHERE order_id='dddddddd-0000-0000-0000-000000000002';

SELECT pg_temp.p14_assert(
  (SELECT count(*) FROM public.vendor_commission_ledger) = 2,
  'a zero-amount ledger row is still recorded, so the zero is visible');

-- parent promotion requires ALL legs
SELECT pg_temp.p14_assert(
  (SELECT status FROM public.orders WHERE id='dddddddd-0000-0000-0000-000000000001') = 'pending',
  'parent order stays pending while one seller has not delivered');

UPDATE public.order_sub_orders SET status='delivered'
 WHERE order_id='dddddddd-0000-0000-0000-000000000001'
   AND vendor_id='aaaaaaa2-0000-0000-0000-000000000002';

SELECT pg_temp.p14_assert(
  (SELECT status FROM public.orders WHERE id='dddddddd-0000-0000-0000-000000000001') = 'delivered',
  'parent promotes to delivered only once every sub-order agrees');

-- reversal
UPDATE public.order_sub_orders SET status='cancelled'
 WHERE order_id='dddddddd-0000-0000-0000-000000000002';

SELECT pg_temp.p14_assert(
  (SELECT status FROM public.vendor_commission_ledger
    WHERE sub_order_id=(SELECT id FROM public.order_sub_orders
                        WHERE order_id='dddddddd-0000-0000-0000-000000000002')) = 'reversed',
  'cancelling a sub-order reverses its commission');

UPDATE public.order_sub_orders SET status='delivered'
 WHERE order_id='dddddddd-0000-0000-0000-000000000002';

SELECT pg_temp.p14_assert(
  (SELECT count(*) FROM public.vendor_commission_ledger
    WHERE sub_order_id=(SELECT id FROM public.order_sub_orders
                        WHERE order_id='dddddddd-0000-0000-0000-000000000002')) = 1,
  're-delivering after cancel does NOT double-book (unique sub_order_id+kind)');

-- the commission rate is locked at sale time
UPDATE public.vendors SET commission_rate = 50
 WHERE id='aaaaaaa1-0000-0000-0000-000000000001';

SELECT pg_temp.p14_assert(
  (SELECT commission_rate FROM public.order_sub_orders
    WHERE vendor_id='aaaaaaa1-0000-0000-0000-000000000001') = 10,
  'raising the vendor rate does NOT retroactively change an existing sub-order');

INSERT INTO public.orders (id, customer_id, customer_name, phone_number, municipality,
                           neighborhood, avenue, total_amount, status)
VALUES ('dddddddd-0000-0000-0000-000000000003', NULL, 'Guest Three', '+243991234567',
        'Goma', 'Katindo', 'Av. Kivu', 100.00, 'pending');
INSERT INTO public.order_items (order_id, product_id, quantity, price_at_sale)
VALUES ('dddddddd-0000-0000-0000-000000000003', 'bbbbbbb1-0000-0000-0000-000000000001', 1, 100.00);

SELECT pg_temp.p14_assert(
  (SELECT commission_rate FROM public.order_sub_orders
    WHERE order_id='dddddddd-0000-0000-0000-000000000003') = 50,
  'the new rate DOES apply to a sale made after the change');

-- ===========================================================================
-- 4. Seller authorisation
-- ===========================================================================
SELECT pg_temp.p14_actor('22222222-2222-2222-2222-222222222222', 'authenticated');

SELECT pg_temp.p14_assert(
  (SELECT id FROM public.get_my_vendor()) = 'aaaaaaa1-0000-0000-0000-000000000001',
  'Seller A resolves their own vendor row');

SELECT pg_temp.p14_assert(
  (SELECT product_count FROM public.seller_dashboard()) = 2,
  'Seller A dashboard counts only their own 2 products');

SELECT pg_temp.p14_assert(
  (SELECT commission_pending FROM public.seller_dashboard()) = 25.00,
  'Seller A dashboard shows 25 owed');

SELECT pg_temp.p14_assert(
  (SELECT gross_revenue FROM public.seller_dashboard()) = 350.00,
  'Seller A gross revenue = 250 + 100 (cancelled leg excluded)');

-- Seller A cannot touch Seller B's sub-order
SELECT public.seller_update_sub_order_status(
  (SELECT id FROM public.order_sub_orders
    WHERE vendor_id='aaaaaaa2-0000-0000-0000-000000000002' LIMIT 1), 'preparing');
-- expected: 'Sub-order belongs to another seller'

-- Seller A cannot self-certify delivery
SELECT public.seller_update_sub_order_status(
  (SELECT id FROM public.order_sub_orders
    WHERE vendor_id='aaaaaaa1-0000-0000-0000-000000000001' LIMIT 1), 'delivered');
-- expected: 'Delivery must be confirmed by DLX staff'

-- Seller A cannot set a nonsense status
SELECT public.seller_update_sub_order_status(
  (SELECT id FROM public.order_sub_orders
    WHERE vendor_id='aaaaaaa1-0000-0000-0000-000000000001' LIMIT 1), 'teleported');
-- expected: 'Seller cannot set that status'

-- ...but CAN confirm a legitimate intermediate status
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.order_sub_orders
   WHERE vendor_id='aaaaaaa1-0000-0000-0000-000000000001'
     AND order_id='dddddddd-0000-0000-0000-000000000003';
  BEGIN
    PERFORM public.seller_update_sub_order_status(v_id, 'confirmed');
    RAISE NOTICE 'PASS: seller CAN advance a sub-order to confirmed';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'FAIL: seller could not confirm own sub-order: %', SQLERRM;
  END;
END;
$$;

-- a non-seller gets a zeroed dashboard, not an error
SELECT pg_temp.p14_actor('44444444-4444-4444-4444-444444444444', 'authenticated');
SELECT pg_temp.p14_assert(
  (SELECT product_count FROM public.seller_dashboard()) = 0,
  'a customer who is not a seller gets a zeroed dashboard row');
SELECT pg_temp.p14_assert(
  (SELECT get_my_vendor() IS NULL),
  'a customer who is not a seller resolves to NULL, not an exception');

-- a seller cannot call admin functions
SELECT * FROM public.admin_marketplace_overview();
-- expected: 'Admin access required'
SELECT * FROM public.admin_list_payouts(NULL);
-- expected: 'Admin access required'
SELECT public.admin_settle_payout('00000000-0000-0000-0000-000000000001', 'paid');
-- expected: 'Admin access required'
SELECT public.admin_approve_partner_application('00000000-0000-0000-0000-000000000001');
-- expected: 'Admin access required'

-- the public vendor view must not carry a seller's payout destination
SELECT pg_temp.p14_anon();
SELECT pg_temp.p14_assert(
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='vendor_public_cards'
      AND column_name IN ('payout_account_ref','payment_info','contact_email',
                          'contact_phone','commission_rate','suspended_reason')
  ),
  'vendor_public_cards exposes no financial or private seller columns');

SELECT pg_temp.p14_assert(
  (SELECT count(*) FROM public.vendor_public_cards) = 2,
  'anon still sees both active shops through the public view, suspended hidden');

-- Anonymous cannot read the money tables. Checked by privilege inspection, not
-- by SELECTing as postgres: superuser bypasses both grants and RLS, so a plain
-- SELECT here would always succeed and prove nothing.
SELECT pg_temp.p14_anon();
SELECT pg_temp.p14_assert(
  NOT has_table_privilege('anon', 'public.vendor_commission_ledger', 'SELECT'),
  'anon has no SELECT grant on the commission ledger');
SELECT pg_temp.p14_assert(
  NOT has_table_privilege('anon', 'public.order_sub_orders', 'SELECT'),
  'anon has no SELECT grant on sub-orders');
SELECT pg_temp.p14_assert(
  NOT has_table_privilege('anon', 'public.vendor_payouts', 'SELECT'),
  'anon has no SELECT grant on payouts');

-- Row-level isolation on the money tables, exercised as a real role. postgres
-- bypasses RLS, so every isolation guarantee in this suite is only meaningful
-- under SET ROLE authenticated.
DO $$
DECLARE v_n BIGINT;
BEGIN
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

  -- Seller B legitimately earned 40 on order 1, so the isolation guarantee is
  -- that they see their own row and nothing else -- not that they see none.
  SELECT count(*) INTO v_n FROM public.vendor_commission_ledger;
  IF v_n = 1 THEN
    RAISE NOTICE 'PASS: seller B sees only their own single ledger row';
  ELSE
    RAISE NOTICE 'FAIL: seller B read % ledger rows, expected only their own 1', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM public.vendor_commission_ledger
   WHERE vendor_id <> 'aaaaaaa2-0000-0000-0000-000000000002';
  IF v_n = 0 THEN
    RAISE NOTICE 'PASS: none of seller A''s or the suspended vendor''s ledger leaks to B';
  ELSE
    RAISE NOTICE 'FAIL: seller B can read % ledger rows belonging to other sellers', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM public.vendor_payouts;
  IF v_n = 0 THEN
    RAISE NOTICE 'PASS: seller B sees no payouts';
  ELSE
    RAISE NOTICE 'FAIL: seller B read % payouts', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM public.order_sub_orders;
  IF v_n = 1 THEN
    RAISE NOTICE 'PASS: seller B sees exactly their own single sub-order';
  ELSE
    RAISE NOTICE 'FAIL: seller B read % sub-orders, expected only their own 1', v_n;
  END IF;

  SET LOCAL request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
  SELECT count(*) INTO v_n FROM public.order_sub_orders;
  IF v_n = 0 THEN
    RAISE NOTICE 'PASS: a plain customer sees no sub-orders at all';
  ELSE
    RAISE NOTICE 'FAIL: a plain customer read % sub-orders', v_n;
  END IF;

  SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
  SELECT count(*) INTO v_n FROM public.order_sub_orders;
  IF v_n > 1 THEN
    RAISE NOTICE 'PASS: an admin sees every sub-order (%)', v_n;
  ELSE
    RAISE NOTICE 'FAIL: admin saw only % sub-orders', v_n;
  END IF;

  RESET ROLE;
END;
$$;

-- ===========================================================================
-- 5. Payouts
-- ===========================================================================
SELECT pg_temp.p14_actor('22222222-2222-2222-2222-222222222222', 'authenticated');

SELECT public.seller_request_payout('mobile_money', '');
-- expected: 'A payout destination is required'

SELECT public.seller_request_payout('crypto', '+243991234567');
-- expected: 'Unsupported payout method'

-- A seller who has never been paid anything cannot request a payout.
INSERT INTO public.vendors (id, profile_id, business_name, slug, province, city, status, commission_rate)
VALUES ('aaaaaaa4-0000-0000-0000-000000000004', '44444444-4444-4444-4444-444444444444',
        'Idle Shop', 'idle-shop', 'North Kivu', 'Goma', 'active', 10);

SELECT pg_temp.p14_actor('44444444-4444-4444-4444-444444444444', 'authenticated');
SELECT public.seller_request_payout('mobile_money', '+243991234567');
-- expected: 'There is nothing settled to pay out yet'

SELECT pg_temp.p14_actor('11111111-1111-1111-1111-111111111111', 'admin');
UPDATE public.order_sub_orders SET status='delivered'
 WHERE order_id='dddddddd-0000-0000-0000-000000000003';

-- the admin delivery confirms the pending 25
SELECT pg_temp.p14_actor('22222222-2222-2222-2222-222222222222', 'authenticated');
SELECT pg_temp.p14_assert(
  (SELECT commission_pending FROM public.seller_dashboard()) = 75.00,
  'after admin-confirmed delivery Seller A is owed 25 (order 1) + 50 (order 3 at 50%) = 75');

DO $$
DECLARE v_pid UUID; v_n BIGINT; v_g NUMERIC; v_c NUMERIC; v_net NUMERIC;
BEGIN
  SELECT payout_id, entry_count, gross_amount, commission, net_amount
    INTO v_pid, v_n, v_g, v_c, v_net
  FROM public.seller_request_payout('mobile_money', '+243991234567');
  RAISE NOTICE 'PASS: payout rows=% net=%', v_n, v_net;
END;
$$;

SELECT pg_temp.p14_assert(
  (SELECT count(*) FROM public.vendor_payouts) = 1,
  'payout request creates exactly one payout row');

SELECT pg_temp.p14_assert(
  (SELECT count(*) FROM public.vendor_payout_items) = 2,
  'payout covers both earned ledger entries');

SELECT pg_temp.p14_assert(
  (SELECT net_amount FROM public.vendor_payouts) = 275.00,
  'payout net = 225 (order 1) + 50 (order 3), commission removed from both legs');

SELECT pg_temp.p14_assert(
  (SELECT status FROM public.vendor_payouts) = 'requested',
  'a requested payout is NOT marked paid');

SELECT pg_temp.p14_assert(
  (SELECT count(*) FROM public.vendor_commission_ledger
     WHERE vendor_id='aaaaaaa1-0000-0000-0000-000000000001' AND status='earned') = 2,
  'ledger entries stay earned until DLX actually settles the payout');

-- double request is refused
SELECT public.seller_request_payout('mobile_money', '+243991234567');
-- expected: 'A payout is already in progress'

-- even after cancelling, the ledger must not be payable twice
SELECT pg_temp.p14_actor('11111111-1111-1111-1111-111111111111', 'admin');
SELECT public.admin_settle_payout(
  (SELECT id FROM public.vendor_payouts LIMIT 1), 'cancelled');

SELECT pg_temp.p14_assert(
  (SELECT count(*) FROM public.vendor_commission_ledger
     WHERE vendor_id='aaaaaaa1-0000-0000-0000-000000000001' AND status='earned') = 2,
  'cancelling a payout releases the ledger entries back to earned');

SELECT pg_temp.p14_actor('22222222-2222-2222-2222-222222222222', 'authenticated');
DO $$
DECLARE v_n BIGINT;
BEGIN
  SELECT entry_count INTO v_n FROM public.seller_request_payout('mobile_money', '+243991234567');
  RAISE NOTICE 'PASS: re-request after cancellation succeeds with % rows', v_n;
END;
$$;

-- settle for real
SELECT pg_temp.p14_actor('11111111-1111-1111-1111-111111111111', 'admin');
SELECT public.admin_settle_payout((SELECT id FROM public.vendor_payouts
                                   WHERE status='requested' LIMIT 1), 'paid');

SELECT pg_temp.p14_assert(
  (SELECT count(*) FROM public.vendor_commission_ledger
     WHERE vendor_id='aaaaaaa1-0000-0000-0000-000000000001' AND status='paid') = 2,
  'settling a payout marks its ledger entries paid');

SELECT pg_temp.p14_actor('22222222-2222-2222-2222-222222222222', 'authenticated');
SELECT pg_temp.p14_assert(
  (SELECT commission_pending FROM public.seller_dashboard()) = 0,
  'Seller A dashboard shows 0 owed after settlement');

SELECT pg_temp.p14_assert(
  (SELECT commission_paid FROM public.seller_dashboard()) = 75.00,
  'Seller A dashboard shows 75 paid');

SELECT pg_temp.p14_actor('22222222-2222-2222-2222-222222222222', 'authenticated');
SELECT public.seller_request_payout('mobile_money', '+243991234567');
-- expected: 'There is nothing settled to pay out yet' (all paid now)

-- ===========================================================================
-- 6. Warehouses and seller stock
-- ===========================================================================
SELECT pg_temp.p14_anon();
INSERT INTO public.vendor_warehouses (vendor_id, name) VALUES
  ('aaaaaaa1-0000-0000-0000-000000000001', 'Goma Central');
SELECT count(*) FROM public.vendor_warehouses;
-- expected: 0 (RLS hides other sellers' rows from anon)

SELECT pg_temp.p14_actor('22222222-2222-2222-2222-222222222222', 'authenticated');

DO $$
DECLARE v_w UUID; v_w2 UUID; v_a BIGINT; v_t INTEGER;
BEGIN
  SELECT id INTO v_w FROM public.seller_save_warehouse(NULL, 'Goma Central', 'Goma', 'North Kivu')
  WHERE id IS NOT NULL;
  -- may_be_null path: re-select by name
  SELECT id INTO v_w FROM public.vendor_warehouses WHERE name='Goma Central';

  BEGIN
    PERFORM public.seller_set_warehouse_stock('bbbbbbb1-0000-0000-0000-000000000001', v_w, 999);
    RAISE NOTICE 'FAIL: over-allocating stock was allowed';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PASS: over-allocation refused (%)', SQLERRM;
  END;

  BEGIN
    PERFORM public.seller_set_warehouse_stock('bbbbbbb1-0000-0000-0000-000000000001', v_w, -1);
    RAISE NOTICE 'FAIL: negative stock was allowed';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PASS: negative stock refused (%)', SQLERRM;
  END;

  BEGIN
    PERFORM public.seller_set_warehouse_stock('bbbbbbb3-0000-0000-0000-000000000003', v_w, 1);
    RAISE NOTICE 'FAIL: stock moved for a product owned by another seller';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PASS: cross-seller stock write refused (%)', SQLERRM;
  END;

  SELECT total_allocated, product_stock INTO v_a, v_t
  FROM public.seller_set_warehouse_stock('bbbbbbb1-0000-0000-0000-000000000001', v_w, 20);

  IF v_a = 20 AND v_t = 50 THEN
    RAISE NOTICE 'PASS: warehouse allocation 20 of 50 product stock';
  ELSE
    RAISE NOTICE 'FAIL: allocation=% product_stock=% expected 20/50', v_a, v_t;
  END IF;

  -- a second warehouse takes the remainder, and the sum still matches
  SELECT id INTO v_w2 FROM public.seller_save_warehouse(NULL, 'Goma Port');
  PERFORM public.seller_set_warehouse_stock('bbbbbbb1-0000-0000-0000-000000000001', v_w2, 30);

  IF (SELECT COALESCE(sum(quantity),0) FROM public.product_warehouse_stock
       WHERE product_id='bbbbbbb1-0000-0000-0000-000000000001') = 50 THEN
    RAISE NOTICE 'PASS: allocation sum equals products.stock_quantity (50)';
  ELSE
    RAISE NOTICE 'FAIL: allocation sum drifted from stock_quantity';
  END IF;

  BEGIN
    PERFORM public.seller_delete_warehouse(v_w);
    RAISE NOTICE 'FAIL: deleted a warehouse that still holds stock';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PASS: deleting a stocked warehouse refused (%)', SQLERRM;
  END;
END;
$$;

-- at most one default warehouse per seller
DO $$
DECLARE v_a UUID; v_b UUID;
BEGIN
  SELECT id INTO v_a FROM public.vendor_warehouses WHERE name='Goma Central';
  SELECT id INTO v_b FROM public.vendor_warehouses WHERE name='Goma Port';
  PERFORM public.seller_save_warehouse(v_a, 'Goma Central', 'Goma', 'North Kivu', NULL, true);
  PERFORM public.seller_save_warehouse(v_b, 'Goma Port', 'Goma', 'North Kivu', NULL, true);
  IF (SELECT count(*) FROM public.vendor_warehouses WHERE is_default) = 1 THEN
    RAISE NOTICE 'PASS: exactly one default warehouse per vendor';
  ELSE
    RAISE NOTICE 'FAIL: % default warehouses', (SELECT count(*) FROM public.vendor_warehouses WHERE is_default);
  END IF;
END;
$$;

-- seller B cannot see or write seller A's warehouse
SELECT pg_temp.p14_actor('33333333-3333-3333-3333-333333333333', 'authenticated');
SELECT pg_temp.p14_assert(
  (SELECT count(*) FROM public.seller_list_warehouses()) = 0,
  'Seller B sees none of Seller A''s warehouses');

SELECT public.seller_delete_warehouse(
  (SELECT id FROM public.vendor_warehouses WHERE name='Goma Central'));
-- expected: 'Warehouse not found'

SELECT public.seller_set_warehouse_stock(
  'bbbbbbb1-0000-0000-0000-000000000001',
  (SELECT id FROM public.vendor_warehouses WHERE name='Goma Central'), 5);
-- expected: 'Warehouse not found'

-- ===========================================================================
-- 6b. Seller product scope
-- ===========================================================================
-- The seller stock screen used to list the whole public catalogue and submit
-- allocations against products the seller does not own. The write RPC refused
-- them, so this asserts the read side is scoped rather than merely unhelpful.
SELECT pg_temp.p14_actor('22222222-2222-2222-2222-222222222222', 'authenticated');

SELECT pg_temp.p14_assert(
  (SELECT count(*) FROM public.seller_list_my_products()) = 2,
  'Seller A sees exactly their own 2 products');

SELECT pg_temp.p14_assert(
  NOT EXISTS (SELECT 1 FROM public.seller_list_my_products()
               WHERE product_id='bbbbbbb3-0000-0000-0000-000000000003'),
  'Seller A cannot see Seller B''s product');

SELECT pg_temp.p14_assert(
  NOT EXISTS (SELECT 1 FROM public.seller_list_my_products()
               WHERE product_id='bbbbbbb4-0000-0000-0000-000000000004'),
  'Seller A cannot see the DLX-owned product');

SELECT pg_temp.p14_assert(
  NOT EXISTS (SELECT 1 FROM public.seller_list_my_products()
               WHERE product_id='bbbbbbb5-0000-0000-0000-000000000005'),
  'Seller A cannot see the suspended shop''s product');

SELECT pg_temp.p14_assert(
  (SELECT stock_quantity FROM public.seller_list_my_products()
    WHERE product_id='bbbbbbb1-0000-0000-0000-000000000001') = 50,
  'seller_list_my_products reports the sellable stock number');

SELECT pg_temp.p14_actor('33333333-3333-3333-3333-333333333333', 'authenticated');
SELECT pg_temp.p14_assert(
  (SELECT count(*) FROM public.seller_list_my_products()) = 1,
  'Seller B sees only their own product');

-- a signed-in customer who never onboarded must get an empty set, not an error
SELECT pg_temp.p14_actor('44444444-4444-4444-4444-444444444444', 'authenticated');
SELECT pg_temp.p14_assert(
  (SELECT count(*) FROM public.seller_list_my_products()) = 0,
  'non-seller buyer gets an empty product list rather than an exception');

SELECT pg_temp.p14_anon();
SELECT public.seller_list_my_products();
-- expected: 'Authentication is required'

SELECT pg_temp.p14_assert(
  NOT has_function_privilege('anon','public.seller_list_my_products()','EXECUTE'),
  'anon cannot EXECUTE seller_list_my_products');

-- ===========================================================================
-- 6c. Sub-order status vocabulary
-- ===========================================================================
-- The seller dashboard offers status buttons. A TS union that drifts from the
-- CHECK constraint produces buttons the server can only reject, so the exact
-- vocabulary is asserted here rather than left to convention.
SELECT pg_temp.p14_assert(
  (SELECT pg_get_constraintdef(oid) LIKE '%out_for_delivery%'
     AND pg_get_constraintdef(oid) LIKE '%refunded%'
     AND pg_get_constraintdef(oid) NOT LIKE '%shipped%'
   FROM pg_constraint
   WHERE conrelid='public.order_sub_orders'::regclass AND contype='c'
     AND pg_get_constraintdef(oid) LIKE '%status = ANY%'),
  'sub-order status constraint has ready/out_for_delivery/refunded and no shipped');

-- Every status a seller may push must be one the RPC actually accepts.
SELECT pg_temp.p14_assert(
  NOT EXISTS (
    SELECT 1 FROM unnest(ARRAY['preparing','confirmed','ready','out_for_delivery']) AS s(status)
    WHERE NOT (pg_get_functiondef('public.seller_update_sub_order_status(uuid,text)'::regprocedure)
                 LIKE '%' || s.status || '%')
  ),
  'all four seller-settable statuses are accepted by seller_update_sub_order_status');

SELECT pg_temp.p14_assert(
  pg_get_functiondef('public.seller_update_sub_order_status(uuid,text)'::regprocedure)
    LIKE '%NOT public.is_admin()%',
  'seller_update_sub_order_status still blocks self-certified delivery');

-- ===========================================================================
-- 7. Onboarding validation
-- ===========================================================================
SELECT pg_temp.p14_actor('22222222-2222-2222-2222-222222222222', 'authenticated');
SELECT public.update_my_vendor_onboarding('Seller A SARL', 'not-an-email', NULL, NULL, NULL, NULL, NULL);
-- expected: 'Invalid contact email'

SELECT public.update_my_vendor_onboarding('Seller A SARL', NULL, '12345', NULL, NULL, NULL, NULL);
-- expected: 'Contact phone must be in international format'

SELECT public.update_my_vendor_onboarding('Seller A SARL', NULL, NULL, 'bitcoin', NULL, NULL, NULL);
-- expected: 'Unsupported payout method'

-- a rejected call must not have partially written anything
SELECT pg_temp.p14_assert(
  (SELECT legal_name FROM public.vendors
    WHERE id='aaaaaaa1-0000-0000-0000-000000000001') IS NULL,
  'a rejected onboarding call writes nothing at all (no partial update)');

DO $$
DECLARE v_r public.vendors;
BEGIN
  v_r := public.update_my_vendor_onboarding(
    'Seller A SARL', 'a@example.com', '+243991234567', 'mobile_money', '+243999000000', NULL, NULL);
  IF v_r.legal_name = 'Seller A SARL' AND v_r.onboarding_step = 'documents' THEN
    RAISE NOTICE 'PASS: valid onboarding saved and advanced to ''documents''';
  ELSE
    RAISE NOTICE 'FAIL: onboarding saved as legal_name=% step=%', v_r.legal_name, v_r.onboarding_step;
  END IF;
END;
$$;

-- a seller cannot set their own commission rate or status
SELECT pg_temp.p14_assert(
  (SELECT commission_rate FROM public.vendors
    WHERE id='aaaaaaa1-0000-0000-0000-000000000001') = 50,
  'seller onboarding cannot rewrite the commission rate (still the admin-set 50)');

-- ===========================================================================
-- 8. Application -> vendor approval
-- ===========================================================================
INSERT INTO public.partner_applications (
  id, business_name, owner_name, phone, email, province, city,
  business_category, description, collaboration_type, applicant_id, status)
VALUES ('eeeeeeee-0000-0000-0000-000000000001', 'New Shop', 'New Owner', '+243991234567',
        'new@example.com', 'North Kivu', 'Goma', 'Clothing', 'Sells clothes', 'vendor',
        '55555555-5555-5555-5555-555555555555', 'pending');

SELECT pg_temp.p14_actor('11111111-1111-1111-1111-111111111111', 'admin');
DO $$
DECLARE v_v public.vendors;
BEGIN
  v_v := public.admin_approve_partner_application(
    'eeeeeeee-0000-0000-0000-000000000001', 12.5);
  IF v_v.business_name = 'New Shop' AND v_v.status = 'active'
     AND v_v.commission_rate = 12.5 AND v_v.slug = 'new-shop' THEN
    RAISE NOTICE 'PASS: approving an application creates an active vendor with a clean slug';
  ELSE
    RAISE NOTICE 'FAIL: approval produced name=% status=% rate=% slug=%',
      v_v.business_name, v_v.status, v_v.commission_rate, v_v.slug;
  END IF;
END;
$$;

SELECT pg_temp.p14_assert(
  (SELECT status FROM public.partner_applications
    WHERE id='eeeeeeee-0000-0000-0000-000000000001') = 'approved',
  'the application itself is marked approved');

-- re-approving must not create a second vendor
DO $$
DECLARE v_before INT; v_after INT;
BEGIN
  SELECT count(*) INTO v_before FROM public.vendors;
  BEGIN
    PERFORM public.admin_approve_partner_application('eeeeeeee-0000-0000-0000-000000000001');
    RAISE NOTICE 'FAIL: re-approving a second time was allowed';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PASS: re-approval refused (%)', SQLERRM;
  END;
  SELECT count(*) INTO v_after FROM public.vendors;
  IF v_before = v_after THEN
    RAISE NOTICE 'PASS: vendor count unchanged after the refused re-approval';
  ELSE
    RAISE NOTICE 'FAIL: vendor count moved % -> %', v_before, v_after;
  END IF;
END;
$$;

-- commission rate bounds
SELECT public.admin_approve_partner_application('eeeeeeee-0000-0000-0000-000000000001', 150);
-- expected: either 'already approved' or 'Commission rate must be between 0 and 100'

-- slug collision resolution
INSERT INTO public.partner_applications (
  id, business_name, owner_name, phone, province, city, business_category,
  description, collaboration_type, applicant_id, status)
VALUES ('eeeeeeee-0000-0000-0000-000000000002', 'New Shop', 'Second Owner', '+243991234567',
        'North Kivu', 'Goma', 'Food', 'Also sells', 'vendor',
        '66666666-6666-6666-6666-666666666666', 'pending');

DO $$
DECLARE v_v public.vendors;
BEGIN
  v_v := public.admin_approve_partner_application('eeeeeeee-0000-0000-0000-000000000002', 5);
  IF v_v.slug <> 'new-shop' AND v_v.slug LIKE 'new-shop%' THEN
    RAISE NOTICE 'PASS: duplicate business name resolved to a distinct slug (%)', v_v.slug;
  ELSE
    RAISE NOTICE 'FAIL: slug collision produced %', v_v.slug;
  END IF;
END;
$$;

-- ===========================================================================
-- 9. Admin overview
-- ===========================================================================
DO $$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM public.admin_marketplace_overview();
  IF r.active_vendor_count = 5 THEN
    RAISE NOTICE 'PASS: admin overview counts 5 active vendors';
  ELSE
    RAISE NOTICE 'FAIL: active_vendor_count=% expected 5', r.active_vendor_count;
  END IF;
END;
$$;

-- ===========================================================================
-- 10. Per-vendor deliveries
-- ===========================================================================
SELECT pg_temp.p14_anon();
INSERT INTO public.deliveries (order_id, vendor_id) VALUES
  ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaa1-0000-0000-0000-000000000001');
INSERT INTO public.deliveries (order_id, vendor_id) VALUES
  ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaa2-0000-0000-0000-000000000002');
SELECT pg_temp.p14_assert(
  (SELECT count(*) FROM public.deliveries
    WHERE order_id='dddddddd-0000-0000-0000-000000000001') = 2,
  'one order can now have one delivery leg per seller');

INSERT INTO public.deliveries (order_id, vendor_id) VALUES
  ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaa1-0000-0000-0000-000000000001');
-- expected: duplicate key (unique per order+vendor)

-- the platform leg keeps its own single-delivery guarantee
INSERT INTO public.deliveries (order_id) VALUES ('dddddddd-0000-0000-0000-000000000003');
INSERT INTO public.deliveries (order_id) VALUES ('dddddddd-0000-0000-0000-000000000003');
-- expected: duplicate key (platform leg still unique per order)

-- ===========================================================================
-- 11. Supplier isolation
-- ===========================================================================
SELECT pg_temp.p14_actor('11111111-1111-1111-1111-111111111111', 'admin');
INSERT INTO public.suppliers (id, vendor_id, name, city) VALUES
  ('ffffffff-0000-0000-0000-000000000001', 'aaaaaaa1-0000-0000-0000-000000000001', 'Textile Mill', 'Goma'),
  ('ffffffff-0000-0000-0000-000000000002', NULL, 'DLX Own Supplier', 'Goma');

SELECT pg_temp.p14_actor('22222222-2222-2222-2222-222222222222', 'authenticated');
SELECT pg_temp.p14_assert(
  (SELECT count(*) FROM public.seller_list_suppliers()) = 1,
  'Seller A sees only their own supplier');

SELECT pg_temp.p14_actor('33333333-3333-3333-3333-333333333333', 'authenticated');
SELECT pg_temp.p14_assert(
  (SELECT count(*) FROM public.seller_list_suppliers()) = 0,
  'Seller B cannot see Seller A''s supplier');

-- ===========================================================================
-- 12. Admin delivery bypasses the seller restriction
-- ===========================================================================
SELECT pg_temp.p14_actor('11111111-1111-1111-1111-111111111111', 'admin');
DO $$
DECLARE v_s TEXT;
BEGIN
  SELECT status INTO v_s FROM public.seller_update_sub_order_status(
    (SELECT id FROM public.order_sub_orders
      WHERE order_id='dddddddd-0000-0000-0000-000000000003' LIMIT 1), 'delivered');
  IF v_s = 'delivered' THEN
    RAISE NOTICE 'PASS: an admin may confirm delivery';
  ELSE
    RAISE NOTICE 'FAIL: admin delivery returned %', v_s;
  END IF;
END;
$$;

-- ===========================================================================
-- 13. Access control on the money and identity columns
-- ===========================================================================
-- These are the checks that matter most, so they run as their own section using
-- set_role rather than trusting superuser RLS bypass.

SELECT pg_temp.p14_anon();

-- anon must not be able to read the seller table at all any more: the old
-- `status = 'active'` policy exposed payout_account_ref and contact details.
SELECT pg_temp.p14_assert(
  NOT has_table_privilege('anon', 'public.vendors', 'SELECT'),
  'anon has no SELECT grant on the vendors table');

-- ...but the public card view is the supported replacement
SELECT pg_temp.p14_assert(
  has_table_privilege('anon', 'public.vendor_public_cards', 'SELECT'),
  'anon can still browse sellers through vendor_public_cards');

SELECT pg_temp.p14_assert(
  (SELECT count(*) FROM public.vendor_public_cards) > 0,
  'vendor_public_cards returns rows to anon');

-- anon must not see seller stock or supplier sourcing
SELECT pg_temp.p14_assert(
  NOT has_table_privilege('anon', 'public.product_warehouse_stock', 'SELECT'),
  'anon has no SELECT grant on warehouse stock');

SELECT pg_temp.p14_assert(
  NOT has_table_privilege('anon', 'public.product_suppliers', 'SELECT'),
  'anon has no SELECT grant on product supplier links');

-- a seller must not be able to write money columns directly
-- authenticated DOES hold table writes on vendors, because the admin console
-- manages vendor records directly. The real gate is RLS: no seller write policy
-- exists, so a non-admin matches none. That is asserted below under SET ROLE,
-- which is what actually matters -- a privilege check here would pass for the
-- wrong reason if the policy set ever changed.
SELECT pg_temp.p14_assert(
  has_table_privilege('authenticated', 'public.vendors', 'UPDATE'),
  'authenticated holds vendor UPDATE, gated by the admin-only RLS policy');

-- RLS itself, exercised as a non-superuser role
DO $$
DECLARE v_leak BIGINT; v_write TEXT; v_num NUMERIC; v_status TEXT;
BEGIN
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

  -- Seller A reading their own row is fine and must include payout fields.
  SELECT count(*) INTO v_leak FROM public.vendors
    WHERE id = 'aaaaaaa1-0000-0000-0000-000000000001';
  IF v_leak = 1 THEN
    RAISE NOTICE 'PASS: a seller can still read their own vendor row';
  ELSE
    RAISE NOTICE 'FAIL: seller read % of their own vendor rows', v_leak;
  END IF;

  -- Money-column writes must be refused. RLS does NOT raise here: a row the
  -- policy cannot see is simply invisible, so an UPDATE matching zero rows is a
  -- silent no-op rather than an error. Asserting on the absence of an exception
  -- would pass even if the write had gone through, so these checks verify the
  -- stored value instead.
  UPDATE public.vendors SET commission_rate = 0
   WHERE id = 'aaaaaaa1-0000-0000-0000-000000000001';
  SELECT commission_rate INTO v_num FROM public.vendors
   WHERE id = 'aaaaaaa1-0000-0000-0000-000000000001';
  IF v_num = 50 THEN
    RAISE NOTICE 'PASS: RLS left the commission rate untouched at 50';
  ELSE
    RAISE NOTICE 'FAIL: a seller changed the commission rate to %', v_num;
  END IF;

  UPDATE public.vendors SET status = 'suspended'
   WHERE id = 'aaaaaaa1-0000-0000-0000-000000000001';
  SELECT status INTO v_status FROM public.vendors
   WHERE id = 'aaaaaaa1-0000-0000-0000-000000000001';
  IF v_status = 'active' THEN
    RAISE NOTICE 'PASS: RLS left the vendor status untouched';
  ELSE
    RAISE NOTICE 'FAIL: a seller changed the vendor status to %', v_status;
  END IF;

  -- INSERT is the one case RLS does reject loudly, so an exception here is the
  -- correct signal.
  BEGIN
    INSERT INTO public.vendors (profile_id, business_name, slug, province, status, commission_rate)
    VALUES (auth.uid(), 'Rogue Shop', 'rogue-shop', 'Nord-Kivu', 'active', 0);
    v_write := 'ALLOWED';
  EXCEPTION WHEN OTHERS THEN
    v_write := SQLERRM;
  END;
  IF v_write = 'ALLOWED' THEN
    RAISE NOTICE 'FAIL: a seller self-approved an active 0%% vendor';
  ELSE
    RAISE NOTICE 'PASS: the self-registration policy refused an active 0%% vendor (%)', v_write;
  END IF;

  -- The intended self-registration path still works: a pending stub at 0%.
  -- Run as a profile that owns no shop yet: vendors.profile_id is UNIQUE, so the
  -- seller fixture rows above would collide before the policy was even reached.
  SET LOCAL request.jwt.claims = '{"sub":"77777777-7777-7777-7777-777777777777","role":"authenticated"}';
  BEGIN
    INSERT INTO public.vendors (profile_id, business_name, slug, province, status, commission_rate)
    VALUES (auth.uid(), 'Honest Stub', 'honest-stub', 'Nord-Kivu', 'pending', 0);
    v_write := 'ALLOWED';
  EXCEPTION WHEN OTHERS THEN
    v_write := 'REFUSED: ' || SQLERRM;
  END;
  IF v_write = 'ALLOWED' THEN
    DELETE FROM public.vendors WHERE slug = 'honest-stub';
    RAISE NOTICE 'PASS: self-registration of a pending 0%% stub still works';
  ELSE
    RAISE NOTICE 'FAIL: a seller could not create a pending stub (% )', v_write;
  END IF;

  -- One shop per profile is enforced in the schema, not just by the policy.
  SET LOCAL request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
  BEGIN
    INSERT INTO public.vendors (profile_id, business_name, slug, province, status, commission_rate)
    VALUES (auth.uid(), 'Second Shop', 'second-shop', 'Nord-Kivu', 'pending', 0);
    v_write := 'ALLOWED';
  EXCEPTION WHEN OTHERS THEN
    v_write := 'REFUSED: ' || SQLERRM;
  END;
  IF v_write <> 'ALLOWED' THEN
    RAISE NOTICE 'PASS: a second shop row for one profile is refused (%)', v_write;
  ELSE
    RAISE NOTICE 'FAIL: one profile can own two vendor rows';
  END IF;

  -- ...and an admin can still manage vendors directly, which is what the admin
  -- console relies on.
  SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
  BEGIN
    UPDATE public.vendors SET commission_rate = 12.5
     WHERE id = 'aaaaaaa1-0000-0000-0000-000000000001';
    v_write := 'ALLOWED';
    UPDATE public.vendors SET commission_rate = 50
     WHERE id = 'aaaaaaa1-0000-0000-0000-000000000001';
  EXCEPTION WHEN OTHERS THEN
    v_write := SQLERRM;
  END;
  IF v_write = 'ALLOWED' THEN
    RAISE NOTICE 'PASS: an admin can still set a vendor commission rate directly';
  ELSE
    RAISE NOTICE 'FAIL: the admin console can no longer manage vendors (%)', v_write;
  END IF;

  RESET ROLE;
END;
$$;

-- ===========================================================================
-- Cleanup
-- ===========================================================================
TRUNCATE public.vendor_payout_items, public.vendor_payouts,
         public.vendor_commission_ledger, public.order_sub_orders,
         public.order_items, public.orders, public.deliveries,
         public.product_warehouse_stock, public.vendor_warehouses,
         public.product_suppliers, public.suppliers,
         public.shop_products, public.partner_applications,
         public.products, public.vendors, public.profiles RESTART IDENTITY CASCADE;

DROP FUNCTION IF EXISTS pg_temp.p14_actor(uuid, text);
DROP FUNCTION IF EXISTS pg_temp.p14_anon();
DROP FUNCTION IF EXISTS pg_temp.p14_assert(boolean, text);

DELETE FROM auth.users WHERE id IN (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555',
  '66666666-6666-6666-6666-666666666666',
  '77777777-7777-7777-7777-777777777777');
