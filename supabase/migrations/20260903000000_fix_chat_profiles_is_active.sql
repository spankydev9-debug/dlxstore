-- DLXSTORE — Corrective fix: remove invalid profiles.is_active dependency
-- ---------------------------------------------------------------------------
-- The chat foundation migration (20260829080000) is already applied remotely
-- and its SECURITY DEFINER RPCs referenced a profiles.is_active column that
-- does not exist anywhere in the schema. That made "contact support -> start a
-- conversation" fail at runtime with: column p.is_active does not exist.
--
-- This corrective migration redefines ONLY the affected functions and strips
-- the invalid filter. All role checks, ownership/security behaviour, ordering,
-- conflict handling, SECURITY DEFINER and SET search_path are preserved.
-- No column is added: the architecture never required profiles.is_active.
-- Idempotent (CREATE OR REPLACE), safe to re-run.

-- 1. Customer support conversation lookup/create
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
  WHERE p.role = 'admin' AND p.id <> v_uid
  ORDER BY p.created_at ASC
  LIMIT 1
  ON CONFLICT DO NOTHING;

  RETURN v_conv;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_or_create_customer_support_conversation(UUID) TO authenticated;

-- 2. Staff: create an internal conversation with chosen staff/admin participants
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
        WHERE id = v_id AND role IN ('admin', 'staff')
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

GRANT EXECUTE ON FUNCTION public.create_internal_conversation(TEXT, UUID[]) TO authenticated;

-- 3. Staff: add a staff/admin member to a conversation
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
    WHERE id = p_profile_id AND role IN ('admin', 'staff')
  )
  ON CONFLICT DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_conversation_participant(UUID, UUID) TO authenticated;

-- 4. Staff directory for the internal chat participant picker
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
  WHERE p.role IN ('admin', 'staff')
  ORDER BY p.full_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_staff_profiles() TO authenticated;