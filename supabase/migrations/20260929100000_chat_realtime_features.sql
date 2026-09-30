-- DLXSTORE — DLX Chat Realtime Features Migration
-- Adds realtime messaging features: read receipts, typing indicators, online status,
-- message reactions, edits, deletions, and media support.
--
-- This migration extends the existing chat foundation (20260829080000_dlx_chat_foundation.sql)
-- with modern messaging capabilities while maintaining backward compatibility.

-- 1. ONLINE STATUS TRACKING
CREATE TABLE IF NOT EXISTS public.user_presence (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'away', 'offline')),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  device_id TEXT, -- For multi-device tracking
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS user_presence_status_idx ON public.user_presence(status);
CREATE INDEX IF NOT EXISTS user_presence_last_seen_idx ON public.user_presence(last_seen_at);

-- RLS for user_presence: users can update their own status, can read others
ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view others' presence" ON public.user_presence;
CREATE POLICY "Users can view others' presence"
  ON public.user_presence FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Users can update their own presence" ON public.user_presence;
CREATE POLICY "Users can update their own presence"
  ON public.user_presence FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own presence" ON public.user_presence;
CREATE POLICY "Users can insert their own presence"
  ON public.user_presence FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 2. TYPING INDICATORS
CREATE TABLE IF NOT EXISTS public.typing_indicators (
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_typing BOOLEAN NOT NULL DEFAULT false,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS typing_indicators_conversation_idx 
  ON public.typing_indicators(conversation_id, last_updated_at DESC);

-- RLS for typing_indicators: participants can update their typing status
ALTER TABLE public.typing_indicators ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants can view typing indicators" ON public.typing_indicators;
CREATE POLICY "Participants can view typing indicators"
  ON public.typing_indicators FOR SELECT
  USING (public.can_access_conversation(conversation_id));

DROP POLICY IF EXISTS "Users can update their typing status" ON public.typing_indicators;
CREATE POLICY "Users can update their typing status"
  ON public.typing_indicators FOR ALL
  USING (auth.uid() = user_id AND public.can_access_conversation(conversation_id))
  WITH CHECK (auth.uid() = user_id AND public.can_access_conversation(conversation_id));

-- 3. MESSAGE REACTIONS
CREATE TABLE IF NOT EXISTS public.message_reactions (
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL CHECK (length(emoji) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS message_reactions_message_idx 
  ON public.message_reactions(message_id, created_at DESC);
CREATE INDEX IF NOT EXISTS message_reactions_user_idx 
  ON public.message_reactions(user_id);

-- RLS for message_reactions: participants can react to messages in their conversations
ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants can view reactions" ON public.message_reactions;
CREATE POLICY "Participants can view reactions"
  ON public.message_reactions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = message_id 
      AND public.can_access_conversation(m.conversation_id)
  ));

DROP POLICY IF EXISTS "Users can add/remove their reactions" ON public.message_reactions;
CREATE POLICY "Users can add/remove their reactions"
  ON public.message_reactions FOR ALL
  USING (auth.uid() = user_id AND EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = message_id 
      AND public.can_access_conversation(m.conversation_id)
  ))
  WITH CHECK (auth.uid() = user_id AND EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = message_id 
      AND public.can_access_conversation(m.conversation_id)
  ));

-- 4. MEDIA ATTACHMENTS
CREATE TABLE IF NOT EXISTS public.message_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video', 'audio', 'document', 'sticker')),
  file_url TEXT NOT NULL,
  file_name TEXT,
  file_size BIGINT,
  mime_type TEXT,
  thumbnail_url TEXT,
  width INTEGER,
  height INTEGER,
  duration_seconds DECIMAL(10,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS message_media_message_idx ON public.message_media(message_id);
CREATE INDEX IF NOT EXISTS message_media_type_idx ON public.message_media(media_type);

-- RLS for message_media: participants can view media in their conversations
ALTER TABLE public.message_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants can view message media" ON public.message_media;
CREATE POLICY "Participants can view message media"
  ON public.message_media FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = message_id 
      AND public.can_access_conversation(m.conversation_id)
  ));

-- 5. FORWARDED MESSAGES (message linking)
CREATE TABLE IF NOT EXISTS public.forwarded_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  forwarded_message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (original_message_id, forwarded_message_id)
);

CREATE INDEX IF NOT EXISTS forwarded_messages_original_idx ON public.forwarded_messages(original_message_id);
CREATE INDEX IF NOT EXISTS forwarded_messages_forwarded_idx ON public.forwarded_messages(forwarded_message_id);

