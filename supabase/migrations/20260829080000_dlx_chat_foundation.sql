-- DLXSTORE — DLX Chat Foundation (Phase 6)
-- Internal messaging: customers <-> DLX staff, and staff <-> staff.
--
--   conversations                -> customer_support | internal
--   conversation_participants    -> membership + per-member read state
--   messages                     -> chat messages (sender display name denormalized
--                                    so clients never need cross-user profile reads)
--
-- Security: RLS enabled everywhere. Reads go through can_access_conversation()
-- (SECURITY DEFINER, no recursion). Mutations happen exclusively through the
-- SECURITY DEFINER RPCs below which re-verify access on every call.
--
-- Realtime: conversations + messages join the supabase_realtime publication
-- (idempotent). Polling fallback stays in the UI.

-- 1. HELPER: staff-or-admin (mirrors public.is_admin() to avoid RLS recursion)
CREATE OR REPLACE FUNCTION public.is_staff_or_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'staff')
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_staff_or_admin() TO authenticated, anon;

-- 2. CONVERSATIONS
CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('customer_support', 'internal')),
  title TEXT,
  customer_profile_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'closed')),
  last_message_at TIMESTAMPTZ,
  last_message_preview TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS conversations_type_customer_idx
  ON public.conversations(type, customer_profile_id);
CREATE INDEX IF NOT EXISTS conversations_type_status_idx
  ON public.conversations(type, status);
CREATE INDEX IF NOT EXISTS conversations_order_id_idx
  ON public.conversations(order_id);
CREATE INDEX IF NOT EXISTS conversations_last_message_at_idx
  ON public.conversations(COALESCE(last_message_at, created_at) DESC);

-- 3. CONVERSATION PARTICIPANTS
CREATE TABLE IF NOT EXISTS public.conversation_participants (
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (conversation_id, profile_id)
);

CREATE INDEX IF NOT EXISTS conversation_participants_profile_idx
  ON public.conversation_participants(profile_id);

