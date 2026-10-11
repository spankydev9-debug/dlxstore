-- DLXSTORE — make send_conversation_message_v2 tolerant of stringified media
--
-- The web client used to call this RPC with p_media = JSON.stringify(items),
-- i.e. a JSON *string*.  PostgREST delivered it as a jsonb string scalar, and
-- line "FOR v_media_item IN SELECT * FROM jsonb_array_elements(p_media)" raised
--     ERROR: 22023 cannot extract elements from a scalar
-- whenever a photo was sent with a caption.
--
-- The client now sends a real JSON array (chat-realtime.ts / chat-media.ts), but
-- older cached bundles may still send a string.  Coerce a JSON string into its
-- parsed value, and only iterate when the value really is a JSON array.

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
  v_media JSONB := p_media;
  v_has_media BOOLEAN;
  v_msg public.messages;
  v_sender RECORD;
  v_media_item JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Legacy tolerance: accept a JSON string that encodes a JSON array/object.
  IF v_media IS NOT NULL AND jsonb_typeof(v_media) = 'string' THEN
    BEGIN
      v_media := (v_media #>> '{}')::JSONB;
    EXCEPTION WHEN others THEN
      v_media := NULL;
    END;
  END IF;

  v_has_media := v_media IS NOT NULL AND jsonb_typeof(v_media) = 'array' AND jsonb_array_length(v_media) > 0;

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
      FROM jsonb_array_elements(v_media) AS item
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

  -- Add media attachments if provided (only when it really is a JSON array)
  IF v_has_media THEN
    FOR v_media_item IN SELECT * FROM jsonb_array_elements(v_media)
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

-- CREATE OR REPLACE preserves the existing ACLs (PUBLIC, anon, authenticated,
-- service_role all retain EXECUTE), so no GRANT/REVOKE is needed here.
