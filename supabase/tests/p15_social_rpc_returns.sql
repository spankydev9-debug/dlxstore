-- ==========================================================================
-- DLXSTORE social-RPC return-contract suite (P15).
-- Run against the local stack:
--   docker cp supabase/tests/<file> supabase_db_dlxstore:/tmp/t.sql
--   docker exec supabase_db_dlxstore psql -U postgres -d postgres -f /tmp/t.sql
-- ==========================================================================
--
-- Regression cover for the two RPCs repaired by
-- 20261018090000_fix_social_rpc_return_types.sql. Both were present in the
-- production ledger and called by live storefront code, and neither had ever
-- executed successfully: PostgREST rejected every call with a SQLSTATE, the
-- callers swallow the error, and the affected UI rendered without the feature.
-- Confirmed against production on 2026-10-04:
--
--   get_trending_products     42P10  ORDER BY position 9 is not in select list
--   get_product_social_proof  42804  bigint returned where INTEGER declared
--
-- These tests are about the RETURN CONTRACT, not the ranking heuristics. The
-- bugs were type/plumbing faults, so "some rows came back" would be too weak an
-- assertion. Each check below pins a declared type, a column count, or an exact
-- ordering rule, and the declared types are read back through
-- pg_get_function_result() rather than assumed.
--
-- Runs as postgres. Auth is faked by writing auth.uid() straight into the
-- request GUCs, as in the P13/P14 suites. This file is NOT wrapped in BEGIN, so
-- claims must be set session-level (false) to survive between statements.
--
-- Counted: PASS / FAIL lines. Anything that raises prints the error text
-- instead of a PASS, so the expected-failure count stays meaningful.

\set ON_ERROR_STOP off
\timing off

-- ---------------------------------------------------------------------------
-- Harness
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.p15_actor(p_uid UUID, p_role TEXT)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, false);
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.p15_anon()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', NULL, false);
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.p15_assert(BOOLEAN, TEXT)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF $1 THEN RAISE NOTICE 'PASS: %', $2; ELSE RAISE NOTICE 'FAIL: %', $2; END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
TRUNCATE public.referral_codes, public.product_shares, public.wishlist, public.order_items,
         public.orders, public.product_views, public.product_images,
         public.follows, public.friendships, public.profile_blocks,
         public.products, public.profiles RESTART IDENTITY CASCADE;

-- profiles.id has a FK to auth.users(id), so the auth rows must exist first.
INSERT INTO auth.users (id, email) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'ana@example.test'),
  ('a2222222-2222-2222-2222-222222222222', 'ben@example.test'),
  ('a3333333-3333-3333-3333-333333333333', 'cleo@example.test'),
  ('a4444444-4444-4444-4444-444444444444', 'dan@example.test');

-- email is NOT NULL on this schema.
INSERT INTO public.profiles (id, email, full_name, role) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'ana@example.test',  'Ana',  'customer'),
  ('a2222222-2222-2222-2222-222222222222', 'ben@example.test',  'Ben',  'customer'),
  ('a3333333-3333-3333-3333-333333333333', 'cleo@example.test', 'Cleo', 'customer'),
  ('a4444444-4444-4444-4444-444444444444', 'dan@example.test',  'Dan',  'customer');

-- description / brand / sku are NOT NULL on this schema.
--   Alpha  2 distinct buyers, 1 wishlist -> score 2
--   Bravo  1 buyer, 1 wishlist,           -> score 1
--   Zulu   1 buyer, 0 wishlist,           -> score 1
--   Soldout 1 buyer, stock driven to 0 by its own order line -> filtered out
-- Bravo and Zulu tie on score so the name tiebreaker is observable.
INSERT INTO public.products (id, name, slug, price, description, brand, sku, stock_quantity) VALUES
  ('b1111111-1111-1111-1111-111111111111', 'Alpha',   'alpha',   10.00, 'd', 'DLX', 'SKU-A', 5),
  ('b2222222-2222-2222-2222-222222222222', 'Bravo',   'bravo',   20.00, 'd', 'DLX', 'SKU-B', 5),
  ('b3333333-3333-3333-3333-333333333333', 'Zulu',    'zulu',    30.00, 'd', 'DLX', 'SKU-C', 5),
  ('b4444444-4444-4444-4444-444444444444', 'Soldout', 'soldout', 40.00, 'd', 'DLX', 'SKU-D', 1);

