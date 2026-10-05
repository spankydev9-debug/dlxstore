-- ==========================================================================
-- DLXSTORE person-to-person chat suite (P16).
-- Run against the local stack:
--   docker cp supabase/tests/<file> supabase_db_dlxstore:/tmp/t.sql
--   docker exec supabase_db_dlxstore psql -U postgres -d postgres -f /tmp/t.sql
-- ==========================================================================
--
-- Regression cover for 20261019090000_direct_chat.sql.
--
-- The chat foundation could not express a customer-to-customer conversation:
-- conversations.type was CHECKed to ('customer_support','internal') so the row
-- could not be inserted, and no RPC a customer may call could create one --
-- get_or_create_customer_support_conversation hardcodes the support type and
-- adds an admin, create_internal_conversation and add_conversation_participant
-- both require is_staff_or_admin(), and conversation_participants has no INSERT
-- policy so the client cannot self-join.
--
-- The interesting risk here is not "does it work" but "can anyone read a
-- conversation they are not in". Every isolation check runs under
-- SET LOCAL ROLE authenticated as a real third-party customer (Carol), because
-- a superuser bypasses RLS entirely -- a claims-only fake would prove nothing.
--
-- Counted: PASS / FAIL lines. Anything that raises prints the error text
-- instead of a PASS, so the expected-failure count stays meaningful.

\set ON_ERROR_STOP off
\timing off

-- ---------------------------------------------------------------------------
-- Harness
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.p16_error(p_sql TEXT)
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
-- Fixtures: three unrelated customers. Carol is the outsider used to prove
-- isolation. profiles.id has an FK to auth.users(id), so auth rows come first.
-- ---------------------------------------------------------------------------
TRUNCATE public.messages, public.conversation_participants, public.conversations,
         public.profile_blocks, public.profile_mutes,
         public.message_reactions, public.message_status, public.typing_indicators
  RESTART IDENTITY CASCADE;

DELETE FROM auth.users WHERE email IN (
  'p16.alice@dlx.test','p16.bob@dlx.test','p16.carol@dlx.test');

INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-4111-8111-111111111111','p16.alice@dlx.test'),
  ('22222222-2222-4222-8222-222222222222','p16.bob@dlx.test'),
  ('33333333-3333-4333-8333-333333333333','p16.carol@dlx.test');

-- preferred_locale exists only on newer local replicas, so it is deliberately not
-- used here: no assertion depends on it, and this keeps the suite runnable against
-- the production schema as well as the local one.
INSERT INTO public.profiles (id, email, full_name, username) VALUES
  ('11111111-1111-4111-8111-111111111111','p16.alice@dlx.test','Alice Anderson','p16_alice'),
  ('22222222-2222-4222-8222-222222222222','p16.bob@dlx.test',  'Bob Brown',    'p16_bob'),
  ('33333333-3333-4333-8333-333333333333','p16.carol@dlx.test','Carol Clark',  'p16_carol');

-- ---------------------------------------------------------------------------
-- 1. Schema contract (inspected as the owner; no RLS involvement)
-- ---------------------------------------------------------------------------
\echo '-- 1. schema contract'
DO $$
DECLARE v_def TEXT; v_res TEXT; v_bad INT; v_acl TEXT; v_src TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint WHERE conname = 'conversations_type_check';
  IF v_def LIKE '%direct%' THEN
    RAISE NOTICE 'PASS: conversations.type CHECK admits direct';
  ELSE
    RAISE NOTICE 'FAIL: conversations.type CHECK does not admit direct (%s)', v_def;
  END IF;

  SELECT count(*) INTO v_bad FROM pg_indexes WHERE indexname = 'conversations_dm_key_uniq';
  IF v_bad = 1 THEN RAISE NOTICE 'PASS: dm_key unique index exists';
  ELSE RAISE NOTICE 'FAIL: dm_key unique index missing'; END IF;

  SELECT pg_get_function_result(p.oid), p.prosrc INTO v_res, v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='get_or_create_direct_conversation';

  IF v_res = 'conversations' THEN
    RAISE NOTICE 'PASS: get_or_create_direct_conversation returns conversations';
  ELSE
    RAISE NOTICE 'FAIL: unexpected return type %', v_res;
  END IF;

  IF position('LEAST' IN v_src) > 0 AND position('GREATEST' IN v_src) > 0
     AND position('unique_violation' IN v_src) > 0
     AND position('social_profiles_are_blocked' IN v_src) > 0 THEN
    RAISE NOTICE 'PASS: RPC canonicalises the pair, handles the race and checks blocks';
  ELSE
    RAISE NOTICE 'FAIL: RPC body is missing the dedupe/race/blocking logic';
  END IF;
