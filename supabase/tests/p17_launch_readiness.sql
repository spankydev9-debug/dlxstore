-- ==========================================================================
-- DLXSTORE launch-readiness regression suite (P17).
-- Run against the local stack:
--   docker cp supabase/tests/p17_launch_readiness.sql supabase_db_dlxstore:/tmp/p17.sql
--   docker exec supabase_db_dlxstore psql -U postgres -d postgres -f /tmp/p17.sql
-- ==========================================================================
--
-- Regression cover for two production launch bugs:
--
--   * 20261024090000_storefront_anon_authorization_fix.sql
--       The seller-AI RLS migration (20261022090000) added SELECT policies on
--       public.products / public.product_images whose USING clause called
--       public.can_manage_ai_product(), a function granted ONLY to
--       `authenticated`.  Anonymous visitors evaluating the policy raised
--       `42501 permission denied for function can_manage_ai_product`, so the
--       whole storefront failed to load ("La boutique est indisponible").
--       The fix scopes the seller policies to `authenticated`; anonymous reads
--       then fall through to the public-read policies.
--
--   * 20261025090000_send_message_media_coercion.sql
--       Clients passed p_media = JSON.stringify(items) (a JSON *string*), so
--       jsonb_array_elements() raised
--       `22023 cannot extract elements from a scalar` whenever a photo was sent
--       with a caption.  The RPC now coerces a JSON string and only iterates a
--       real array.
--
-- Counted: PASS / FAIL lines. Assertions that raise print the error text instead
-- of a PASS so the expected-failure count stays meaningful.

\set ON_ERROR_STOP off
\timing off

