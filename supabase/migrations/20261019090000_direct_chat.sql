-- =============================================================================
-- 20261019090000_direct_chat.sql
-- Person-to-person (1-to-1) direct messaging.
--
-- Why this migration exists
-- ------------------------
-- The chat foundation (20260829080000 + the realtime features migration) is
-- complete and fully supports customer <-> staff and staff <-> staff chat. It
-- cannot express a customer <-> customer conversation:
--
--   1. conversations.type is CHECKed to ('customer_support','internal'), so a
--      direct conversation row cannot even be inserted.
--   2. There is no RPC a customer may call to create a conversation with
--      another customer:
--        - get_or_create_customer_support_conversation hardcodes
--          type='customer_support' and always inserts an admin participant.
--        - create_internal_conversation and add_conversation_participant both
--          require is_staff_or_admin().
--      conversation_participants has no INSERT policy, so the client cannot
--      self-join either.
--
-- Everything else the feature needs already works and is deliberately reused
-- rather than reimplemented:
--   - list_my_conversations()      (no type filter; keys off participation)
--   - send_conversation_message_v2() (keys off can_access_conversation)
--   - mark_conversation_read() / mark_conversation_delivered()
--   - set_typing_status()
--   - get_conversation_with_realtime_data()
--   - search_profiles()            (already excludes self and blocked users)
--   - the SELECT-only RLS policies on conversations / conversation_participants
--     / messages, which route every mutation through SECURITY DEFINER RPCs.
--
-- can_access_conversation() is NOT modified: its staff bypass is already scoped
-- to v_type = 'customer_support', so introducing a 'direct' type cannot expose
-- a private conversation to staff.
--
-- Regression coverage lives in supabase/tests/p16_direct_chat.sql.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Allow the 'direct' conversation type.
--    Nullable column added for 1-to-1 de-duplication. NULL values do not
--    collide in a unique index, so support/internal conversations are unaffected.
-- -----------------------------------------------------------------------------
ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_type_check;

ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_type_check
  CHECK (type IN ('customer_support', 'internal', 'direct'));

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS dm_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS conversations_dm_key_uniq
  ON public.conversations (dm_key)
  WHERE dm_key IS NOT NULL;

COMMENT ON COLUMN public.conversations.dm_key IS
  'Canonical "<lowest uuid>:<highest uuid>" key for 1-to-1 conversations. '
  'NULL for customer_support/internal conversations. Guarantees at most one '
  'direct conversation per pair of profiles.';

-- -----------------------------------------------------------------------------
-- 2. Create-or-get a direct conversation.
--
--    SECURITY DEFINER because conversation_participants has no INSERT policy by
--    design: a participant must never be able to add itself to an arbitrary
--    conversation. This RPC is the single, audited exception, and it only ever
--    inserts the caller and the explicitly named recipient.
--
--    title is intentionally left NULL: a direct conversation's display name is
--    the counterpart, which differs per viewer and is derived from
--    list_my_conversations().participants at render time.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_or_create_direct_conversation(
  p_other_profile_id UUID
)
RETURNS public.conversations
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid UUID := auth.uid();
  v_other UUID := p_other_profile_id;
  v_key TEXT;
  v_conversation public.conversations;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF v_other IS NULL THEN
    RAISE EXCEPTION 'Recipient is required';
  END IF;

  IF v_other = v_uid THEN
    RAISE EXCEPTION 'You cannot start a conversation with yourself';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_other) THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- Blocking is symmetric (the helper checks both directions), so a block in
  -- either direction prevents starting a conversation.
  IF public.social_profiles_are_blocked(v_uid, v_other) THEN
    RAISE EXCEPTION 'You cannot start a conversation with this user';
  END IF;

  v_key := LEAST(v_uid::TEXT, v_other::TEXT) || ':' || GREATEST(v_uid::TEXT, v_other::TEXT);

  SELECT c.* INTO v_conversation
  FROM public.conversations c
  WHERE c.dm_key = v_key
  LIMIT 1;

  IF v_conversation.id IS NOT NULL THEN
    RETURN v_conversation;
  END IF;

  BEGIN
    INSERT INTO public.conversations (type, status, dm_key)
    VALUES ('direct', 'open', v_key)
    RETURNING * INTO v_conversation;
  EXCEPTION
    -- Two clients racing on the same pair: the unique index settles it.
    WHEN unique_violation THEN
      SELECT c.* INTO v_conversation
      FROM public.conversations c
      WHERE c.dm_key = v_key
      LIMIT 1;

      IF v_conversation.id IS NULL THEN
        RAISE;
      END IF;

      RETURN v_conversation;
  END;

  -- Both participant rows are written in the same transaction. The
  -- notify_on_chat_message trigger reads conversation_participants, so a
  -- conversation with a single participant would silently never notify.
  INSERT INTO public.conversation_participants (conversation_id, profile_id, member_role)
  VALUES
    (v_conversation.id, v_uid, 'member'),
    (v_conversation.id, v_other, 'member')
  ON CONFLICT (conversation_id, profile_id) DO NOTHING;

  RETURN v_conversation;
END;
$fn$;

-- Supabase grants EXECUTE on every new public function to PUBLIC/anon/
-- authenticated by platform default, and REVOKE ... FROM PUBLIC removes nothing.
-- Follow the repo doctrine from 20261007090000_revoke_internal_helper_grants.sql.
REVOKE ALL ON FUNCTION public.get_or_create_direct_conversation(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_or_create_direct_conversation(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. Realtime publication.
--
--    Idempotent, matching the existing pattern in 20260829080000 and
--    20260929100000. A no-op where the tables are already published; required
--    where the publication exists but the membership was lost (for example after
--    restoring a pg_dump, which does not carry publication membership).
--    Without this the client's postgres_changes subscriptions never fire and
--    direct chat silently degrades to polling.
--
--    NOTE: whether Realtime enforces RLS for postgres_changes is a project
--    setting ("Realtime Authorization") that cannot be asserted from SQL. The
--    client additionally filters its messages subscription by conversation_id.
-- -----------------------------------------------------------------------------
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'supabase_realtime publication absent; skipping publication membership';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conversation_participants'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_participants;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'typing_indicators'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.typing_indicators;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'message_reactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reactions;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'user_presence'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_presence;
  END IF;
END;
$do$;

COMMIT;