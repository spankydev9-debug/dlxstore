-- DLXSTORE — chat lifecycle foundation
--
-- PRE-APPLICATION REQUIREMENT
-- ---------------------------
-- Apply only after confirming that the production database has successfully
-- applied `20260829080000_dlx_chat_foundation.sql` and
-- `20260903000000_fix_chat_profiles_is_active.sql`. This file is intentionally
-- later than both and does not create a parallel chat system.

-- The original schema allowed only customer/admin roles while the chat system
-- already relies on staff. Recreate the role constraint idempotently.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS chk_role;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('customer', 'staff', 'admin'));

ALTER TABLE public.conversation_participants
  ADD COLUMN IF NOT EXISTS last_delivered_at TIMESTAMPTZ;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS client_message_id UUID,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now());

CREATE UNIQUE INDEX IF NOT EXISTS messages_sender_client_message_idx
  ON public.messages (sender_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS messages_conversation_visible_created_idx
  ON public.messages (conversation_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS messages_reply_to_idx
  ON public.messages (reply_to_id)
  WHERE reply_to_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.message_reactions (
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL CHECK (char_length(emoji) BETWEEN 1 AND 32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS message_reactions_message_idx
  ON public.message_reactions (message_id, created_at);

CREATE TABLE IF NOT EXISTS public.message_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  storage_object_path TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video', 'audio', 'file')),
  mime_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size > 0 AND byte_size <= 52428800),
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (message_id, storage_object_path)
);

CREATE INDEX IF NOT EXISTS message_attachments_message_idx
  ON public.message_attachments (message_id);

ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Conversation members can read message reactions" ON public.message_reactions;
CREATE POLICY "Conversation members can read message reactions"
  ON public.message_reactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.id = message_reactions.message_id
        AND public.can_access_conversation(m.conversation_id)
    )
  );

DROP POLICY IF EXISTS "Conversation members can read message attachments" ON public.message_attachments;
CREATE POLICY "Conversation members can read message attachments"
  ON public.message_attachments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.id = message_attachments.message_id
        AND public.can_access_conversation(m.conversation_id)
    )
  );

CREATE OR REPLACE FUNCTION public.mark_conversation_delivered(
  p_conversation_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_access_conversation(p_conversation_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE public.conversation_participants
  SET last_delivered_at = GREATEST(COALESCE(last_delivered_at, 'epoch'::TIMESTAMPTZ), now())
  WHERE conversation_id = p_conversation_id
    AND profile_id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.toggle_message_reaction(
  p_message_id UUID,
  p_emoji TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emoji TEXT := btrim(p_emoji);
  v_conversation_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF v_emoji IS NULL OR char_length(v_emoji) NOT BETWEEN 1 AND 32 THEN
    RAISE EXCEPTION 'Invalid reaction';
  END IF;

  SELECT conversation_id INTO v_conversation_id
  FROM public.messages
  WHERE id = p_message_id AND deleted_at IS NULL;

  IF v_conversation_id IS NULL OR NOT public.can_access_conversation(v_conversation_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  DELETE FROM public.message_reactions
  WHERE message_id = p_message_id
    AND user_id = auth.uid()
    AND emoji = v_emoji;

  IF FOUND THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.message_reactions (message_id, user_id, emoji)
  VALUES (p_message_id, auth.uid(), v_emoji);
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.edit_conversation_message(
  p_message_id UUID,
  p_body TEXT
)
RETURNS public.messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_body TEXT := btrim(p_body);
  v_message public.messages;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF v_body IS NULL OR char_length(v_body) NOT BETWEEN 1 AND 4000 THEN
    RAISE EXCEPTION 'Invalid message body';
  END IF;

  UPDATE public.messages
  SET body = v_body, edited_at = now(), updated_at = now()
  WHERE id = p_message_id
    AND sender_id = auth.uid()
    AND deleted_at IS NULL
  RETURNING * INTO v_message;

  IF v_message.id IS NULL THEN
    RAISE EXCEPTION 'Message cannot be edited';
  END IF;

  RETURN v_message;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_conversation_message(
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

  UPDATE public.messages
  SET deleted_at = now(), body = 'Message deleted', updated_at = now()
  WHERE id = p_message_id
    AND sender_id = auth.uid()
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Message cannot be deleted';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_message_attachment(
  p_message_id UUID,
  p_storage_object_path TEXT,
  p_media_type TEXT,
  p_mime_type TEXT,
  p_byte_size BIGINT,
  p_width INTEGER DEFAULT NULL,
  p_height INTEGER DEFAULT NULL,
  p_duration_ms INTEGER DEFAULT NULL
)
RETURNS public.message_attachments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attachment public.message_attachments;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_storage_object_path IS NULL OR btrim(p_storage_object_path) = ''
    OR p_storage_object_path LIKE '/%' OR p_storage_object_path LIKE '%..%' THEN
    RAISE EXCEPTION 'Invalid storage path';
  END IF;

  INSERT INTO public.message_attachments (
    message_id, storage_object_path, media_type, mime_type, byte_size, width, height, duration_ms
  )
  SELECT
    p_message_id, btrim(p_storage_object_path), p_media_type, btrim(p_mime_type), p_byte_size,
    p_width, p_height, p_duration_ms
  WHERE EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = p_message_id
      AND m.sender_id = auth.uid()
      AND m.deleted_at IS NULL
  )
  RETURNING * INTO v_attachment;

  IF v_attachment.id IS NULL THEN
    RAISE EXCEPTION 'Message attachment is not permitted';
  END IF;

  RETURN v_attachment;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_conversation_delivered(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.toggle_message_reaction(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.edit_conversation_message(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_conversation_message(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_message_attachment(UUID, TEXT, TEXT, TEXT, BIGINT, INTEGER, INTEGER, INTEGER) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.mark_conversation_delivered(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_message_reaction(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.edit_conversation_message(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_conversation_message(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_message_attachment(UUID, TEXT, TEXT, TEXT, BIGINT, INTEGER, INTEGER, INTEGER) TO authenticated;