-- 4. MESSAGES
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sender_name TEXT,
  sender_role TEXT CHECK (sender_role IN ('customer', 'staff', 'admin')),
  body TEXT NOT NULL CHECK (length(btrim(body)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS messages_conversation_created_idx
  ON public.messages(conversation_id, created_at);

-- 5. CAN-ACCESS HELPER (SECURITY DEFINER — single source of truth)
CREATE OR REPLACE FUNCTION public.can_access_conversation(p_conversation_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type TEXT;
BEGIN
  SELECT type INTO v_type
  FROM public.conversations
  WHERE id = p_conversation_id;

  IF v_type IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Staff/admins may open any customer-support conversation.
  IF v_type = 'customer_support' AND public.is_staff_or_admin() THEN
    RETURN TRUE;
  END IF;

  -- Members of the conversation may always access it (covers internal chat
  -- and the customer side of support conversations).
  RETURN EXISTS (
    SELECT 1 FROM public.conversation_participants cp
    WHERE cp.conversation_id = p_conversation_id
      AND cp.profile_id = auth.uid()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_access_conversation(UUID) TO authenticated, anon;

-- 6. ROW LEVEL SECURITY
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants can view their conversations" ON public.conversations;
CREATE POLICY "Participants can view their conversations"
  ON public.conversations FOR SELECT
  USING (public.can_access_conversation(id));

DROP POLICY IF EXISTS "Staff and admins can resolve support conversations" ON public.conversations;
CREATE POLICY "Staff and admins can resolve support conversations"
  ON public.conversations FOR UPDATE
  USING ((type = 'customer_support') AND public.is_staff_or_admin())
  WITH CHECK ((type = 'customer_support') AND public.is_staff_or_admin());

DROP POLICY IF EXISTS "Participants can update internal conversation titles" ON public.conversations;
CREATE POLICY "Participants can update internal conversation titles"
  ON public.conversations FOR UPDATE
  USING ((type = 'internal') AND EXISTS (
    SELECT 1 FROM public.conversation_participants cp
    WHERE cp.conversation_id = id AND cp.profile_id = auth.uid()
  ))
  WITH CHECK ((type = 'internal') AND EXISTS (
    SELECT 1 FROM public.conversation_participants cp
    WHERE cp.conversation_id = id AND cp.profile_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Participants can view members of their conversations" ON public.conversation_participants;
CREATE POLICY "Participants can view members of their conversations"
  ON public.conversation_participants FOR SELECT
  USING (public.can_access_conversation(conversation_id));

DROP POLICY IF EXISTS "Participants can read messages" ON public.messages;
CREATE POLICY "Participants can read messages"
  ON public.messages FOR SELECT
  USING (public.can_access_conversation(conversation_id));
-- 7. SECURITY DEFINER RPCs (single mutation path)

-- Customers: find the current support conversation (or create it), optionally
-- scoped to a specific order so chat can carry order context when useful.
CREATE OR REPLACE FUNCTION public.get_or_create_customer_support_conversation(
  p_order_id UUID DEFAULT NULL
)
RETURNS public.conversations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_conv public.conversations;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT c.* INTO v_conv
  FROM public.conversations c
  WHERE c.type = 'customer_support'
    AND c.customer_profile_id = v_uid
    AND c.status <> 'closed'
    AND (
      (p_order_id IS NULL AND c.order_id IS NULL)
      OR c.order_id = p_order_id
    )
  ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
  LIMIT 1;

  IF v_conv.id IS NOT NULL THEN
    RETURN v_conv;
  END IF;

  INSERT INTO public.conversations (type, customer_profile_id, order_id)
  VALUES ('customer_support', v_uid, p_order_id)
  RETURNING * INTO v_conv;

  INSERT INTO public.conversation_participants (conversation_id, profile_id)
  VALUES (v_conv.id, v_uid);

  -- Auto-assign the most senior available staff member so staff notifications
  -- reach a real person immediately.
  INSERT INTO public.conversation_participants (conversation_id, profile_id)
  SELECT v_conv.id, p.id
  FROM public.profiles p
  WHERE p.role = 'admin' AND p.is_active IS NOT FALSE AND p.id <> v_uid
  ORDER BY p.created_at ASC
  LIMIT 1
  ON CONFLICT DO NOTHING;

  RETURN v_conv;
END;
$$;

-- Staff: create an internal conversation with chosen staff/admin participants.
CREATE OR REPLACE FUNCTION public.create_internal_conversation(
  p_title TEXT,
  p_participant_ids UUID[]
)
RETURNS public.conversations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_conv public.conversations;
  v_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.is_staff_or_admin() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  INSERT INTO public.conversations (type, title)
  VALUES ('internal', NULLIF(btrim(COALESCE(p_title, '')), ''))
  RETURNING * INTO v_conv;

  INSERT INTO public.conversation_participants (conversation_id, profile_id)
  VALUES (v_conv.id, v_uid);

  IF p_participant_ids IS NOT NULL THEN
    FOREACH v_id IN ARRAY p_participant_ids
    LOOP
      IF v_id <> v_uid AND EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = v_id AND role IN ('admin', 'staff') AND is_active IS NOT FALSE
      ) THEN
        INSERT INTO public.conversation_participants (conversation_id, profile_id)
        VALUES (v_conv.id, v_id)
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  RETURN v_conv;
END;
$$;

-- Staff: add a staff/admin member to a conversation (support assignment or
-- extending an internal thread).
CREATE OR REPLACE FUNCTION public.add_conversation_participant(
  p_conversation_id UUID,
  p_profile_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.is_staff_or_admin() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF NOT public.can_access_conversation(p_conversation_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO public.conversation_participants (conversation_id, profile_id)
  SELECT p_conversation_id, p_profile_id
  WHERE EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_profile_id AND role IN ('admin', 'staff') AND is_active IS NOT FALSE
  )
  ON CONFLICT DO NOTHING;
END;
$$;
-- Send a message. The author is verified as a conversation member / staff-assigned.
CREATE OR REPLACE FUNCTION public.send_conversation_message(
  p_conversation_id UUID,
  p_body TEXT
)
RETURNS public.messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_body TEXT := btrim(p_body);
  v_msg public.messages;
  v_sender RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF v_body IS NULL OR v_body = '' THEN
    RAISE EXCEPTION 'Message cannot be empty';
  END IF;

  IF NOT public.can_access_conversation(p_conversation_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT full_name, role INTO v_sender FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.messages (conversation_id, sender_id, sender_name, sender_role, body)
  VALUES (
    p_conversation_id,
    v_uid,
    COALESCE(v_sender.full_name, 'DLXSTORE'),
    COALESCE(v_sender.role, 'customer'),
    left(v_body, 4000)
  )
  RETURNING * INTO v_msg;

  UPDATE public.conversations
  SET last_message_at = v_msg.created_at,
      last_message_preview = left(v_msg.body, 120),
      updated_at = now()
  WHERE id = p_conversation_id;

  RETURN v_msg;
END;
$$;

-- Mark the current user's read state up to now for a conversation.
CREATE OR REPLACE FUNCTION public.mark_conversation_read(
  p_conversation_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.can_access_conversation(p_conversation_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO public.conversation_participants (conversation_id, profile_id, last_read_at)
  VALUES (p_conversation_id, auth.uid(), now())
  ON CONFLICT (conversation_id, profile_id)
  DO UPDATE SET last_read_at = now();
END;
$$;

-- List my conversations (participant + staff support desk) with unread counts
-- and the full participant list for identity/context rendering.
CREATE OR REPLACE FUNCTION public.list_my_conversations()
RETURNS TABLE (
  id UUID,
  type TEXT,
  title TEXT,
  customer_profile_id UUID,
  order_id UUID,
  status TEXT,
  last_message_at TIMESTAMPTZ,
  last_message_preview TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  unread_count BIGINT,
  participants JSONB
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

  RETURN QUERY
  SELECT
    c.id,
    c.type,
    c.title,
    c.customer_profile_id,
    c.order_id,
    c.status,
    c.last_message_at,
    c.last_message_preview,
    c.created_at,
    c.updated_at,
    (
      SELECT count(*)::BIGINT
      FROM public.messages m
      WHERE m.conversation_id = c.id
        AND m.sender_id <> v_uid
        AND m.deleted_at IS NULL
        AND m.created_at > COALESCE(
          (
            SELECT cp.last_read_at FROM public.conversation_participants cp
            WHERE cp.conversation_id = c.id AND cp.profile_id = v_uid
          ),
          'epoch'::TIMESTAMPTZ
        )
    ) AS unread_count,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'profile_id', p.id,
          'full_name', p.full_name,
          'role', p.role,
          'phone', p.phone,
          'email', p.email
        ) ORDER BY (p.id = v_uid) DESC, p.full_name
      )
      FROM public.conversation_participants cpr
      JOIN public.profiles p ON p.id = cpr.profile_id
      WHERE cpr.conversation_id = c.id
    ), '[]'::JSONB) AS participants
  FROM public.conversations c
  WHERE EXISTS (
    SELECT 1 FROM public.conversation_participants mine
    WHERE mine.conversation_id = c.id AND mine.profile_id = v_uid
  )
  OR (public.is_staff_or_admin() AND c.type = 'customer_support')
  ORDER BY COALESCE(c.last_message_at, c.created_at) DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_or_create_customer_support_conversation(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_internal_conversation(TEXT, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_conversation_participant(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_conversation_message(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_conversations() TO authenticated;
-- Staff directory for the internal chat participant picker (SECURITY DEFINER,
-- exposes only admin/staff identity, never customer data).
CREATE OR REPLACE FUNCTION public.list_staff_profiles()
RETURNS TABLE (
  id UUID,
  full_name TEXT,
  role TEXT,
  phone TEXT,
  email TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.is_staff_or_admin() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  RETURN QUERY
  SELECT p.id, p.full_name, p.role, p.phone, p.email
  FROM public.profiles p
  WHERE p.role IN ('admin', 'staff') AND p.is_active IS NOT FALSE
  ORDER BY p.full_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_staff_profiles() TO authenticated;


-- 8. NOTIFICATION TRIGGER (chat message -> participant notifications)
CREATE OR REPLACE FUNCTION public.notify_on_chat_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type TEXT;
  v_recipient RECORD;
  v_sender_label TEXT;
BEGIN
  SELECT type INTO v_type FROM public.conversations WHERE id = NEW.conversation_id;

  v_sender_label := COALESCE(NEW.sender_name, 'DLXSTORE');
  IF NEW.sender_role IN ('admin', 'staff') THEN
    v_sender_label := v_sender_label || ' · DLX';
  ELSE
    v_sender_label := v_sender_label || ' · Client';
  END IF;

  FOR v_recipient IN
    SELECT cp.profile_id AS user_id
    FROM public.conversation_participants cp
    WHERE cp.conversation_id = NEW.conversation_id
      AND cp.profile_id <> NEW.sender_id
  LOOP
    INSERT INTO public.notifications (user_id, title, message, type)
    VALUES (
      v_recipient.user_id,
      CASE WHEN v_type = 'customer_support' THEN 'Support DLXSTORE' ELSE 'Discussion DLX' END,
      format('%s: %s', v_sender_label, left(NEW.body, 120)),
      'chat_message'
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_on_chat_message ON public.messages;
CREATE TRIGGER trg_notify_on_chat_message
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_chat_message();

-- 9. REALTIME PUBLICATION (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public' AND tablename = 'conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public' AND tablename = 'conversation_participants'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_participants;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
END;
$$;

-- REVERSIBLE (rollback)
--   DROP TRIGGER IF EXISTS trg_notify_on_chat_message ON public.messages;
--   DROP FUNCTION IF EXISTS public.notify_on_chat_message();
--   DROP FUNCTION IF EXISTS public.list_my_conversations();
--   DROP FUNCTION IF EXISTS public.mark_conversation_read(UUID);
--   DROP FUNCTION IF EXISTS public.send_conversation_message(UUID, TEXT);
--   DROP FUNCTION IF EXISTS public.add_conversation_participant(UUID, UUID);
--   DROP FUNCTION IF EXISTS public.create_internal_conversation(TEXT, UUID[]);
--   DROP FUNCTION IF EXISTS public.get_or_create_customer_support_conversation(UUID);
--   DROP FUNCTION IF EXISTS public.can_access_conversation(UUID);
--   DROP FUNCTION IF EXISTS public.is_staff_or_admin();
--   DROP TABLE IF EXISTS public.messages;
--   DROP TABLE IF EXISTS public.conversation_participants;
--   DROP TABLE IF EXISTS public.conversations;