CREATE OR REPLACE FUNCTION pg_temp.p17_error(p_sql TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v_msg TEXT;
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
TRUNCATE public.message_media, public.messages, public.conversation_participants,
         public.conversations
  RESTART IDENTITY CASCADE;

DELETE FROM auth.users WHERE email IN ('p17.alice@dlx.test','p17.bob@dlx.test');

INSERT INTO auth.users (id, email) VALUES
  ('17171717-1717-4171-8171-171717171717','p17.alice@dlx.test'),
  ('27272727-2727-4272-8272-272727272727','p17.bob@dlx.test');

INSERT INTO public.profiles (id, email, full_name, username) VALUES
  ('17171717-1717-4171-8171-171717171717','p17.alice@dlx.test','Alice P17','p17_alice'),
  ('27272727-2727-4272-8272-272727272727','p17.bob@dlx.test',  'Bob P17',  'p17_bob');

-- A visible, in-stock product so the anonymous read path returns a row rather
-- than an empty (and therefore inconclusive) result.
DELETE FROM public.products WHERE sku = 'P17-VISIBLE';
INSERT INTO public.products (id, name, slug, description, price, brand, sku, is_active, is_archived, stock_quantity)
VALUES ('17171717-0000-4000-8000-000000000001','P17 Visible Tee','p17-visible-tee',
        'A product that anonymous visitors must be able to read.', 25.00, 'P17 Brand', 'P17-VISIBLE',
        true, false, 10);

DELETE FROM public.product_images WHERE product_id = '17171717-0000-4000-8000-000000000001';
INSERT INTO public.product_images (product_id, image_url, is_primary)
VALUES ('17171717-0000-4000-8000-000000000001','products/p17/tee.jpg', true);

-- ---------------------------------------------------------------------------
-- 1. Seller policies are scoped to `authenticated` (the root cause of the
--    anonymous storefront outage: a policy visible to PUBLIC called a function
--    that PUBLIC could not execute).
-- ---------------------------------------------------------------------------
\echo '-- 1. seller policies scoped to authenticated'
DO $$
DECLARE v_roles TEXT;
BEGIN
  SELECT roles::text INTO v_roles FROM pg_policies
   WHERE schemaname='public' AND tablename='products'
     AND policyname='Sellers read own products for AI workflows';
  IF v_roles = '{authenticated}' THEN
    RAISE NOTICE 'PASS: products seller policy applies to authenticated only';
  ELSE
    RAISE NOTICE 'FAIL: products seller policy roles=% (expected {authenticated})', coalesce(v_roles,'(none)');
  END IF;

  SELECT roles::text INTO v_roles FROM pg_policies
   WHERE schemaname='public' AND tablename='product_images'
     AND policyname='Sellers read own product images for AI workflows';
  IF v_roles = '{authenticated}' THEN
    RAISE NOTICE 'PASS: product_images seller policy applies to authenticated only';
  ELSE
    RAISE NOTICE 'FAIL: product_images seller policy roles=% (expected {authenticated})', coalesce(v_roles,'(none)');
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Anonymous read of the catalogue (RLS enforced: run as role anon).
--    Before the fix this raised 42501 permission denied for function
--    can_manage_ai_product; now it must succeed.
-- ---------------------------------------------------------------------------
\echo '-- 2. anonymous catalogue reads'
DO $$
DECLARE v_err TEXT; v_n INT;
BEGIN
  SET LOCAL ROLE anon;
  SET LOCAL request.jwt.claims = '{"role":"anon"}';

  v_err := pg_temp.p17_error($f$
    SELECT count(*) FROM public.products WHERE id = '17171717-0000-4000-8000-000000000001'$f$);
  IF v_err IS NULL THEN
    RAISE NOTICE 'PASS: anon can SELECT products without a permission error';
  ELSE
    RAISE NOTICE 'FAIL: anon product SELECT raised (%s)', v_err;
  END IF;

  SELECT count(*) INTO v_n FROM public.products WHERE id = '17171717-0000-4000-8000-000000000001';
  IF v_n = 1 THEN
    RAISE NOTICE 'PASS: anon sees the visible product via the public-read policy';
  ELSE
    RAISE NOTICE 'FAIL: anon saw % rows (expected the visible product)', v_n;
  END IF;

  v_err := pg_temp.p17_error($f$
    SELECT count(*) FROM public.product_images WHERE product_id = '17171717-0000-4000-8000-000000000001'$f$);
  IF v_err IS NULL THEN
    RAISE NOTICE 'PASS: anon can SELECT product_images without a permission error';
  ELSE
    RAISE NOTICE 'FAIL: anon product_images SELECT raised (%s)', v_err;
  END IF;

  SELECT count(*) INTO v_n FROM public.product_images WHERE product_id = '17171717-0000-4000-8000-000000000001';
  IF v_n = 1 THEN
    RAISE NOTICE 'PASS: anon sees the image of a visible product';
  ELSE
    RAISE NOTICE 'FAIL: anon saw % images (expected 1)', v_n;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. send_conversation_message_v2 media handling (authenticated participant).
--    Reproduces the "cannot extract elements from a scalar" crash and proves
--    both the legacy string form and the array form work.
-- ---------------------------------------------------------------------------
-- Build the conversation as Alice (auth.uid() comes from the request claim).
SELECT set_config('request.jwt.claims',
  '{"sub":"17171717-1717-4171-8171-171717171717","role":"authenticated"}', false);
CREATE TEMP TABLE p17_conv AS
  SELECT (public.get_or_create_direct_conversation(
    '27272727-2727-4272-8272-272727272727'::uuid)).*;
SELECT set_config('request.jwt.claims', NULL, false);

\echo '-- 3. media coercion in send_conversation_message_v2'
DO $$
DECLARE
  v_id UUID := (SELECT id FROM p17_conv);
  v_err TEXT;
  v_n INT;
  v_legacy TEXT;
BEGIN
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"17171717-1717-4171-8171-171717171717","role":"authenticated"}';

  -- 3a. Legacy client: p_media is a JSON *string* encoding an array. This is the
  --     exact shape that used to crash (jsonb_array_elements on a scalar).
  v_legacy := jsonb_build_array(
    jsonb_build_object('media_type','image','file_url', 'chat-media/'||v_id||'/photo.jpg')
  )::text;  -- a text value that is itself JSON

  v_err := pg_temp.p17_error(format(
    'SELECT public.send_conversation_message_v2(%L, %L, %L::jsonb)',
    v_id, 'Legacy caption', v_legacy));
  IF v_err IS NULL THEN
    RAISE NOTICE 'PASS: stringified media (legacy client) no longer crashes the RPC';
  ELSE
    RAISE NOTICE 'FAIL: stringified media raised (%s)', v_err;
  END IF;

  SELECT count(*) INTO v_n FROM public.message_media
   WHERE file_url = 'chat-media/'||v_id||'/photo.jpg';
  IF v_n = 1 THEN
    RAISE NOTICE 'PASS: legacy stringified media is coerced and attached';
  ELSE
    RAISE NOTICE 'FAIL: legacy media attachment count=% (expected 1)', v_n;
  END IF;

  -- 3b. Current client: a real JSON array.
  v_err := pg_temp.p17_error(format(
    $f$SELECT public.send_conversation_message_v2(%L, %L, %L::jsonb)$f$,
    v_id, 'Array caption',
    jsonb_build_array(jsonb_build_object('media_type','image','file_url','chat-media/'||v_id||'/photo2.jpg'))::text));
  IF v_err IS NULL THEN
    RAISE NOTICE 'PASS: real JSON array media is accepted';
  ELSE
    RAISE NOTICE 'FAIL: array media raised (%s)', v_err;
  END IF;

  SELECT count(*) INTO v_n FROM public.message_media
   WHERE file_url = 'chat-media/'||v_id||'/photo2.jpg';
  IF v_n = 1 THEN
    RAISE NOTICE 'PASS: array media is attached';
  ELSE
    RAISE NOTICE 'FAIL: array media attachment count=% (expected 1)', v_n;
  END IF;

  -- 3c. A bare scalar string must be ignored, never crash the send.
  v_err := pg_temp.p17_error(format(
    'SELECT public.send_conversation_message_v2(%L, %L, %L::jsonb)',
    v_id, 'Junk caption', '"not-an-array"'));
  IF v_err IS NULL THEN
    RAISE NOTICE 'PASS: scalar media is ignored instead of raising 22023';
  ELSE
    RAISE NOTICE 'FAIL: scalar media raised (%s)', v_err;
  END IF;

  -- 3d. Media from another conversation's folder must still be refused.
  v_err := pg_temp.p17_error(format(
    $f$SELECT public.send_conversation_message_v2(%L, %L, %L::jsonb)$f$,
    v_id, 'Cross-conversation',
    jsonb_build_array(jsonb_build_object('media_type','image','file_url','chat-media/00000000-0000-4000-8000-000000000000/x.jpg'))::text));
  IF v_err LIKE '%does not belong%' THEN
    RAISE NOTICE 'PASS: media from another conversation is still refused';
  ELSE
    RAISE NOTICE 'FAIL: cross-conversation media was not refused (%s)', coalesce(v_err,'no error');
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Teardown
-- ---------------------------------------------------------------------------
TRUNCATE public.message_media, public.messages, public.conversation_participants,
         public.conversations
  RESTART IDENTITY CASCADE;
DELETE FROM public.product_images WHERE product_id = '17171717-0000-4000-8000-000000000001';
DELETE FROM public.products WHERE sku = 'P17-VISIBLE';
DELETE FROM public.profiles WHERE email IN ('p17.alice@dlx.test','p17.bob@dlx.test');
DELETE FROM auth.users WHERE email IN ('p17.alice@dlx.test','p17.bob@dlx.test');

\echo ''
\echo 'P17 complete: count PASS / FAIL above. Expect 0 FAIL.'
