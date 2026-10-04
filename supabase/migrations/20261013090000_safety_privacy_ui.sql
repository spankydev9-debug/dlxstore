-- DLXSTORE — Safety & Privacy UI RPCs
--
-- ROADMAP Phase 16: Safety & Privacy
--
-- This migration adds RPCs for the safety/privacy tables that already exist
-- in 20260928102000_social_foundation.sql but have no write paths:
--   - profile_blocks (block/unblock)
--   - profile_restrictions (restrict/unrestrict)
--   - close_friends (add/remove)
--
-- It also adds a mute table and RPCs for muting chat conversations.
--
-- All RPCs are SECURITY DEFINER with explicit auth.uid() checks and grants
-- to authenticated only.
--
-- ============================================================================

-- ============================================================================
-- 1. Mute table for chat conversations
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.profile_mutes (
  muter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  muted_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (muter_id, muted_id),
  CHECK (muter_id <> muted_id)
);

CREATE INDEX IF NOT EXISTS profile_mutes_muted_idx ON public.profile_mutes (muted_id);

ALTER TABLE public.profile_mutes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own mutes" ON public.profile_mutes;
CREATE POLICY "Users manage their own mutes" ON public.profile_mutes
  FOR ALL USING (muter_id = auth.uid()) WITH CHECK (muter_id = auth.uid());

-- ============================================================================
-- 2. Helper function: check if muting
-- ============================================================================

CREATE OR REPLACE FUNCTION public.social_profiles_are_muted(p_a UUID, p_b UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profile_mutes
    WHERE (muter_id = p_a AND muted_id = p_b)
  );
$$;