-- Delivered orders dated inside the 14-day window the RPC ranks over.
INSERT INTO public.orders (id, customer_id, customer_name, phone_number, municipality,
                           neighborhood, avenue, total_amount, status, created_at) VALUES
  ('c1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'Ana',  '+243990000001', 'Goma', 'Katindo', 'Av. Kivu',  10.00, 'delivered', now() - interval '2 days'),
  ('c2222222-2222-2222-2222-222222222222', 'a2222222-2222-2222-2222-222222222222', 'Ben',  '+243990000002', 'Goma', 'Katindo', 'Av. Kivu',  10.00, 'delivered', now() - interval '3 days'),
  ('c3333333-3333-3333-3333-333333333333', 'a1111111-1111-1111-1111-111111111111', 'Ana',  '+243990000001', 'Goma', 'Katindo', 'Av. Kivu',  20.00, 'delivered', now() - interval '4 days'),
  ('c4444444-4444-4444-4444-444444444444', 'a2222222-2222-2222-2222-222222222222', 'Ben',  '+243990000002', 'Goma', 'Katindo', 'Av. Kivu',  30.00, 'delivered', now() - interval '5 days'),
  ('c5555555-5555-5555-5555-555555555555', 'a3333333-3333-3333-3333-333333333333', 'Cleo', '+243990000003', 'Goma', 'Katindo', 'Av. Kivu',  40.00, 'delivered', now() - interval '6 days'),
  -- A pending order must count as neither proof nor trend.
  ('c6666666-6666-6666-6666-666666666666', 'a4444444-4444-4444-4444-444444444444', 'Dan',  '+243990000004', 'Goma', 'Katindo', 'Av. Kivu',  30.00, 'pending',   now() - interval '1 day');

INSERT INTO public.order_items (id, order_id, product_id, quantity, price_at_sale) VALUES
  ('d1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111111', 'b1111111-1111-1111-1111-111111111111', 1, 10.00),
  ('d2222222-2222-2222-2222-222222222222', 'c2222222-2222-2222-2222-222222222222', 'b1111111-1111-1111-1111-111111111111', 1, 10.00),
  ('d3333333-3333-3333-3333-333333333333', 'c3333333-3333-3333-3333-333333333333', 'b2222222-2222-2222-2222-222222222222', 1, 20.00),
  ('d4444444-4444-4444-4444-444444444444', 'c4444444-4444-4444-4444-444444444444', 'b3333333-3333-3333-3333-333333333333', 1, 30.00),
  ('d5555555-5555-5555-5555-555555555555', 'c5555555-5555-5555-5555-555555555555', 'b4444444-4444-4444-4444-444444444444', 1, 40.00),
  ('d6666666-6666-6666-6666-666666666666', 'c6666666-6666-6666-6666-666666666666', 'b3333333-3333-3333-3333-333333333333', 1, 30.00);

INSERT INTO public.wishlist (user_id, product_id, created_at) VALUES
  ('a3333333-3333-3333-3333-333333333333', 'b1111111-1111-1111-1111-111111111111', now() - interval '1 day'),
  ('a4444444-4444-4444-4444-444444444444', 'b2222222-2222-2222-2222-222222222222', now() - interval '1 day');

-- ============================================================================
-- SECTION 1 — get_trending_products executes at all (the 42P10 guard)
-- ============================================================================
-- The regression this file exists for. Against the unfixed function this block
-- raises 42P10 and everything downstream is unreachable.
DO $t$
DECLARE
  v_rows INTEGER;
BEGIN
  BEGIN
    SELECT count(*) INTO v_rows FROM public.get_trending_products(12);
    PERFORM pg_temp.p15_assert(true, 'get_trending_products executes without raising (was 42P10)');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.p15_assert(false,
      'get_trending_products executes without raising (was 42P10) -> ' || SQLERRM);
  END;
END;
$t$;

-- ============================================================================
-- SECTION 2 — get_trending_products declared return contract
-- ============================================================================
-- Pins the contract rather than "it ran". pg_attribute holds no row-descriptor
-- rows for a RETURNS TABLE function, so pg_get_function_result() is the
-- authoritative read-back of what callers will receive.
DO $t$
DECLARE
  v_result   TEXT;
  v_expected TEXT;
  v_names    TEXT;
  v_slug     TEXT;
BEGIN
  v_result := pg_get_function_result('public.get_trending_products(integer)'::regprocedure);
  v_expected := 'TABLE(id uuid, name text, slug text, price numeric, discount_price numeric, image_url text, product_type text, score integer)';

  PERFORM pg_temp.p15_assert(v_result = v_expected,
    format('get_trending_products return contract unchanged (expected %s / got %s)', v_expected, v_result));

  -- score must be declared integer. This is the column the broken
  -- "ORDER BY 9" was trying to sort by, so its type is load-bearing.
  PERFORM pg_temp.p15_assert(v_result LIKE '%score integer%',
    'get_trending_products declares score as integer');

  -- Runtime types, observed rather than assumed: a LIMIT 0 probe still resolves
  -- the row descriptor, so this catches a declared/actual disagreement.
  CREATE TEMP VIEW p15_gtp_shape AS
    SELECT * FROM public.get_trending_products(1) LIMIT 0;

  SELECT string_agg(column_name || ' ' || data_type, ', ' ORDER BY ordinal_position)
    INTO v_names
    FROM information_schema.columns
   WHERE table_schema LIKE 'pg_temp%' AND table_name = 'p15_gtp_shape';

  PERFORM pg_temp.p15_assert(v_names = 'id uuid, name text, slug text, price numeric, discount_price numeric, image_url text, product_type text, score integer',
    format('get_trending_products runtime column types match (got %s)', v_names));

  -- The named columns resolve to product fields, i.e. the positional mapping
  -- the client relies on has not shifted.
  SELECT name, slug INTO v_names, v_slug
    FROM public.get_trending_products(24) ORDER BY score DESC LIMIT 1;
  PERFORM pg_temp.p15_assert(v_names = 'Alpha' AND v_slug = 'alpha',
    format('get_trending_products name/slug map to product columns (got %s/%s)', v_names, v_slug));

  DROP VIEW IF EXISTS p15_gtp_shape;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.p15_assert(false, 'get_trending_products return contract -> ' || SQLERRM);
END;
$t$;

-- ============================================================================
-- SECTION 3 — get_trending_products ranking intent is preserved
-- ============================================================================
-- The 42P10 fix must not quietly change what the rail is ordered by. Score is
-- the composite the function's own comment documents ("circle saves weigh more
-- than store volume"), and name is the deterministic tiebreaker. The fixtures
-- give Alpha score 2 and give Bravo and Zulu score 1 each, so this distinguishes
-- "ordered by score" from "ordered by insertion order" and from "ordered by
-- name".
DO $t$
DECLARE
  v_names   TEXT;
  v_scores  TEXT;
  v_seq_ok  BOOLEAN;
  v_count   INTEGER;
  v_zulu    INTEGER;
BEGIN
  -- Two-level window: rank first, then lag over that rank.
  SELECT string_agg(name, ',' ORDER BY rn),
         string_agg(score::TEXT, ',' ORDER BY rn),
         bool_and(ok),
         count(*)
    INTO v_names, v_scores, v_seq_ok, v_count
    FROM (
      SELECT rn, name, score,
             score <= lag(score) OVER (ORDER BY rn) AS ok
        FROM (
          SELECT row_number() OVER () AS rn, name, score
            FROM public.get_trending_products(24)
        ) numbered
    ) t;

  PERFORM pg_temp.p15_assert(v_count = 3,
    format('get_trending_products returns the 3 in-stock trending products (got %s)', v_count));

  PERFORM pg_temp.p15_assert(COALESCE(v_seq_ok, false),
    format('get_trending_products orders by score descending (scores: %s)', v_scores));

  PERFORM pg_temp.p15_assert(v_names = 'Alpha,Bravo,Zulu',
    format('get_trending_products sorts score DESC then name ASC (got %s)', v_names));

  -- The stock filter is part of the ranking contract and must survive the fix.
  PERFORM pg_temp.p15_assert(
    NOT EXISTS (SELECT 1 FROM public.get_trending_products(24) WHERE name = 'Soldout'),
    'get_trending_products still excludes zero-stock products');

  -- A pending order is not a sale: Zulu's score stays at 1 despite the extra
  -- pending order naming the same product.
  SELECT score INTO v_zulu FROM public.get_trending_products(24) WHERE name = 'Zulu';
  PERFORM pg_temp.p15_assert(v_zulu = 1,
    format('get_trending_products ignores pending orders when scoring (got %s)', v_zulu));
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.p15_assert(false, 'get_trending_products ranking -> ' || SQLERRM);
END;
$t$;

-- ============================================================================
-- SECTION 4 — get_trending_products paging contract
-- ============================================================================
DO $t$
DECLARE
  v_all INTEGER;
  v_n   INTEGER;
BEGIN
  SELECT count(*) INTO v_all FROM public.get_trending_products(24);

  SELECT count(*) INTO v_n FROM public.get_trending_products(1);
  PERFORM pg_temp.p15_assert(v_n = 1,
    format('p_limit=1 returns exactly 1 row (got %s)', v_n));

  -- 0 and negative are clamped up to 1, not treated as "no rows" and not errors.
  SELECT count(*) INTO v_n FROM public.get_trending_products(0);
  PERFORM pg_temp.p15_assert(v_n = 1,
    format('p_limit=0 is clamped to 1 row (got %s)', v_n));

  BEGIN
    SELECT count(*) INTO v_n FROM public.get_trending_products(-5);
    PERFORM pg_temp.p15_assert(v_n = 1,
      format('negative p_limit is clamped to 1 row (got %s)', v_n));
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.p15_assert(false, 'negative p_limit raises -> ' || SQLERRM);
  END;

  SELECT count(*) INTO v_n FROM public.get_trending_products(500);
  PERFORM pg_temp.p15_assert(v_n = LEAST(v_all, 24),
    format('p_limit above the cap is clamped to 24 (got %s)', v_n));

  BEGIN
    PERFORM count(*) FROM public.get_trending_products(NULL);
    PERFORM pg_temp.p15_assert(true, 'NULL p_limit falls back to the default without raising');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.p15_assert(false, 'NULL p_limit raises -> ' || SQLERRM);
  END;
END;
$t$;

-- ============================================================================
-- SECTION 5 — get_product_social_proof executes at all (the 42804 guard)
-- ============================================================================
DO $t$
BEGIN
  BEGIN
    PERFORM * FROM public.get_product_social_proof('b1111111-1111-1111-1111-111111111111');
    PERFORM pg_temp.p15_assert(true, 'get_product_social_proof executes without raising (was 42804)');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.p15_assert(false,
      'get_product_social_proof executes without raising (was 42804) -> ' || SQLERRM);
  END;
END;
$t$;

-- ============================================================================
-- SECTION 6 — get_product_social_proof declared return contract
-- ============================================================================
-- This is the assertion that actually pins 42804. plpgsql compares the RETURN
-- QUERY tuple descriptor to RETURNS TABLE column by column and demands an exact
-- match, so all six count columns must be integer and none may be bigint.
DO $t$
DECLARE
  v_result   TEXT;
  v_expected TEXT;
  v_types    TEXT;
  v_bigint   TEXT;
BEGIN
  v_result := pg_get_function_result('public.get_product_social_proof(uuid)'::regprocedure);
  v_expected := 'TABLE(product_id uuid, buyer_count integer, wishlist_count integer, share_count integer, circle_buyer_count integer, circle_wishlist_count integer, i_bought_it boolean, i_wishlisted_it boolean, shared_with_me boolean)';

  PERFORM pg_temp.p15_assert(v_result = v_expected,
    format('get_product_social_proof return contract unchanged (expected %s / got %s)', v_expected, v_result));

  CREATE TEMP VIEW p15_gpsp_shape AS
    SELECT * FROM public.get_product_social_proof('b1111111-1111-1111-1111-111111111111') LIMIT 0;

  -- The literal condition 42804 reports, asserted directly rather than inferred
  -- from the string comparison above.
  SELECT string_agg(column_name, ', ')
    INTO v_bigint
    FROM information_schema.columns
   WHERE table_schema LIKE 'pg_temp%' AND table_name = 'p15_gpsp_shape'
     AND data_type = 'bigint';
  PERFORM pg_temp.p15_assert(v_bigint IS NULL,
    format('get_product_social_proof exposes no bigint column (found %s)', COALESCE(v_bigint, 'none')));

  SELECT string_agg(column_name || ' ' || data_type, ', ' ORDER BY ordinal_position)
    INTO v_types
    FROM information_schema.columns
   WHERE table_schema LIKE 'pg_temp%' AND table_name = 'p15_gpsp_shape';

  PERFORM pg_temp.p15_assert(v_types = 'product_id uuid, buyer_count integer, wishlist_count integer, share_count integer, circle_buyer_count integer, circle_wishlist_count integer, i_bought_it boolean, i_wishlisted_it boolean, shared_with_me boolean',
    format('get_product_social_proof runtime column types match (got %s)', v_types));

  -- And the values themselves arrive as integer, not bigint.
  SELECT pg_typeof(buyer_count)::TEXT || '/' ||
         pg_typeof(circle_buyer_count)::TEXT || '/' ||
         pg_typeof(circle_wishlist_count)::TEXT
    INTO v_types
    FROM public.get_product_social_proof('b1111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.p15_assert(v_types = 'integer/integer/integer',
    format('the three previously-bigint counts come back as integer (got %s)', v_types));

  DROP VIEW IF EXISTS p15_gpsp_shape;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.p15_assert(false, 'get_product_social_proof return contract -> ' || SQLERRM);
END;
$t$;

-- ============================================================================
-- SECTION 7 — get_product_social_proof counting rules still hold
-- ============================================================================
DO $t$
DECLARE
  r RECORD;
BEGIN
  -- Signed-out caller: store-wide proof visible, circle counts 0.
  PERFORM pg_temp.p15_anon();
  SELECT * INTO r FROM public.get_product_social_proof('b1111111-1111-1111-1111-111111111111');

  PERFORM pg_temp.p15_assert(r.product_id = 'b1111111-1111-1111-1111-111111111111',
    'social proof echoes the requested product_id');
  PERFORM pg_temp.p15_assert(r.buyer_count = 2,
    format('social proof counts 2 distinct delivered buyers (got %s)', r.buyer_count));
  PERFORM pg_temp.p15_assert(r.wishlist_count = 1,
    format('social proof counts 1 wishlist entry (got %s)', r.wishlist_count));
  PERFORM pg_temp.p15_assert(r.share_count = 0,
    format('social proof counts 0 shares (got %s)', r.share_count));
  PERFORM pg_temp.p15_assert(r.circle_buyer_count = 0,
    format('a signed-out caller gets circle_buyer_count 0, not an error (got %s)', r.circle_buyer_count));
  PERFORM pg_temp.p15_assert(r.circle_wishlist_count = 0,
    format('a signed-out caller gets circle_wishlist_count 0, not an error (got %s)', r.circle_wishlist_count));
  PERFORM pg_temp.p15_assert(r.i_bought_it = false AND r.i_wishlisted_it = false
                             AND r.shared_with_me = false,
    'a signed-out caller gets all three personal flags false');

  -- Only delivered orders count: Zulu has 1 delivered + 1 pending order line
  -- for the same product but must report a single buyer.
  SELECT * INTO r FROM public.get_product_social_proof('b3333333-3333-3333-3333-333333333333');
  PERFORM pg_temp.p15_assert(r.buyer_count = 1,
    format('pending orders are not counted as proof (got %s)', r.buyer_count));

  -- Low engagement is a legitimate answer, not an error.
  SELECT * INTO r FROM public.get_product_social_proof('b4444444-4444-4444-4444-444444444444');
  PERFORM pg_temp.p15_assert(r.buyer_count = 1 AND r.wishlist_count = 0,
    format('a low-engagement product still returns counts (buyers=%s)', r.buyer_count));

  -- NULL is rejected by the function's own guard, and that must be preserved.
  BEGIN
    PERFORM * FROM public.get_product_social_proof(NULL);
    PERFORM pg_temp.p15_assert(false, 'a NULL product_id is rejected');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.p15_assert(SQLERRM = 'A product is required',
      format('a NULL product_id is rejected with the original message (got %s)', SQLERRM));
  END;

  -- Signed-in buyer sees their own flags set.
  PERFORM pg_temp.p15_actor('a1111111-1111-1111-1111-111111111111', 'authenticated');
  SELECT * INTO r FROM public.get_product_social_proof('b1111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.p15_assert(r.i_bought_it = true,
    format('a signed-in buyer sees i_bought_it true (got %s)', r.i_bought_it));
  PERFORM pg_temp.p15_assert(r.i_wishlisted_it = false,
    format('a signed-in non-wishlister sees i_wishlisted_it false (got %s)', r.i_wishlisted_it));

  PERFORM pg_temp.p15_actor('a3333333-3333-3333-3333-333333333333', 'authenticated');
  SELECT * INTO r FROM public.get_product_social_proof('b1111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.p15_assert(r.i_wishlisted_it = true,
    format('a signed-in wisher sees i_wishlisted_it true (got %s)', r.i_wishlisted_it));

  PERFORM pg_temp.p15_anon();
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.p15_assert(false, 'social proof counting rules -> ' || SQLERRM);
END;
$t$;

-- ============================================================================
-- SECTION 8 — signatures, volatility, search_path and grants are unchanged
-- ============================================================================
-- A CREATE OR REPLACE that altered a signature would silently orphan the
-- GRANTs and break every caller's RPC name, so the contract is asserted.
DO $t$
DECLARE
  v_nargs  INTEGER;
  v_def    TEXT;
  v_secdef BOOLEAN;
  v_vol    "char";
  v_spath  TEXT;
  v_ok     BOOLEAN;
BEGIN
  -- get_trending_products(p_limit integer DEFAULT 12)
  SELECT pronargs, pg_get_function_arguments(oid), prosecdef, provolatile, proconfig::TEXT
    INTO v_nargs, v_def, v_secdef, v_vol, v_spath
    FROM pg_proc WHERE oid = 'public.get_trending_products(integer)'::regprocedure;

  PERFORM pg_temp.p15_assert(v_nargs = 1,
    format('get_trending_products still takes exactly 1 argument (got %s)', v_nargs));
  PERFORM pg_temp.p15_assert(v_def = 'p_limit integer DEFAULT 12',
    format('get_trending_products keeps p_limit integer DEFAULT 12 (got %s)', v_def));
  PERFORM pg_temp.p15_assert(v_secdef, 'get_trending_products is still SECURITY DEFINER');
  PERFORM pg_temp.p15_assert(v_vol = 's',
    format('get_trending_products is still STABLE (got %s)', v_vol));
  PERFORM pg_temp.p15_assert(v_spath LIKE '%search_path=public%',
    format('get_trending_products keeps search_path=public (got %s)', v_spath));

  -- get_product_social_proof(p_product_id uuid), no default
  SELECT pronargs, pg_get_function_arguments(oid), prosecdef, provolatile, proconfig::TEXT
    INTO v_nargs, v_def, v_secdef, v_vol, v_spath
    FROM pg_proc WHERE oid = 'public.get_product_social_proof(uuid)'::regprocedure;

  PERFORM pg_temp.p15_assert(v_nargs = 1,
    format('get_product_social_proof still takes exactly 1 argument (got %s)', v_nargs));
  PERFORM pg_temp.p15_assert(v_secdef, 'get_product_social_proof is still SECURITY DEFINER');
  PERFORM pg_temp.p15_assert(v_vol = 's',
    format('get_product_social_proof is still STABLE (got %s)', v_vol));
  PERFORM pg_temp.p15_assert(v_spath LIKE '%search_path=public%',
    format('get_product_social_proof keeps search_path=public (got %s)', v_spath));

  -- anon must keep EXECUTE: the storefront calls both while signed out.
  PERFORM pg_temp.p15_assert(
    has_function_privilege('anon', 'public.get_trending_products(integer)', 'EXECUTE'),
    'anon can still EXECUTE get_trending_products');
  PERFORM pg_temp.p15_assert(
    has_function_privilege('anon', 'public.get_product_social_proof(uuid)', 'EXECUTE'),
    'anon can still EXECUTE get_product_social_proof');
  PERFORM pg_temp.p15_assert(
    has_function_privilege('authenticated', 'public.get_trending_products(integer)', 'EXECUTE'),
    'authenticated can still EXECUTE get_trending_products');
  PERFORM pg_temp.p15_assert(
    has_function_privilege('authenticated', 'public.get_product_social_proof(uuid)', 'EXECUTE'),
    'authenticated can still EXECUTE get_product_social_proof');
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.p15_assert(false, 'function attributes/grants -> ' || SQLERRM);
END;
$t$;

-- ============================================================================
-- Cleanup
-- ============================================================================
DROP VIEW IF EXISTS p15_gtp_shape;
DROP VIEW IF EXISTS p15_gpsp_shape;

TRUNCATE public.referral_codes, public.product_shares, public.wishlist, public.order_items,
         public.orders, public.product_views, public.product_images,
         public.follows, public.friendships, public.profile_blocks,
         public.products, public.profiles RESTART IDENTITY CASCADE;

DELETE FROM auth.users WHERE id IN (
  'a1111111-1111-1111-1111-111111111111',
  'a2222222-2222-2222-2222-222222222222',
  'a3333333-3333-3333-3333-333333333333',
  'a4444444-4444-4444-4444-444444444444');

DROP FUNCTION IF EXISTS pg_temp.p15_actor(uuid, text);
DROP FUNCTION IF EXISTS pg_temp.p15_anon();
DROP FUNCTION IF EXISTS pg_temp.p15_assert(boolean, text);