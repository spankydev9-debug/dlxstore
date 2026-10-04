-- DLXSTORE — friend graph core: lifecycle completion + read paths + notifications
--
-- Completes ROADMAP Phase 8 ("DLX Friend system") for the *core friend graph*
-- only. The social tables and the four write RPCs already exist in
-- `20260928102000_social_foundation.sql`:
--   tables  : follows, friend_requests, friendships, profile_blocks,
--             profile_restrictions, close_friends
--   RPCs    : follow_profile, unfollow_profile, send_friend_request,
--             respond_to_friend_request
--
-- This migration adds only what is genuinely missing:
--   1. remove_friend            — friendships had a SELECT policy only
--   2. cancel_friend_request    — the 'cancelled' status was unwritable
--   3. get_my_friends           — no read path existed
--   4. get_my_followers         — no read path existed
--   5. get_my_following         — no read path existed
--   6. get_my_friend_requests   — no read path existed
--   7. friend-request notifications (DB triggers)
--
-- Deliberately OUT OF SCOPE for this pass (see docs/CHECKPOINT-F3-FRIENDS.md):
-- block/unblock UI, mute, restrict, close friends, user search, friend
-- suggestions, username claiming, public profile URLs, avatars, QR sharing.
-- `profile_blocks` / `profile_restrictions` / `close_friends` are left untouched.
--
-- WHY EVERY READ IS A SECURITY DEFINER RPC
-- ---------------------------------------
-- `profiles` has no policy allowing a customer to read another customer
-- (20260823143000_fix_profiles_rls_recursion.sql:25-29 is self-or-admin). A
-- friends list joined to `profiles` therefore returns nothing for a normal
-- customer. Rather than reopening `profiles` to everyone, these functions expose
-- a hand-picked, deliberately minimal column list — the same approach as the
-- existing `list_staff_profiles()` directory RPC. Email, phone, role and
-- last_seen_at are never returned.
--
-- BLOCKS ARE ENFORCED ON READ
-- ---------------------------
-- No RLS policy on follows/friendships/friend_requests filters blocked users;
-- only three individual write RPCs check. Every read below filters both
-- directions, so a blocked pair disappears from both people's lists at once.
--
-- PRE-APPLICATION REQUIREMENTS
-- ----------------------------
-- 1. Review the remote migration history and obtain explicit approval.
-- 2. Additive and idempotent: no data is rewritten, moved or deleted.
-- 3. Depends on the applied objects of `20260928102000_social_foundation.sql`
--    and `20260928100000_notification_security_and_realtime.sql`. If
--    `20260928102000` is NOT applied, this file will fail — apply it first.
--
-- NOTE ON NOTIFICATION LANGUAGE
-- -----------------------------
-- Notification title/message are written in French, matching the existing
-- `notify_on_new_order()` trigger. The notifications table has no language
-- column, so this follows the established convention rather than inventing one.

-- ============================================================================
-- 1. remove_friend
-- ============================================================================
-- Unfriends two profiles. The friendship is a normalised pair, so the delete
-- must match on the LEAST/GREATEST ordering, not on column names.
CREATE OR REPLACE FUNCTION public.remove_friend(p_profile_id UUID)
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
    RAISE EXCEPTION 'Invalid friend target';
  END IF;

  IF p_profile_id = v_uid THEN
    RAISE EXCEPTION 'Invalid friend target';
  END IF;

  DELETE FROM public.friendships
  WHERE profile_low_id = LEAST(v_uid, p_profile_id)
    AND profile_high_id = GREATEST(v_uid, p_profile_id);

  RETURN FOUND;
END;
$$;