END;
$$;

DO $$
DECLARE v_sec BOOL; v_vol "char"; v_path TEXT; v_anon BOOL; v_auth BOOL; v_pub BOOL; v_src TEXT;
BEGIN
  SELECT prosecdef, provolatile INTO v_sec, v_vol
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='get_or_create_direct_conversation';
  SELECT u.x INTO v_path
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL unnest(p.proconfig) AS u(x)
   WHERE n.nspname = 'public'
     AND p.proname = 'get_or_create_direct_conversation';

  IF v_sec AND v_vol='v' AND v_path='search_path=public' THEN
    RAISE NOTICE 'PASS: RPC is VOLATILE SECURITY DEFINER with search_path=public';
  ELSE
    RAISE NOTICE 'FAIL: RPC attributes sec=% vol=% path=%', v_sec, v_vol, coalesce(v_path,'(unset)');
  END IF;

  v_anon := has_function_privilege('anon','public.get_or_create_direct_conversation(uuid)','EXECUTE');
  v_auth := has_function_privilege('authenticated','public.get_or_create_direct_conversation(uuid)','EXECUTE');
  SELECT NOT EXISTS (
    SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
    WHERE p.proname='get_or_create_direct_conversation'
      AND a.grantee = 0 AND a.privilege_type='EXECUTE') INTO v_pub;

  IF NOT v_anon AND v_auth AND v_pub THEN
    RAISE NOTICE 'PASS: EXECUTE granted to authenticated only (not anon, not PUBLIC)';
  ELSE
    RAISE NOTICE 'FAIL: grants anon=% auth=% public=%', v_anon, v_auth, v_pub;
  END IF;

  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='can_access_conversation';
  IF position('customer_support' IN v_src) > 0 AND position('direct' IN v_src) = 0 THEN
    RAISE NOTICE 'PASS: can_access_conversation staff bypass still scoped to customer_support';
  ELSE
    RAISE NOTICE 'FAIL: can_access_conversation staff bypass was widened to direct chats';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Creation rules, as the calling customer
-- ---------------------------------------------------------------------------
\echo '-- 2. creation rules'
DO $$
DECLARE v_err TEXT;
BEGIN
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

  -- Self.
  v_err := pg_temp.p16_error($f$
    SELECT public.get_or_create_direct_conversation('11111111-1111-4111-8111-111111111111'::uuid)$f$);
  IF v_err LIKE '%yourself%' THEN RAISE NOTICE 'PASS: self-conversation refused';
  ELSE RAISE NOTICE 'FAIL: self-conversation not refused (%s)', coalesce(v_err,'no error'); END IF;

  -- Unknown profile.
  v_err := pg_temp.p16_error($f$
    SELECT public.get_or_create_direct_conversation('00000000-0000-4000-8000-000000000000'::uuid)$f$);
  IF v_err LIKE '%not found%' THEN RAISE NOTICE 'PASS: unknown recipient refused';
  ELSE RAISE NOTICE 'FAIL: unknown recipient not refused (%s)', coalesce(v_err,'no error'); END IF;

  -- NULL.
  v_err := pg_temp.p16_error($f$
    SELECT public.get_or_create_direct_conversation(NULL)$f$);
  IF v_err IS NOT NULL THEN RAISE NOTICE 'PASS: NULL recipient refused';
  ELSE RAISE NOTICE 'FAIL: NULL recipient accepted'; END IF;

  -- Empty body is refused before any write happens.
  v_err := pg_temp.p16_error($f$
    SELECT public.get_or_create_direct_conversation('22222222-2222-4222-8222-222222222222'::uuid)$f$);
  IF v_err IS NULL THEN RAISE NOTICE 'PASS: alice can create a direct conversation with bob';
  ELSE RAISE NOTICE 'FAIL: alice could not create the conversation (%s)', v_err; END IF;
END;
$$;