-- RLS for forwarded_messages: participants can view forwards in their conversations
ALTER TABLE public.forwarded_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants can view forwarded messages" ON public.forwarded_messages;
CREATE POLICY "Participants can view forwarded messages"
  ON public.forwarded_messages FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = original_message_id 
      AND public.can_access_conversation(m.conversation_id)
  ) OR EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = forwarded_message_id 
      AND public.can_access_conversation(m.conversation_id)
  ));

-- 6. PINNED MESSAGES
CREATE TABLE IF NOT EXISTS public.pinned_messages (
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  pinned_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  pinned_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  note TEXT,
  PRIMARY KEY (conversation_id, message_id)
);

CREATE INDEX IF NOT EXISTS pinned_messages_conversation_idx ON public.pinned_messages(conversation_id, pinned_at DESC);

-- RLS for pinned_messages: participants can view pinned messages
ALTER TABLE public.pinned_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants can view pinned messages" ON public.pinned_messages;
CREATE POLICY "Participants can view pinned messages"
  ON public.pinned_messages FOR SELECT
  USING (public.can_access_conversation(conversation_id));

DROP POLICY IF EXISTS "Staff/admins can pin/unpin messages" ON public.pinned_messages;
CREATE POLICY "Staff/admins can pin/unpin messages"
  ON public.pinned_messages FOR ALL
  USING (public.can_access_conversation(conversation_id) AND public.is_staff_or_admin())
  WITH CHECK (public.can_access_conversation(conversation_id) AND public.is_staff_or_admin());

-- 7. READ RECEIPTS ENHANCEMENT (extend existing conversation_participants)
-- Add delivered_at timestamp to track when message was delivered to user's device
ALTER TABLE public.conversation_participants 
ADD COLUMN IF NOT EXISTS last_delivered_at TIMESTAMPTZ;

-- 8. MESSAGE STATUS TRACKING (for realtime delivery confirmation)
CREATE TABLE IF NOT EXISTS public.message_status (
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('sent', 'delivered', 'read')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS message_status_user_idx ON public.message_status(user_id, updated_at DESC);

-- RLS for message_status: participants can view status of messages in their conversations
ALTER TABLE public.message_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants can view message status" ON public.message_status;
CREATE POLICY "Participants can view message status"
  ON public.message_status FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = message_id 
      AND public.can_access_conversation(m.conversation_id)
  ));

DROP POLICY IF EXISTS "Users can update message status" ON public.message_status;
CREATE POLICY "Users can update message status"
  ON public.message_status FOR ALL
  USING (auth.uid() = user_id AND EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = message_id 
      AND public.can_access_conversation(m.conversation_id)
  ))
  WITH CHECK (auth.uid() = user_id AND EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = message_id 
      AND public.can_access_conversation(m.conversation_id)
  ));

-- 9. GROUP CHAT SUPPORT (future-ready)
-- Add group-specific columns to conversations table
ALTER TABLE public.conversations 
ADD COLUMN IF NOT EXISTS is_group BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS group_avatar_url TEXT,
ADD COLUMN IF NOT EXISTS group_description TEXT,
ADD COLUMN IF NOT EXISTS group_admin_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Add group member roles
ALTER TABLE public.conversation_participants
ADD COLUMN IF NOT EXISTS member_role TEXT DEFAULT 'member' CHECK (member_role IN ('admin', 'moderator', 'member'));

-- 10. REALTIME PUBLICATION FOR NEW TABLES
DO $$
BEGIN
  -- Add new tables to realtime publication
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public' AND tablename = 'user_presence'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_presence;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public' AND tablename = 'typing_indicators'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.typing_indicators;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public' AND tablename = 'message_reactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reactions;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public' AND tablename = 'message_media'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.message_media;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public' AND tablename = 'pinned_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pinned_messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public' AND tablename = 'message_status'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.message_status;
  END IF;
END;
$$;

-- 11. HELPER FUNCTIONS FOR REALTIME FEATURES