-- Revoke to avoid broad platform defaults
REVOKE EXECUTE ON FUNCTION public.social_profiles_are_muted(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_profiles_are_muted(UUID, UUID) TO authenticated;

-- ============================================================================
-- 3. Block RPCs
-- ============================================================================

CREATE OR REPLACE FUNCTION public.block_profile(p_blocked_id UUID)
RETURNS BOOLEAN
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

  IF p_blocked_id IS NULL THEN
    RAISE EXCEPTION 'Target profile ID required';
  END IF;

  IF p_blocked_id = v_uid THEN
    RAISE EXCEPTION 'You cannot block yourself';
  END IF;

  INSERT INTO public.profile_blocks (blocker_id, blocked_id)
  VALUES (v_uid, p_blocked_id)
  ON CONFLICT (blocker_id, blocked_id) DO NOTHING;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.block_profile(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.block_profile(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.unblock_profile(p_blocked_id UUID)
RETURNS BOOLEAN
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

  IF p_blocked_id IS NULL THEN
    RAISE EXCEPTION 'Target profile ID required';
  END IF;

  DELETE FROM public.profile_blocks
  WHERE blocker_id = v_uid AND blocked_id = p_blocked_id;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.unblock_profile(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unblock_profile(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_blocked_profiles()
RETURNS TABLE (
  profile_id UUID,
  full_name TEXT,
  avatar_url TEXT,
  blocked_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.full_name,
    p.avatar_url,
    b.created_at AS blocked_at
  FROM public.profile_blocks b
  JOIN public.profiles p ON p.id = b.blocked_id
  WHERE b.blocker_id = auth.uid()
  ORDER BY b.created_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_blocked_profiles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_blocked_profiles() TO authenticated;

-- ============================================================================
-- 4. Restrict RPCs
-- ============================================================================

CREATE OR REPLACE FUNCTION public.restrict_profile(p_restricted_id UUID)
RETURNS BOOLEAN
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

  IF p_restricted_id IS NULL THEN
    RAISE EXCEPTION 'Target profile ID required';
  END IF;

  IF p_restricted_id = v_uid THEN
    RAISE EXCEPTION 'You cannot restrict yourself';
  END IF;

  INSERT INTO public.profile_restrictions (owner_id, restricted_id)
  VALUES (v_uid, p_restricted_id)
  ON CONFLICT (owner_id, restricted_id) DO NOTHING;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.restrict_profile(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restrict_profile(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.unrestrict_profile(p_restricted_id UUID)
RETURNS BOOLEAN
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

  IF p_restricted_id IS NULL THEN
    RAISE EXCEPTION 'Target profile ID required';
  END IF;

  DELETE FROM public.profile_restrictions
  WHERE owner_id = v_uid AND restricted_id = p_restricted_id;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.unrestrict_profile(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unrestrict_profile(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_restricted_profiles()
RETURNS TABLE (
  profile_id UUID,
  full_name TEXT,
  avatar_url TEXT,
  restricted_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.full_name,
    p.avatar_url,
    r.created_at AS restricted_at
  FROM public.profile_restrictions r
  JOIN public.profiles p ON p.id = r.restricted_id
  WHERE r.owner_id = auth.uid()
  ORDER BY r.created_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_restricted_profiles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_restricted_profiles() TO authenticated;

-- ============================================================================
-- 5. Close Friends RPCs
-- ============================================================================

CREATE OR REPLACE FUNCTION public.add_close_friend(p_profile_id UUID)
RETURNS BOOLEAN
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

  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'Target profile ID required';
  END IF;

  IF p_profile_id = v_uid THEN
    RAISE EXCEPTION 'You cannot add yourself as a close friend';
  END IF;

  INSERT INTO public.close_friends (owner_id, profile_id)
  VALUES (v_uid, p_profile_id)
  ON CONFLICT (owner_id, profile_id) DO NOTHING;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.add_close_friend(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_close_friend(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_close_friend(p_profile_id UUID)
RETURNS BOOLEAN
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

  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'Target profile ID required';
  END IF;

  DELETE FROM public.close_friends
  WHERE owner_id = v_uid AND profile_id = p_profile_id;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.remove_close_friend(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_close_friend(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_close_friends()
RETURNS TABLE (
  profile_id UUID,
  full_name TEXT,
  avatar_url TEXT,
  added_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.full_name,
    p.avatar_url,
    cf.created_at AS added_at
  FROM public.close_friends cf
  JOIN public.profiles p ON p.id = cf.profile_id
  WHERE cf.owner_id = auth.uid()
  ORDER BY cf.created_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_close_friends() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_close_friends() TO authenticated;

-- ============================================================================
-- 6. Mute RPCs
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mute_profile(p_muted_id UUID)
RETURNS BOOLEAN
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

  IF p_muted_id IS NULL THEN
    RAISE EXCEPTION 'Target profile ID required';
  END IF;

  IF p_muted_id = v_uid THEN
    RAISE EXCEPTION 'You cannot mute yourself';
  END IF;

  INSERT INTO public.profile_mutes (muter_id, muted_id)
  VALUES (v_uid, p_muted_id)
  ON CONFLICT (muter_id, muted_id) DO NOTHING;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mute_profile(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mute_profile(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.unmute_profile(p_muted_id UUID)
RETURNS BOOLEAN
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

  IF p_muted_id IS NULL THEN
    RAISE EXCEPTION 'Target profile ID required';
  END IF;

  DELETE FROM public.profile_mutes
  WHERE muter_id = v_uid AND muted_id = p_muted_id;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.unmute_profile(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unmute_profile(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_muted_profiles()
RETURNS TABLE (
  profile_id UUID,
  full_name TEXT,
  avatar_url TEXT,
  muted_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.full_name,
    p.avatar_url,
    m.created_at AS muted_at
  FROM public.profile_mutes m
  JOIN public.profiles p ON p.id = m.muted_id
  WHERE m.muter_id = auth.uid()
  ORDER BY m.created_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_muted_profiles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_muted_profiles() TO authenticated;

-- ============================================================================
-- 7. Reports table for abuse reporting
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.abuse_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reported_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  story_id UUID REFERENCES public.stories(id) ON DELETE CASCADE,
  report_type TEXT NOT NULL CHECK (report_type IN ('harassment', 'spam', 'inappropriate_content', 'fake_account', 'other')),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved', 'dismissed')),
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS abuse_reports_reporter_idx ON public.abuse_reports (reporter_id);
CREATE INDEX IF NOT EXISTS abuse_reports_reported_idx ON public.abuse_reports (reported_id);
CREATE INDEX IF NOT EXISTS abuse_reports_status_idx ON public.abuse_reports (status);

ALTER TABLE public.abuse_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users create their own reports" ON public.abuse_reports;
CREATE POLICY "Users create their own reports" ON public.abuse_reports
  FOR INSERT WITH CHECK (reporter_id = auth.uid());

DROP POLICY IF EXISTS "Users read their own reports" ON public.abuse_reports;
CREATE POLICY "Users read their own reports" ON public.abuse_reports
  FOR SELECT USING (reporter_id = auth.uid());

DROP POLICY IF EXISTS "Admins read all reports" ON public.abuse_reports;
CREATE POLICY "Admins read all reports" ON public.abuse_reports
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Admins update reports" ON public.abuse_reports;
CREATE POLICY "Admins update reports" ON public.abuse_reports
  FOR UPDATE USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- ============================================================================
-- 8. Profile search RPCs
-- ============================================================================

CREATE OR REPLACE FUNCTION public.search_profiles(p_query TEXT, p_limit INTEGER DEFAULT 20)
RETURNS TABLE (
  profile_id UUID,
  full_name TEXT,
  username TEXT,
  avatar_url TEXT,
  bio TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id AS profile_id,
    p.full_name,
    p.username,
    p.avatar_url,
    p.bio
  FROM public.profiles p
  WHERE
    p.id <> auth.uid()
    AND (
      p.full_name ILIKE ('%' || p_query || '%')
      OR p.username ILIKE ('%' || p_query || '%')
    )
    AND p.is_active = true
    -- Blocking has to be symmetric (the helper checks both directions), and a
    -- block must actually remove someone from search results -- otherwise the
    -- block feature shipped in this same migration is trivially defeated by
    -- typing the name into the search box.
    AND (auth.uid() IS NULL OR NOT public.social_profiles_are_blocked(auth.uid(), p.id))
  ORDER BY
    CASE
      WHEN p.full_name ILIKE (p_query || '%') THEN 1
      WHEN p.username ILIKE (p_query || '%') THEN 2
      ELSE 3
    END,
    p.full_name
  LIMIT p_limit;
$$;

REVOKE EXECUTE ON FUNCTION public.search_profiles(TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_profiles(TEXT, INTEGER) TO authenticated;

-- ============================================================================
-- 10. Friend suggestions RPCs
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_friend_suggestions(p_limit INTEGER DEFAULT 10)
RETURNS TABLE (
  profile_id UUID,
  full_name TEXT,
  username TEXT,
  avatar_url TEXT,
  mutual_friends_count INTEGER
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id AS profile_id,
    p.full_name,
    p.username,
    p.avatar_url,
    COALESCE(mutual.count, 0) AS mutual_friends_count
  FROM public.profiles p
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS count
    FROM public.friendships f1
    JOIN public.friendships f2 ON
      (f1.profile_low_id = f2.profile_low_id AND f1.profile_high_id = f2.profile_high_id)
      OR (f1.profile_low_id = f2.profile_high_id AND f1.profile_high_id = f2.profile_low_id)
    WHERE
      (f1.profile_low_id = auth.uid() OR f1.profile_high_id = auth.uid())
      AND (f2.profile_low_id = p.id OR f2.profile_high_id = p.id)
  ) mutual ON true
  WHERE
    p.id <> auth.uid()
    AND p.is_active = true
    AND NOT EXISTS (
      SELECT 1 FROM public.friendships f
      WHERE (f.profile_low_id = auth.uid() AND f.profile_high_id = p.id)
         OR (f.profile_low_id = p.id AND f.profile_high_id = auth.uid())
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.friend_requests fr
      WHERE (fr.sender_id = auth.uid() AND fr.recipient_id = p.id)
         OR (fr.sender_id = p.id AND fr.recipient_id = auth.uid())
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.profile_blocks b
      WHERE (b.blocker_id = auth.uid() AND b.blocked_id = p.id)
         OR (b.blocker_id = p.id AND b.blocked_id = auth.uid())
    )
  ORDER BY mutual.count DESC NULLS LAST, p.full_name
  LIMIT p_limit;
$$;

REVOKE EXECUTE ON FUNCTION public.get_friend_suggestions(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_friend_suggestions(INTEGER) TO authenticated;

-- ============================================================================
-- 12. Profile update RPCs
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_my_profile(
  p_full_name TEXT,
  p_phone TEXT,
  p_username TEXT DEFAULT NULL,
  p_bio TEXT DEFAULT NULL
)
RETURNS BOOLEAN
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

  IF p_full_name IS NULL OR p_full_name = '' THEN
    RAISE EXCEPTION 'Full name is required';
  END IF;

  -- Check username uniqueness if provided
  IF p_username IS NOT NULL AND p_username != '' THEN
    IF EXISTS (
      SELECT 1 FROM public.profiles
      WHERE username = p_username AND id <> v_uid
    ) THEN
      RAISE EXCEPTION 'Username already taken';
    END IF;
  END IF;

  UPDATE public.profiles
  SET
    full_name = p_full_name,
    phone = p_phone,
    username = CASE WHEN p_username = '' THEN NULL ELSE p_username END,
    bio = CASE WHEN p_bio = '' THEN NULL ELSE p_bio END,
    updated_at = timezone('utc', now())
  WHERE id = v_uid;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_my_profile(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_my_profile(TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ============================================================================
-- 14. Privacy Settings RPCs
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_my_privacy_settings(
  p_is_private BOOLEAN DEFAULT NULL,
  p_allow_messages_from TEXT DEFAULT NULL,
  p_allow_follows_from TEXT DEFAULT NULL
)
RETURNS BOOLEAN
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

  IF p_allow_messages_from IS NOT NULL AND p_allow_messages_from NOT IN ('everyone', 'followers', 'none') THEN
    RAISE EXCEPTION 'Invalid message preference';
  END IF;

  IF p_allow_follows_from IS NOT NULL AND p_allow_follows_from NOT IN ('everyone', 'none') THEN
    RAISE EXCEPTION 'Invalid follow preference';
  END IF;

  UPDATE public.profiles
  SET
    is_private = COALESCE(p_is_private, is_private),
    allow_messages_from = COALESCE(p_allow_messages_from, allow_messages_from),
    allow_follows_from = COALESCE(p_allow_follows_from, allow_follows_from),
    updated_at = timezone('utc', now())
  WHERE id = v_uid;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_my_privacy_settings(BOOLEAN, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_my_privacy_settings(BOOLEAN, TEXT, TEXT) TO authenticated;

-- Add privacy columns to profiles if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'allow_messages_from'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN allow_messages_from TEXT DEFAULT 'everyone';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'allow_follows_from'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN allow_follows_from TEXT DEFAULT 'everyone';
  END IF;
END $$;

-- ============================================================================
-- 15. Report RPCs
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_abuse_report(
  p_reported_id UUID,
  p_story_id UUID,
  p_report_type TEXT,
  p_description TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_report_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_reported_id IS NULL AND p_story_id IS NULL THEN
    RAISE EXCEPTION 'Either reported_id or story_id is required';
  END IF;

  IF p_report_type IS NULL THEN
    RAISE EXCEPTION 'Report type is required';
  END IF;

  INSERT INTO public.abuse_reports (reporter_id, reported_id, story_id, report_type, description)
  VALUES (v_uid, p_reported_id, p_story_id, p_report_type, p_description)
  RETURNING id INTO v_report_id;

  RETURN v_report_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_abuse_report(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_abuse_report(UUID, UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_reports()
RETURNS TABLE (
  id UUID,
  reported_id UUID,
  story_id UUID,
  report_type TEXT,
  description TEXT,
  status TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    id,
    reported_id,
    story_id,
    report_type,
    description,
    status,
    created_at
  FROM public.abuse_reports
  WHERE reporter_id = auth.uid()
  ORDER BY created_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_reports() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_reports() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_reports(p_status TEXT DEFAULT NULL)
RETURNS TABLE (
  id UUID,
  reporter_id UUID,
  reported_id UUID,
  story_id UUID,
  report_type TEXT,
  description TEXT,
  status TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.id,
    r.reporter_id,
    r.reported_id,
    r.story_id,
    r.report_type,
    r.description,
    r.status,
    r.created_at
  FROM public.abuse_reports r
  -- SECURITY DEFINER + GRANT to authenticated meant ANY signed-in customer could
  -- dump the whole abuse_reports table: who reported whom, story ids and the
  -- free-text descriptions. The admin check has to live here, not only in the
  -- React admin screen, because a client-side check is not an authorization
  -- boundary. Matches the guard style used by admin_update_report_status.
  WHERE public.is_admin()
    AND (p_status IS NULL OR r.status = p_status)
  ORDER BY r.created_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_get_reports(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_reports(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_report_status(
  p_report_id UUID,
  p_status TEXT
)
RETURNS BOOLEAN
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

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND role = 'admin') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  UPDATE public.abuse_reports
  SET status = p_status,
      reviewed_by = v_uid,
      reviewed_at = timezone('utc', now())
  WHERE id = p_report_id;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_update_report_status(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_report_status(UUID, TEXT) TO authenticated;

-- ============================================================================
-- ROLLBACK NOTES
-- ============================================================================
-- To rollback this migration:
-- 1. DROP FUNCTION IF EXISTS public.admin_update_report_status(UUID, TEXT);
-- 2. DROP FUNCTION IF EXISTS public.admin_get_reports(TEXT);
-- 3. DROP FUNCTION IF EXISTS public.get_my_reports();
-- 4. DROP FUNCTION IF EXISTS public.create_abuse_report(UUID, UUID, TEXT, TEXT);
-- 5. DROP TABLE IF EXISTS public.abuse_reports;
-- 6. DROP FUNCTION IF EXISTS public.get_muted_profiles();
-- 7. DROP FUNCTION IF EXISTS public.unmute_profile(UUID);
-- 8. DROP FUNCTION IF EXISTS public.mute_profile(UUID);
-- 9. DROP FUNCTION IF EXISTS public.get_close_friends();
-- 10. DROP FUNCTION IF EXISTS public.remove_close_friend(UUID);
-- 11. DROP FUNCTION IF EXISTS public.add_close_friend(UUID);
-- 12. DROP FUNCTION IF EXISTS public.get_restricted_profiles();
-- 13. DROP FUNCTION IF EXISTS public.unrestrict_profile(UUID);
-- 14. DROP FUNCTION IF EXISTS public.restrict_profile(UUID);
-- 15. DROP FUNCTION IF EXISTS public.get_blocked_profiles();
-- 16. DROP FUNCTION IF EXISTS public.unblock_profile(UUID);
-- 17. DROP FUNCTION IF EXISTS public.block_profile(UUID);
-- 18. DROP FUNCTION IF EXISTS public.social_profiles_are_muted(UUID, UUID);
-- 19. DROP TABLE IF EXISTS public.profile_mutes;
-- 20. DROP FUNCTION IF EXISTS public.get_friend_suggestions(INTEGER);
-- 21. DROP FUNCTION IF EXISTS public.search_profiles(TEXT, INTEGER);
-- 22. DROP FUNCTION IF EXISTS public.update_my_profile(TEXT, TEXT, TEXT, TEXT);