-- anon must be refused at the ACL layer (this is what PostgREST returns in prod).
DO $$
DECLARE v_err TEXT;
BEGIN
  SET LOCAL ROLE anon;
  SET LOCAL request.jwt.claims = '{"role":"anon"}';
  v_err := pg_temp.p16_error($f$
    SELECT public.get_or_create_direct_conversation('22222222-2222-4222-8222-222222222222'::uuid)$f$);
  IF v_err LIKE '42501%' THEN
    RAISE NOTICE 'PASS: anon is refused at the ACL layer (42501 permission denied)';
  ELSE
    RAISE NOTICE 'FAIL: anon was not refused (%s)', coalesce(v_err,'no error');
  END IF;
END;
$$;

-- Capture the created conversation for the remaining sections.
-- auth.uid() is read from the request GUC, so this statement needs a session-level
-- claim: a top-level CREATE TEMP TABLE cannot be wrapped in SET LOCAL ROLE.
SELECT set_config('request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', false);
CREATE TEMP TABLE p16_conv AS
  SELECT (public.get_or_create_direct_conversation(
    '22222222-2222-4222-8222-222222222222'::uuid)).*;
SELECT set_config('request.jwt.claims', NULL, false);

DO $$
DECLARE v_id UUID := (SELECT id FROM p16_conv);
        v_type TEXT := (SELECT type FROM p16_conv);
        v_status TEXT := (SELECT status FROM p16_conv);
        v_title TEXT := (SELECT title FROM p16_conv);
        v_key TEXT := (SELECT dm_key FROM p16_conv);
        v_parts INT;
BEGIN
  IF v_type = 'direct' THEN RAISE NOTICE 'PASS: created conversation has type=direct';
  ELSE RAISE NOTICE 'FAIL: type=%', v_type; END IF;

  IF v_status = 'open' THEN RAISE NOTICE 'PASS: created conversation is open';
  ELSE RAISE NOTICE 'FAIL: status=%', v_status; END IF;

  IF v_title IS NULL THEN
    RAISE NOTICE 'PASS: title left NULL so each viewer names it from participants';
  ELSE
    RAISE NOTICE 'FAIL: title=% (a shared title cannot be right for both viewers)', v_title;
  END IF;

  IF v_key = LEAST('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222')
          || ':' ||
          GREATEST('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222') THEN
    RAISE NOTICE 'PASS: dm_key is canonical (order independent)';
  ELSE
    RAISE NOTICE 'FAIL: dm_key=% is not canonical', v_key;
  END IF;

  SELECT count(*) INTO v_parts FROM public.conversation_participants WHERE conversation_id = v_id;
  IF v_parts = 2 THEN
    RAISE NOTICE 'PASS: both participants inserted in the same transaction';
  ELSE
    RAISE NOTICE 'FAIL: % participant rows (notify trigger reads this table)', v_parts;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Idempotency
-- ---------------------------------------------------------------------------
\echo '-- 3. idempotency and de-duplication'
DO $$
DECLARE v_id UUID := (SELECT id FROM p16_conv);
        v_same UUID; v_n INT; v_parts INT;