-- Update user presence
CREATE OR REPLACE FUNCTION public.update_user_presence(
  p_status TEXT DEFAULT 'online',
  p_device_id TEXT DEFAULT NULL
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

  INSERT INTO public.user_presence (user_id, status, device_id, last_seen_at, updated_at)
  VALUES (auth.uid(), p_status, p_device_id, now(), now())
  ON CONFLICT (user_id) 
  DO UPDATE SET 
    status = EXCLUDED.status,
    device_id = COALESCE(EXCLUDED.device_id, user_presence.device_id),
    last_seen_at = CASE 
      WHEN EXCLUDED.status = 'offline' THEN user_presence.last_seen_at 
      ELSE now() 
    END,
    updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_user_presence(TEXT, TEXT) TO authenticated;

-- Update typing indicator
CREATE OR REPLACE FUNCTION public.set_typing_status(
  p_conversation_id UUID,
  p_is_typing BOOLEAN
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

  INSERT INTO public.typing_indicators (conversation_id, user_id, is_typing, last_updated_at)
  VALUES (p_conversation_id, auth.uid(), p_is_typing, now())
  ON CONFLICT (conversation_id, user_id) 
  DO UPDATE SET 
    is_typing = EXCLUDED.is_typing,
    last_updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_typing_status(UUID, BOOLEAN) TO authenticated;

-- Add reaction to message
CREATE OR REPLACE FUNCTION public.add_message_reaction(
  p_message_id UUID,
  p_emoji TEXT
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

  -- Verify access to conversation through message
  IF NOT EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = p_message_id 
      AND public.can_access_conversation(m.conversation_id)
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO public.message_reactions (message_id, user_id, emoji)
  VALUES (p_message_id, auth.uid(), p_emoji)
  ON CONFLICT (message_id, user_id, emoji) 
  DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_message_reaction(UUID, TEXT) TO authenticated;

-- Remove reaction from message
CREATE OR REPLACE FUNCTION public.remove_message_reaction(
  p_message_id UUID,
  p_emoji TEXT
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

  -- Verify access to conversation through message
  IF NOT EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = p_message_id 
      AND public.can_access_conversation(m.conversation_id)
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  DELETE FROM public.message_reactions 
  WHERE message_id = p_message_id 
    AND user_id = auth.uid() 
    AND emoji = p_emoji;
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_message_reaction(UUID, TEXT) TO authenticated;

-- Update message delivery status
CREATE OR REPLACE FUNCTION public.update_message_status(
  p_message_id UUID,
  p_status TEXT
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

  -- Verify access to conversation through message
  IF NOT EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = p_message_id 
      AND public.can_access_conversation(m.conversation_id)
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO public.message_status (message_id, user_id, status)
  VALUES (p_message_id, auth.uid(), p_status)
  ON CONFLICT (message_id, user_id) 
  DO UPDATE SET 
    status = EXCLUDED.status,
    updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_message_status(UUID, TEXT) TO authenticated;

-- Pin message in conversation
CREATE OR REPLACE FUNCTION public.pin_message(
  p_conversation_id UUID,
  p_message_id UUID,
  p_note TEXT DEFAULT NULL
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

  IF NOT public.is_staff_or_admin() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  -- Verify message belongs to conversation
  IF NOT EXISTS (
    SELECT 1 FROM public.messages 
    WHERE id = p_message_id AND conversation_id = p_conversation_id
  ) THEN
    RAISE EXCEPTION 'Message not found in conversation';
  END IF;

  INSERT INTO public.pinned_messages (conversation_id, message_id, pinned_by, note)
  VALUES (p_conversation_id, p_message_id, auth.uid(), p_note)
  ON CONFLICT (conversation_id, message_id) 
  DO UPDATE SET 
    pinned_by = EXCLUDED.pinned_by,
    note = EXCLUDED.note,
    pinned_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.pin_message(UUID, UUID, TEXT) TO authenticated;

-- Unpin message from conversation
CREATE OR REPLACE FUNCTION public.unpin_message(
  p_conversation_id UUID,
  p_message_id UUID
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

  IF NOT public.is_staff_or_admin() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  DELETE FROM public.pinned_messages 
  WHERE conversation_id = p_conversation_id 
    AND message_id = p_message_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.unpin_message(UUID, UUID) TO authenticated;

-- Get conversation with enhanced realtime data
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
    c.id AS conversation_id,
    c.type AS conversation_type,
    c.title AS conversation_title,
    c.status AS conversation_status,
    c.last_message_at,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'profile_id', p.id,
          'full_name', p.full_name,
          'role', p.role,
          'phone', p.phone,
          'email', p.email,
          'presence', jsonb_build_object(
            'status', up.status,
            'last_seen_at', up.last_seen_at
          ),
          'last_read_at', cp.last_read_at,
          'last_delivered_at', cp.last_delivered_at
        ) ORDER BY (p.id = v_uid) DESC, p.full_name
      )
      FROM public.conversation_participants cpr
      JOIN public.profiles p ON p.id = cpr.profile_id
      LEFT JOIN public.user_presence up ON up.user_id = p.id
      WHERE cpr.conversation_id = c.id
    ), '[]'::JSONB) AS participants,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'user_id', ti.user_id,
          'full_name', p.full_name,
          'is_typing', ti.is_typing,
          'last_updated_at', ti.last_updated_at
        )
      )
      FROM public.typing_indicators ti
      JOIN public.profiles p ON p.id = ti.user_id
      WHERE ti.conversation_id = c.id 
        AND ti.is_typing = true
        AND ti.last_updated_at > now() - interval '10 seconds'
    ), '[]'::JSONB) AS typing_users,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'message_id', pm.message_id,
          'pinned_by', pm.pinned_by,
          'pinned_by_name', pb.full_name,
          'pinned_at', pm.pinned_at,
          'note', pm.note
        ) ORDER BY pm.pinned_at DESC
      )
      FROM public.pinned_messages pm
      JOIN public.profiles pb ON pb.id = pm.pinned_by
      WHERE pm.conversation_id = c.id
    ), '[]'::JSONB) AS pinned_messages,
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
    ) AS unread_count
  FROM public.conversations c
  WHERE c.id = p_conversation_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_conversation_with_realtime_data(UUID) TO authenticated;

