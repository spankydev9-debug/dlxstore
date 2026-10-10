-- 20261020090000_chat_media_and_commerce_fix
--
-- P0 chat repair + marketplace fixes, part 1 (chat media + media-only messages).
--
-- 1. Chat attachments get their own storage bucket. The catalogue bucket
--    (product-images) is admin-write-only, so a customer sending a photo was
--    rejected by RLS ("new row violates row-level security policy") and every
--    image silently disappeared. chat-media is PRIVATE: only members of the
--    conversation that owns an object may read it (or staff/admin on a
--    customer-support thread, via can_access_conversation), and uploads are
--    scoped to a conversation the caller can already access. The application
--    stores object paths, never public URLs, and mints a short-lived signed URL
--    only after that same authorization passes.
--
-- 2. send_conversation_message_v2 refused media-only messages ("Message cannot
--    be empty"). A photo shared without a caption is a perfectly valid message,
--    so the guard is relaxed: empty bodies are allowed whenever media is
--    attached (stored as '📎' so the non-null body column stays happy).

-- --- chat-media bucket + storage policies (PRIVATE) --------------------------
--
-- Object layout is `chat-media/<conversation_id>/<object>` (see
-- ChatMediaService.uploadMedia and uploadMessageMedia), so the conversation is
-- the second path segment. Authorization reuses can_access_conversation(), the
-- same predicate every chat table already uses.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-media', 'chat-media', false, 10485760,
  ARRAY[
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/webm', 'video/ogg',
    'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm',
    'application/pdf', 'text/plain', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Remove the earlier broad public-read policy if a prior run created it.
DROP POLICY IF EXISTS "Public can read chat media" ON storage.objects;

-- Read: only a participant of the owning conversation (or staff on a support
-- thread) may select the object. createSignedUrl is therefore only issuable to
-- an authorized reader.
DROP POLICY IF EXISTS "Conversation participants read chat media" ON storage.objects;
CREATE POLICY "Conversation participants read chat media" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-media'
    AND split_part(name, '/', 2) ~ '^[0-9a-fA-F-]{36}$'
    AND public.can_access_conversation(split_part(name, '/', 2)::uuid)
  );

-- Write: a signed-in user may upload only into a conversation it can access.
DROP POLICY IF EXISTS "Authenticated users can upload chat media" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated participants upload chat media" ON storage.objects;
CREATE POLICY "Authenticated participants upload chat media" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-media'
    AND split_part(name, '/', 2) ~ '^[0-9a-fA-F-]{36}$'
    AND public.can_access_conversation(split_part(name, '/', 2)::uuid)
  );

DROP POLICY IF EXISTS "Chat media owners can update own objects" ON storage.objects;
CREATE POLICY "Chat media owners can update own objects" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'chat-media' AND owner = auth.uid())
  WITH CHECK (bucket_id = 'chat-media' AND owner = auth.uid());

DROP POLICY IF EXISTS "Chat media owners can delete own objects" ON storage.objects;
CREATE POLICY "Chat media owners can delete own objects" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'chat-media' AND owner = auth.uid());

-- --- media-only messages -----------------------------------------------------

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
  v_has_media BOOLEAN := p_media IS NOT NULL AND jsonb_typeof(p_media) = 'array' AND jsonb_array_length(p_media) > 0;
  v_msg public.messages;
  v_sender RECORD;
  v_media_item JSONB;
  v_media_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Text-only messages must have a body; a photo shared with no caption is fine.
  IF (v_body IS NULL OR v_body = '') AND NOT v_has_media THEN
    RAISE EXCEPTION 'Message cannot be empty';
  END IF;

  IF (v_body IS NULL OR v_body = '') AND v_has_media THEN
    v_body := '📎';
  END IF;

  IF NOT public.can_access_conversation(p_conversation_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Every attachment must be an object in THIS conversation's folder (a legacy
  -- absolute URL is tolerated for pre-migration rows, but new uploads are
  -- private object paths). This stops a participant from attaching an object
  -- belonging to a conversation it is not part of.
  IF v_has_media THEN
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_media) AS item
      WHERE COALESCE(item->>'file_url', '') !~* '^https?:'
        AND split_part(item->>'file_url', '/', 2) <> p_conversation_id::TEXT
    ) THEN
      RAISE EXCEPTION 'Attachment does not belong to this conversation';
    END IF;
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
--   DROP POLICY IF EXISTS "Chat media owners can delete own objects" ON storage.objects;
--   DROP POLICY IF EXISTS "Chat media owners can update own objects" ON storage.objects;
--   DROP POLICY IF EXISTS "Authenticated participants upload chat media" ON storage.objects;
--   DROP POLICY IF EXISTS "Conversation participants read chat media" ON storage.objects;
--   DELETE FROM storage.buckets WHERE id = 'chat-media';
--   (restore send_conversation_message_v2 from 20260929100000_chat_realtime_features.sql)