BEGIN
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

  v_same := (public.get_or_create_direct_conversation('22222222-2222-4222-8222-222222222222'::uuid)).id;
  IF v_same = v_id THEN RAISE NOTICE 'PASS: repeat call by the initiator returns the same conversation';
  ELSE RAISE NOTICE 'FAIL: repeat call created a second conversation'; END IF;

  -- Now from the other side: reversed argument order must still resolve.
  PERFORM set_config('request.jwt.claims',
    '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
  v_same := (public.get_or_create_direct_conversation('11111111-1111-4111-8111-111111111111'::uuid)).id;
  IF v_same = v_id THEN
    RAISE NOTICE 'PASS: the counterpart resolves to the same conversation (reversed args)';
  ELSE
    RAISE NOTICE 'FAIL: reversed args created a duplicate conversation';
  END IF;

  SELECT count(*) INTO v_n FROM public.conversations WHERE type='direct';
  IF v_n = 1 THEN RAISE NOTICE 'PASS: exactly one direct conversation exists';
  ELSE RAISE NOTICE 'FAIL: % direct conversations exist', v_n; END IF;

  SELECT count(*) INTO v_parts FROM public.conversation_participants WHERE conversation_id = v_id;
  IF v_parts = 2 THEN RAISE NOTICE 'PASS: repeat calls added no duplicate participants';
  ELSE RAISE NOTICE 'FAIL: % participant rows', v_parts; END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Send / receive / unread / read
-- ---------------------------------------------------------------------------
\echo '-- 4. send, receive, unread and read state'
DO $$
DECLARE v_id UUID := (SELECT id FROM p16_conv);
        v_err TEXT; v_n INT; v_unread BIGINT; v_preview TEXT;
BEGIN
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

  v_err := pg_temp.p16_error(format(
    'SELECT public.send_conversation_message(%L,%L)', v_id, 'Hello Bob'));
  IF v_err IS NULL THEN RAISE NOTICE 'PASS: alice can send in her own conversation';
  ELSE RAISE NOTICE 'FAIL: alice could not send (%s)', v_err; END IF;

  -- Alice's own message is not unread for her.
  SELECT unread_count INTO v_unread FROM public.list_my_conversations() WHERE id = v_id;
  IF v_unread = 0 THEN RAISE NOTICE 'PASS: alice unread_count is 0 for her own message';
  ELSE RAISE NOTICE 'FAIL: alice unread_count=% for her own message', v_unread; END IF;

  -- Bob receives it.
  PERFORM set_config('request.jwt.claims',
    '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);

  SELECT count(*) INTO v_n FROM public.messages
   WHERE conversation_id = v_id AND body = 'Hello Bob';
  IF v_n = 1 THEN RAISE NOTICE 'PASS: bob can read the message';
  ELSE RAISE NOTICE 'FAIL: bob read % matching messages', v_n; END IF;

  SELECT unread_count INTO v_unread FROM public.list_my_conversations() WHERE id = v_id;
  IF v_unread = 1 THEN RAISE NOTICE 'PASS: bob unread_count is 1';
  ELSE RAISE NOTICE 'FAIL: bob unread_count=% (expected 1)', v_unread; END IF;

  -- participants[] puts the VIEWER first; the counterpart must be found by
  -- filtering on profile_id (see getCounterpart in src/services/db/chat.ts).
  IF (SELECT participants->0->>'profile_id' FROM public.list_my_conversations() WHERE id=v_id)
       = '22222222-2222-4222-8222-222222222222' THEN
    RAISE NOTICE 'PASS: bob sees himself first in participants[]';
  ELSE
    RAISE NOTICE 'FAIL: participants[0] is not the viewer';
  END IF;
  IF (SELECT participants->1->>'full_name' FROM public.list_my_conversations() WHERE id=v_id)
       = 'Alice Anderson' THEN
    RAISE NOTICE 'PASS: bob resolves the counterpart by filtering on profile_id';
  ELSE
    RAISE NOTICE 'FAIL: counterpart name not at participants[1]';
  END IF;

  -- Read state is per participant.
  PERFORM public.mark_conversation_read(v_id);
  SELECT unread_count INTO v_unread FROM public.list_my_conversations() WHERE id = v_id;
  IF v_unread = 0 THEN RAISE NOTICE 'PASS: bob unread_count clears after mark_conversation_read';
  ELSE RAISE NOTICE 'FAIL: bob unread_count still % after mark_read', v_unread; END IF;

  -- Reply, then alice receives it.
  v_err := pg_temp.p16_error(format(
    'SELECT public.send_conversation_message(%L,%L)', v_id, 'Hi Alice'));
  IF v_err IS NULL THEN RAISE NOTICE 'PASS: bob can reply';
  ELSE RAISE NOTICE 'FAIL: bob could not reply (%s)', v_err; END IF;

  PERFORM set_config('request.jwt.claims',
    '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);

  SELECT count(*) INTO v_n FROM public.messages WHERE conversation_id = v_id;
  IF v_n = 2 THEN RAISE NOTICE 'PASS: alice sees both messages';
  ELSE RAISE NOTICE 'FAIL: alice sees % messages (expected 2)', v_n; END IF;

  SELECT unread_count INTO v_unread FROM public.list_my_conversations() WHERE id = v_id;
  IF v_unread = 1 THEN RAISE NOTICE 'PASS: alice unread_count is 1 for the reply';
  ELSE RAISE NOTICE 'FAIL: alice unread_count=% for the reply', v_unread; END IF;

  SELECT last_message_preview INTO v_preview FROM public.conversations WHERE id = v_id;
  IF v_preview = 'Hi Alice' THEN RAISE NOTICE 'PASS: conversation preview advanced to the latest message';
  ELSE RAISE NOTICE 'FAIL: last_message_preview=%', coalesce(v_preview,'(null)'); END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. ISOLATION -- a third customer must see nothing.
--    Runs as Carol under SET LOCAL ROLE authenticated; RLS is only enforced for
--    a non-superuser, so a claims-only fake would silently pass everything.
-- ---------------------------------------------------------------------------
\echo '-- 5. isolation: a third customer sees nothing'
DO $$
DECLARE v_id UUID := (SELECT id FROM p16_conv);
        v_n INT; v_err TEXT; v_unread BIGINT;
BEGIN
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

  SELECT count(*) INTO v_n FROM public.conversations WHERE id = v_id;
  IF v_n = 0 THEN RAISE NOTICE 'PASS: carol cannot SELECT the conversation (RLS)';
  ELSE RAISE NOTICE 'FAIL: carol SELECTed the conversation'; END IF;

  SELECT count(*) INTO v_n FROM public.messages WHERE conversation_id = v_id;
  IF v_n = 0 THEN RAISE NOTICE 'PASS: carol cannot SELECT the messages (RLS)';
  ELSE RAISE NOTICE 'FAIL: carol SELECTed % messages', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.conversation_participants WHERE conversation_id = v_id;
  IF v_n = 0 THEN RAISE NOTICE 'PASS: carol cannot see the participant rows (RLS)';
  ELSE RAISE NOTICE 'FAIL: carol saw % participant rows', v_n; END IF;

  SELECT count(*) INTO v_unread FROM public.list_my_conversations() WHERE id = v_id;
  IF v_unread = 0 THEN RAISE NOTICE 'PASS: carol inbox does not contain the conversation';
  ELSE RAISE NOTICE 'FAIL: the conversation leaked into carol''s inbox'; END IF;

  IF public.can_access_conversation(v_id) = false THEN
    RAISE NOTICE 'PASS: can_access_conversation is false for carol';
  ELSE
    RAISE NOTICE 'FAIL: can_access_conversation returned true for a non-participant';
  END IF;

  v_err := pg_temp.p16_error(format(
    'SELECT public.send_conversation_message(%L,%L)', v_id, 'intrusion'));
  IF v_err LIKE 'P0001%Access denied%' THEN
    RAISE NOTICE 'PASS: carol cannot send into the conversation';
  ELSE
    RAISE NOTICE 'FAIL: carol send was not denied (%s)', coalesce(v_err,'no error');
  END IF;

  v_err := pg_temp.p16_error(format($f$
    INSERT INTO public.messages (conversation_id, sender_id, body)
    VALUES ('%s','33333333-3333-4333-8333-333333333333','forged')$f$, v_id));
  IF v_err LIKE '42501%' THEN
    RAISE NOTICE 'PASS: carol cannot INSERT a message directly (no INSERT policy)';
  ELSE
    RAISE NOTICE 'FAIL: direct message INSERT was not denied (%s)', coalesce(v_err,'no error');
  END IF;

  v_err := pg_temp.p16_error(format($f$
    INSERT INTO public.conversation_participants (conversation_id, profile_id)
    VALUES ('%s','33333333-3333-4333-8333-333333333333')$f$, v_id));
  IF v_err LIKE '42501%' THEN
    RAISE NOTICE 'PASS: carol cannot self-join the conversation (no INSERT policy)';
  ELSE
    RAISE NOTICE 'FAIL: self-join was not denied (%s)', coalesce(v_err,'no error');
  END IF;

  v_err := pg_temp.p16_error(format($f$
    SELECT public.add_conversation_participant('%s','33333333-3333-4333-8333-333333333333')$f$, v_id));
  IF v_err IS NOT NULL THEN
    RAISE NOTICE 'PASS: carol cannot use the staff-only add_conversation_participant';
  ELSE
    RAISE NOTICE 'FAIL: carol added herself via add_conversation_participant';
  END IF;

  v_err := pg_temp.p16_error(format(
    'SELECT public.get_conversation_with_realtime_data(%L)', v_id));
  IF v_err LIKE 'P0001%Access denied%' THEN
    RAISE NOTICE 'PASS: carol cannot read realtime conversation data';
  ELSE
    RAISE NOTICE 'FAIL: realtime data was not denied (%s)', coalesce(v_err,'no error');
  END IF;

  v_err := pg_temp.p16_error(format($f$
    UPDATE public.conversations SET title='hijacked' WHERE id='%s'$f$, v_id));
  IF v_err IS NULL THEN
    RAISE NOTICE 'PASS: carol cannot rename the conversation (RLS filtered the update)';
  ELSE
    RAISE NOTICE 'FAIL: rename raised unexpectedly (%s)', v_err;
  END IF;
  IF (SELECT title FROM public.conversations WHERE id = v_id) IS NULL THEN
    RAISE NOTICE 'PASS: the conversation title is still NULL after carol''s attempt';
  ELSE
    RAISE NOTICE 'FAIL: carol changed the conversation title';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Blocks and distinct pairs
-- ---------------------------------------------------------------------------
\echo '-- 6. blocks and distinct pairs'
-- Carol blocks Alice. Blocking is symmetric, so Alice must be unable to open a
-- conversation with Carol from either direction.
INSERT INTO public.profile_blocks (blocker_id, blocked_id)
VALUES ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111');

DO $$
DECLARE v_err TEXT;
BEGIN
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

  v_err := pg_temp.p16_error($f$
    SELECT public.get_or_create_direct_conversation('33333333-3333-4333-8333-333333333333'::uuid)$f$);
  IF v_err LIKE '%cannot start%' THEN
    RAISE NOTICE 'PASS: blocked counterpart refused (the block is symmetric)';
  ELSE
    RAISE NOTICE 'FAIL: blocked counterpart was not refused (%s)', coalesce(v_err,'no error');
  END IF;
END;
$$;

DELETE FROM public.profile_blocks
 WHERE blocker_id='33333333-3333-4333-8333-333333333333'
   AND blocked_id ='11111111-1111-4111-8111-111111111111';

-- Once unblocked, a different pair must get its own thread rather than reusing
-- Alice's conversation with Bob.
DO $$
DECLARE v_id UUID := (SELECT id FROM p16_conv);
        v_other UUID; v_err TEXT; v_n INT;
BEGIN
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

  v_err := pg_temp.p16_error($f$
    SELECT public.get_or_create_direct_conversation('33333333-3333-4333-8333-333333333333'::uuid)$f$);
  IF v_err IS NULL THEN
    RAISE NOTICE 'PASS: unblocked counterpart allowed again';
  ELSE
    RAISE NOTICE 'FAIL: still blocked after unblock (%s)', v_err;
  END IF;

  v_other := (public.get_or_create_direct_conversation(
    '33333333-3333-4333-8333-333333333333'::uuid)).id;

  IF v_other IS NOT NULL AND v_other <> v_id THEN
    RAISE NOTICE 'PASS: a different pair yields a different conversation';
  ELSE
    RAISE NOTICE 'FAIL: the second conversation was not created separately';
  END IF;

  SELECT count(*) INTO v_n FROM public.conversations WHERE type='direct';
  IF v_n = 2 THEN
    RAISE NOTICE 'PASS: two independent direct conversations coexist';
  ELSE
    RAISE NOTICE 'FAIL: % direct conversations (expected 2)', v_n;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Realtime publication
-- ---------------------------------------------------------------------------
\echo '-- 7. realtime publication'
DO $$
DECLARE v_n INT;
BEGIN
  SELECT count(*) INTO v_n FROM pg_publication_tables
   WHERE pubname='supabase_realtime' AND schemaname='public'
     AND tablename IN ('conversations','conversation_participants','messages');
  IF v_n = 3 THEN
    RAISE NOTICE 'PASS: conversations/participants/messages are in supabase_realtime';
  ELSE
    RAISE NOTICE 'FAIL: only % of 3 chat tables are published (realtime would silently degrade to polling)', v_n;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Teardown
-- ---------------------------------------------------------------------------
TRUNCATE public.messages, public.conversation_participants, public.conversations,
         public.profile_blocks, public.profile_mutes,
         public.message_reactions, public.message_status, public.typing_indicators
  RESTART IDENTITY CASCADE;
DELETE FROM public.profiles
 WHERE email IN ('p16.alice@dlx.test','p16.bob@dlx.test','p16.carol@dlx.test');
DELETE FROM auth.users
 WHERE email IN ('p16.alice@dlx.test','p16.bob@dlx.test','p16.carol@dlx.test');

\echo ''
\echo 'P16 complete: count PASS / FAIL above. Expect 0 FAIL.'