-- Update send_conversation_message to handle media and track message status
CREATE OR REPLACE FUNCTION public.send_conversation_message_v2(
  p_conversation_id UUID,
  p_body TEXT,
  p_media JSONB DEFAULT NULL
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
  v_media_item JSONB;
  v_media_id UUID;
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

  -- Create the message
  INSERT INTO public.messages (conversation_id, sender_id, sender_name, sender_role, body)
  VALUES (
    p_conversation_id,
    v_uid,
    COALESCE(v_sender.full_name, 'DLXSTORE'),
    COALESCE(v_sender.role, 'customer'),
    left(v_body, 4000)
  )
  RETURNING * INTO v_msg;

  -- Update conversation metadata
  UPDATE public.conversations
  SET last_message_at = v_msg.created_at,
      last_message_preview = left(v_msg.body, 120),
      updated_at = now()
  WHERE id = p_conversation_id;

  -- Add media attachments if provided
  IF p_media IS NOT NULL THEN
    FOR v_media_item IN SELECT * FROM jsonb_array_elements(p_media)
    LOOP
      INSERT INTO public.message_media (
        message_id,
        media_type,
        file_url,
        file_name,
        file_size,
        mime_type,
        thumbnail_url,
        width,
        height,
        duration_seconds
      ) VALUES (
        v_msg.id,
        COALESCE(v_media_item->>'media_type', 'image'),
        v_media_item->>'file_url',
        v_media_item->>'file_name',
        (v_media_item->>'file_size')::BIGINT,
        v_media_item->>'mime_type',
        v_media_item->>'thumbnail_url',
        (v_media_item->>'width')::INTEGER,
        (v_media_item->>'height')::INTEGER,
        (v_media_item->>'duration_seconds')::DECIMAL
      );
    END LOOP;
  END IF;

  -- Initialize message status as 'sent' for sender
  INSERT INTO public.message_status (message_id, user_id, status)
  VALUES (v_msg.id, v_uid, 'sent')
  ON CONFLICT DO NOTHING;

  RETURN v_msg;
END;
$$;

GRANT EXECUTE ON FUNCTION public.send_conversation_message_v2(UUID, TEXT, JSONB) TO authenticated;

-- REVERSIBLE (rollback)
--   DROP FUNCTION IF EXISTS public.send_conversation_message_v2(UUID, TEXT, JSONB);
--   DROP FUNCTION IF EXISTS public.get_conversation_with_realtime_data(UUID);
--   DROP FUNCTION IF EXISTS public.unpin_message(UUID, UUID);
--   DROP FUNCTION IF EXISTS public.pin_message(UUID, UUID, TEXT);
--   DROP FUNCTION IF EXISTS public.update_message_status(UUID, TEXT);
--   DROP FUNCTION IF EXISTS public.remove_message_reaction(UUID, TEXT);
--   DROP FUNCTION IF EXISTS public.add_message_reaction(UUID, TEXT);
--   DROP FUNCTION IF EXISTS public.set_typing_status(UUID, BOOLEAN);
--   DROP FUNCTION IF EXISTS public.update_user_presence(TEXT, TEXT);
--   DROP TABLE IF EXISTS public.message_status;
--   DROP TABLE IF EXISTS public.pinned_messages;
--   DROP TABLE IF EXISTS public.forwarded_messages;
--   DROP TABLE IF EXISTS public.message_media;
--   DROP TABLE IF EXISTS public.message_reactions;
--   DROP TABLE IF EXISTS public.typing_indicators;
--   DROP TABLE IF EXISTS public.user_presence;
--   ALTER TABLE public.conversation_participants DROP COLUMN IF EXISTS last_delivered_at;
--   ALTER TABLE public.conversation_participants DROP COLUMN IF EXISTS member_role;
--   ALTER TABLE public.conversations DROP COLUMN IF EXISTS is_group;
--   ALTER TABLE public.conversations DROP COLUMN IF EXISTS group_avatar_url;
--   ALTER TABLE public.conversations DROP COLUMN IF EXISTS group_description;
--   ALTER TABLE public.conversations DROP COLUMN IF EXISTS group_admin_id;