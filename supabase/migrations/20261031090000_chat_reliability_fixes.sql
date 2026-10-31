-- DLXSTORE — DLX Chat reliability fixes (P1.2)
--
-- Code-only chat fixes ship with the P1.1 package. Two defects cannot be fixed in
-- application code because they are enforced by the database:
--
--   1. `forwarded_messages` only had a SELECT policy. The client records forward
--      attribution right after send_conversation_message() succeeds, so the INSERT
--      was refused by RLS and the forward silently lost its origin. The forwarded
--      text still arrived, which is exactly why this looked like it worked.
--
--   2. The private `chat-media` bucket allowlist omitted the audio types that the
--      voice-note recorder actually produces on Safari (`audio/mp4` / m4a) and some
--      Android recorders (`audio/aac`). The client accepts them, then Storage
--      rejects the upload, so voice notes fail on those devices only.
--
-- Ownership: DLX Chat (P1). Reviewer: repository owner.
-- Additive only: one new INSERT policy + one bucket allowlist replacement.
-- No table is dropped, no column removed, no existing policy loosened.
--
-- ROLLBACK:
--   DROP POLICY IF EXISTS "Senders can record their forwards" ON public.forwarded_messages;
--   REVOKE INSERT ON public.forwarded_messages FROM authenticated;
--   UPDATE storage.buckets
--      SET allowed_mime_types = ARRAY[
--        'image/jpeg','image/jpg','image/png','image/webp','image/gif',
--        'video/mp4','video/webm','video/ogg',
--        'audio/mpeg','audio/wav','audio/ogg','audio/webm',
--        'application/pdf','text/plain','application/msword',
--        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
--      ]
--    WHERE id = 'chat-media';
--
-- After rollback the app keeps working: forward attribution degrades to the
-- existing preview text prefix, and voice notes work on browsers emitting
-- webm/ogg (Chrome, Firefox, Edge).

-- ---------------------------------------------------------------------------
-- 1. Forward attribution: the sender of the forwarded copy may record the link.
-- ---------------------------------------------------------------------------
--
-- Both sides are checked, so a caller cannot attribute a forward to a message
-- they cannot read, nor claim a forwarded message they did not send.

DROP POLICY IF EXISTS "Senders can record their forwards" ON public.forwarded_messages;
CREATE POLICY "Senders can record their forwards"
  ON public.forwarded_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.messages m
      WHERE m.id = original_message_id
        AND public.can_access_conversation(m.conversation_id)
    )
    AND EXISTS (
      SELECT 1
      FROM public.messages m
      WHERE m.id = forwarded_message_id
        AND m.sender_id = auth.uid()
        AND public.can_access_conversation(m.conversation_id)
    )
  );

-- Explicit, idempotent and still gated by the policy above.
GRANT INSERT ON public.forwarded_messages TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. chat-media: accept the audio types real recorders emit.
-- ---------------------------------------------------------------------------
--
-- Replaces the allowlist rather than appending, so the value is deterministic on
-- re-run. It stays private and keeps the existing 10 MB limit.

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/webm', 'video/ogg',
  'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm',
  'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac',
  'application/pdf', 'text/plain', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]
WHERE id = 'chat-media';

-- Verification (run manually after applying):
--   select cmd, policyname from pg_policies
--    where schemaname='public' and tablename='forwarded_messages';
--   select allowed_mime_types from storage.buckets where id='chat-media';