-- ============================================================================
-- 2. cancel_friend_request
-- ============================================================================
-- The sender withdraws their own pending request. The 'cancelled' status existed
-- in the CHECK constraint but nothing could write it.
CREATE OR REPLACE FUNCTION public.cancel_friend_request(p_request_id UUID)
RETURNS public.friend_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.friend_requests;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'Invalid friend request';
  END IF;

  -- Only the sender may withdraw, and only while it is still pending. A request
  -- already accepted or declined is immutable here; use remove_friend instead.
  SELECT * INTO v_request
  FROM public.friend_requests
  WHERE id = p_request_id
    AND sender_id = auth.uid()
    AND status = 'pending'
  FOR UPDATE;

  IF v_request.id IS NULL THEN
    RAISE EXCEPTION 'Friend request is unavailable';
  END IF;

  UPDATE public.friend_requests
  SET status = 'cancelled',
      responded_at = timezone('utc', now())
  WHERE id = v_request.id
  RETURNING * INTO v_request;

  RETURN v_request;
END;
$$;

-- ============================================================================
-- 3. get_my_friends
-- ============================================================================
-- Friendship rows store a normalised pair, so the other party is whichever of
-- profile_low_id / profile_high_id is not the caller.
CREATE OR REPLACE FUNCTION public.get_my_friends()
RETURNS TABLE (
  id UUID,
  username TEXT,
  full_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  friends_since TIMESTAMPTZ
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
  SELECT p.id,
         p.username,
         p.full_name,
         p.avatar_url,
         p.bio,
         f.created_at
  FROM public.friendships f
  JOIN public.profiles p
    ON p.id = CASE
                WHEN f.profile_low_id = v_uid THEN f.profile_high_id
                ELSE f.profile_low_id
              END
  WHERE (f.profile_low_id = v_uid OR f.profile_high_id = v_uid)
    AND NOT public.social_profiles_are_blocked(v_uid, p.id)
  ORDER BY p.full_name, p.id;
END;
$$;

-- ============================================================================
-- 4. get_my_followers
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_my_followers()
RETURNS TABLE (
  id UUID,
  username TEXT,
  full_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  followed_since TIMESTAMPTZ
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
  SELECT p.id,
         p.username,
         p.full_name,
         p.avatar_url,
         p.bio,
         f.created_at
  FROM public.follows f
  JOIN public.profiles p ON p.id = f.follower_id
  WHERE f.following_id = v_uid
    AND NOT public.social_profiles_are_blocked(v_uid, p.id)
  ORDER BY p.full_name, p.id;
END;
$$;

-- ============================================================================
-- 5. get_my_following
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_my_following()
RETURNS TABLE (
  id UUID,
  username TEXT,
  full_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  followed_since TIMESTAMPTZ
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
  SELECT p.id,
         p.username,
         p.full_name,
         p.avatar_url,
         p.bio,
         f.created_at
  FROM public.follows f
  JOIN public.profiles p ON p.id = f.following_id
  WHERE f.follower_id = v_uid
    AND NOT public.social_profiles_are_blocked(v_uid, p.id)
  ORDER BY p.full_name, p.id;
END;
$$;

-- ============================================================================
-- 6. get_my_friend_requests
-- ============================================================================
-- One call returns both directions, with `direction` telling the UI which side
-- the caller is on. Only 'pending' requests are returned; history stays in the
-- table for audit and is not surfaced in this pass.
CREATE OR REPLACE FUNCTION public.get_my_friend_requests()
RETURNS TABLE (
  request_id UUID,
  direction TEXT,
  profile_id UUID,
  username TEXT,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ
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
  SELECT r.id,
         (CASE WHEN r.recipient_id = v_uid THEN 'incoming' ELSE 'outgoing' END)::TEXT,
         p.id,
         p.username,
         p.full_name,
         p.avatar_url,
         r.created_at
  FROM public.friend_requests r
  JOIN public.profiles p
    ON p.id = CASE
                WHEN r.sender_id = v_uid THEN r.recipient_id
                ELSE r.sender_id
              END
  WHERE (r.sender_id = v_uid OR r.recipient_id = v_uid)
    AND r.status = 'pending'
    AND NOT public.social_profiles_are_blocked(v_uid, p.id)
  ORDER BY r.created_at DESC;
END;
$$;

-- ============================================================================
-- 7. Notifications
-- ============================================================================
-- `notifications` has no INSERT policy for authenticated users on purpose:
-- database triggers running as SECURITY DEFINER are the only normal write path
-- (20260928100000:48-50). Without these triggers a friend request is silent.

-- A new pending request notifies the recipient.
CREATE OR REPLACE FUNCTION public.notify_on_friend_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender RECORD;
BEGIN
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT id, full_name, username INTO v_sender
  FROM public.profiles
  WHERE id = NEW.sender_id;

  INSERT INTO public.notifications (user_id, actor_id, entity_type, entity_id, title, message, type, data)
  VALUES (
    NEW.recipient_id,
    NEW.sender_id,
    'friend_request',
    NEW.id,
    'Nouvelle demande d''ami',
    COALESCE(v_sender.full_name, 'Un membre') || ' vous a envoyé une demande d''ami.',
    'friend_request',
    jsonb_build_object(
      'request_id', NEW.id,
      'sender_id', NEW.sender_id,
      'sender_name', v_sender.full_name
    )
  );

  RETURN NEW;
END;
$$;

-- Accepting a request notifies the sender, so both sides learn the outcome.
CREATE OR REPLACE FUNCTION public.notify_on_friend_request_accepted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipient RECORD;
BEGIN
  IF NEW.status <> 'accepted' OR OLD.status = 'accepted' THEN
    RETURN NEW;
  END IF;

  SELECT id, full_name, username INTO v_recipient
  FROM public.profiles
  WHERE id = NEW.recipient_id;

  INSERT INTO public.notifications (user_id, actor_id, entity_type, entity_id, title, message, type, data)
  VALUES (
    NEW.sender_id,
    NEW.recipient_id,
    'friend_request',
    NEW.id,
    'Demande d''ami acceptée',
    COALESCE(v_recipient.full_name, 'Un membre') || ' a accepté votre demande d''ami.',
    'friend_accepted',
    jsonb_build_object(
      'request_id', NEW.id,
      'recipient_id', NEW.recipient_id,
      'recipient_name', v_recipient.full_name
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "Notify recipients of new friend requests" ON public.friend_requests;
CREATE TRIGGER "Notify recipients of new friend requests"
  AFTER INSERT ON public.friend_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_friend_request();

DROP TRIGGER IF EXISTS "Notify senders when a friend request is accepted" ON public.friend_requests;
CREATE TRIGGER "Notify senders when a friend request is accepted"
  AFTER UPDATE OF status ON public.friend_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_friend_request_accepted();

-- ============================================================================
-- Grants
-- ============================================================================
REVOKE ALL ON FUNCTION public.remove_friend(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_friend_request(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_friends() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_followers() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_following() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_friend_requests() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.remove_friend(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_friend_request(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_friends() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_followers() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_following() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_friend_requests() TO authenticated;

-- Trigger functions are invoked by the trigger, never called directly.
REVOKE ALL ON FUNCTION public.notify_on_friend_request() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_on_friend_request_accepted() FROM PUBLIC;

-- ============================================================================
-- REVERSIBLE (rollback)
--   DROP TRIGGER IF EXISTS "Notify senders when a friend request is accepted" ON public.friend_requests;
--   DROP TRIGGER IF EXISTS "Notify recipients of new friend requests" ON public.friend_requests;
--   DROP FUNCTION IF EXISTS public.notify_on_friend_request_accepted();
--   DROP FUNCTION IF EXISTS public.notify_on_friend_request();
--   DROP FUNCTION IF EXISTS public.get_my_friend_requests();
--   DROP FUNCTION IF EXISTS public.get_my_following();
--   DROP FUNCTION IF EXISTS public.get_my_followers();
--   DROP FUNCTION IF EXISTS public.get_my_friends();
--   DROP FUNCTION IF EXISTS public.cancel_friend_request(UUID);
--   DROP FUNCTION IF EXISTS public.remove_friend(UUID);
--
-- This migration creates no tables and rewrites no rows, so a rollback is just
-- dropping the functions and triggers above.
-- ============================================================================
