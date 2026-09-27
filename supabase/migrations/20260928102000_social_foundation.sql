-- DLXSTORE — social graph and stories foundation
--
-- PRE-APPLICATION REQUIREMENT
-- ---------------------------
-- Apply only after the remote migration history has been audited. This is an
-- additive foundation for the Social agent; it does not seed fake accounts,
-- stories, relationships, or operating activity.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username TEXT,
  ADD COLUMN IF NOT EXISTS bio TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_unique_idx
  ON public.profiles (lower(username))
  WHERE username IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.follows (
  follower_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);

CREATE INDEX IF NOT EXISTS follows_following_created_idx
  ON public.follows (following_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.friend_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  responded_at TIMESTAMPTZ,
  CHECK (sender_id <> recipient_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS friend_requests_pending_pair_idx
  ON public.friend_requests (sender_id, recipient_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS friend_requests_recipient_status_idx
  ON public.friend_requests (recipient_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.friendships (
  profile_low_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  profile_high_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (profile_low_id, profile_high_id),
  CHECK (profile_low_id < profile_high_id)
);

CREATE INDEX IF NOT EXISTS friendships_high_idx ON public.friendships (profile_high_id);

CREATE TABLE IF NOT EXISTS public.profile_blocks (
  blocker_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE TABLE IF NOT EXISTS public.profile_restrictions (
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  restricted_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (owner_id, restricted_id),
  CHECK (owner_id <> restricted_id)
);

CREATE TABLE IF NOT EXISTS public.close_friends (
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (owner_id, profile_id),
  CHECK (owner_id <> profile_id)
);

CREATE TABLE IF NOT EXISTS public.stories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video', 'text')),
  storage_object_path TEXT,
  text_content TEXT,
  background_color TEXT,
  visibility TEXT NOT NULL DEFAULT 'followers' CHECK (visibility IN ('public', 'followers', 'close_friends')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()) + INTERVAL '24 hours',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  archived_at TIMESTAMPTZ,
  CHECK (
    (media_type = 'text' AND text_content IS NOT NULL)
    OR (media_type IN ('image', 'video') AND storage_object_path IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS stories_profile_active_idx
  ON public.stories (profile_id, expires_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS stories_active_idx
  ON public.stories (expires_at DESC)
  WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS public.story_viewers (
  story_id UUID NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  viewer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (story_id, viewer_id)
);

CREATE TABLE IF NOT EXISTS public.story_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id UUID NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL CHECK (char_length(emoji) BETWEEN 1 AND 32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (story_id, profile_id, emoji)
);

CREATE TABLE IF NOT EXISTS public.story_mentions (
  story_id UUID NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  mentioned_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (story_id, mentioned_profile_id)
);

ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friend_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_restrictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.close_friends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_viewers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_mentions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_view_story(p_story_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.stories s
    JOIN public.profiles owner ON owner.id = s.profile_id
    WHERE s.id = p_story_id
      AND (s.expires_at > now() OR s.archived_at IS NOT NULL)
      AND NOT EXISTS (
        SELECT 1 FROM public.profile_blocks b
        WHERE (b.blocker_id = s.profile_id AND b.blocked_id = auth.uid())
           OR (b.blocker_id = auth.uid() AND b.blocked_id = s.profile_id)
      )
      AND (
        s.profile_id = auth.uid()
        OR s.visibility = 'public'
        OR (s.visibility = 'followers' AND EXISTS (
          SELECT 1 FROM public.follows f
          WHERE f.follower_id = auth.uid() AND f.following_id = s.profile_id
        ))
        OR (s.visibility = 'close_friends' AND EXISTS (
          SELECT 1 FROM public.close_friends cf
          WHERE cf.owner_id = s.profile_id AND cf.profile_id = auth.uid()
        ))
      )
  );
$$;

CREATE POLICY "Users can read their own social relationships" ON public.follows
  FOR SELECT USING (follower_id = auth.uid() OR following_id = auth.uid());
CREATE POLICY "Users can follow from their own account" ON public.follows
  FOR INSERT WITH CHECK (follower_id = auth.uid());
CREATE POLICY "Users can unfollow from their own account" ON public.follows
  FOR DELETE USING (follower_id = auth.uid());

CREATE POLICY "Participants can read friend requests" ON public.friend_requests
  FOR SELECT USING (sender_id = auth.uid() OR recipient_id = auth.uid());
CREATE POLICY "Users can send their own friend requests" ON public.friend_requests
  FOR INSERT WITH CHECK (sender_id = auth.uid());
CREATE POLICY "Participants can update friend requests" ON public.friend_requests
  FOR UPDATE USING (sender_id = auth.uid() OR recipient_id = auth.uid())
  WITH CHECK (sender_id = auth.uid() OR recipient_id = auth.uid());

CREATE POLICY "Friends can read their friendships" ON public.friendships
  FOR SELECT USING (profile_low_id = auth.uid() OR profile_high_id = auth.uid());

CREATE POLICY "Users manage their own blocks" ON public.profile_blocks
  FOR ALL USING (blocker_id = auth.uid()) WITH CHECK (blocker_id = auth.uid());
CREATE POLICY "Users manage their own restrictions" ON public.profile_restrictions
  FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "Users manage their close-friends list" ON public.close_friends
  FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Story viewers can read allowed active stories" ON public.stories
  FOR SELECT USING (public.can_view_story(id));
CREATE POLICY "Users create their own stories" ON public.stories
  FOR INSERT WITH CHECK (profile_id = auth.uid());
CREATE POLICY "Users manage their own stories" ON public.stories
  FOR UPDATE USING (profile_id = auth.uid()) WITH CHECK (profile_id = auth.uid());
CREATE POLICY "Users delete their own stories" ON public.stories
  FOR DELETE USING (profile_id = auth.uid());

CREATE POLICY "Story owners and viewers can read viewers" ON public.story_viewers
  FOR SELECT USING (
    viewer_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.stories s WHERE s.id = story_viewers.story_id AND s.profile_id = auth.uid()
    )
  );
CREATE POLICY "Allowed users record their own story view" ON public.story_viewers
  FOR INSERT WITH CHECK (viewer_id = auth.uid() AND public.can_view_story(story_id));

CREATE POLICY "Story owners and allowed viewers read reactions" ON public.story_reactions
  FOR SELECT USING (public.can_view_story(story_id));
CREATE POLICY "Allowed users react as themselves" ON public.story_reactions
  FOR INSERT WITH CHECK (profile_id = auth.uid() AND public.can_view_story(story_id));
CREATE POLICY "Users remove their own reactions" ON public.story_reactions
  FOR DELETE USING (profile_id = auth.uid());

CREATE POLICY "Story owners and allowed viewers read mentions" ON public.story_mentions
  FOR SELECT USING (public.can_view_story(story_id));
CREATE POLICY "Story owners can create mentions" ON public.story_mentions
  FOR INSERT WITH CHECK (EXISTS (
    SELECT 1 FROM public.stories s WHERE s.id = story_mentions.story_id AND s.profile_id = auth.uid()
  ));

-- Follow and friendship transitions are RPC-only so a block check and the
-- friendship pair are always evaluated atomically rather than trusted to UI.
DROP POLICY IF EXISTS "Users can follow from their own account" ON public.follows;
DROP POLICY IF EXISTS "Users can unfollow from their own account" ON public.follows;
DROP POLICY IF EXISTS "Users can send their own friend requests" ON public.friend_requests;
DROP POLICY IF EXISTS "Participants can update friend requests" ON public.friend_requests;

CREATE OR REPLACE FUNCTION public.social_profiles_are_blocked(p_a UUID, p_b UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profile_blocks
    WHERE (blocker_id = p_a AND blocked_id = p_b)
       OR (blocker_id = p_b AND blocked_id = p_a)
  );
$$;

CREATE OR REPLACE FUNCTION public.follow_profile(p_target_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_target_id IS NULL OR p_target_id = auth.uid() THEN
    RAISE EXCEPTION 'Invalid follow target';
  END IF;
  IF public.social_profiles_are_blocked(auth.uid(), p_target_id) THEN
    RAISE EXCEPTION 'This relationship is unavailable';
  END IF;
  INSERT INTO public.follows (follower_id, following_id)
  VALUES (auth.uid(), p_target_id)
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.unfollow_profile(p_target_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  DELETE FROM public.follows
  WHERE follower_id = auth.uid() AND following_id = p_target_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_friend_request(p_recipient_id UUID)
RETURNS public.friend_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.friend_requests;
BEGIN
  IF auth.uid() IS NULL OR p_recipient_id IS NULL OR p_recipient_id = auth.uid() THEN
    RAISE EXCEPTION 'Invalid friend request recipient';
  END IF;
  IF public.social_profiles_are_blocked(auth.uid(), p_recipient_id) THEN
    RAISE EXCEPTION 'This relationship is unavailable';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.friendships
    WHERE profile_low_id = LEAST(auth.uid(), p_recipient_id)
      AND profile_high_id = GREATEST(auth.uid(), p_recipient_id)
  ) THEN
    RAISE EXCEPTION 'Profiles are already friends';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.friend_requests
    WHERE status = 'pending'
      AND sender_id = p_recipient_id
      AND recipient_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'A friend request from this profile is already pending';
  END IF;
  INSERT INTO public.friend_requests (sender_id, recipient_id)
  VALUES (auth.uid(), p_recipient_id)
  ON CONFLICT (sender_id, recipient_id) WHERE status = 'pending'
  DO UPDATE SET created_at = EXCLUDED.created_at
  RETURNING * INTO v_request;
  RETURN v_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_to_friend_request(
  p_request_id UUID,
  p_accept BOOLEAN
)
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
  SELECT * INTO v_request
  FROM public.friend_requests
  WHERE id = p_request_id AND recipient_id = auth.uid() AND status = 'pending'
  FOR UPDATE;
  IF v_request.id IS NULL THEN
    RAISE EXCEPTION 'Friend request is unavailable';
  END IF;
  IF public.social_profiles_are_blocked(v_request.sender_id, v_request.recipient_id) THEN
    RAISE EXCEPTION 'This relationship is unavailable';
  END IF;
  UPDATE public.friend_requests
  SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END,
      responded_at = now()
  WHERE id = v_request.id
  RETURNING * INTO v_request;
  IF p_accept THEN
    INSERT INTO public.friendships (profile_low_id, profile_high_id)
    VALUES (LEAST(v_request.sender_id, v_request.recipient_id), GREATEST(v_request.sender_id, v_request.recipient_id))
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN v_request;
END;
$$;

REVOKE ALL ON FUNCTION public.can_view_story(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.social_profiles_are_blocked(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.follow_profile(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unfollow_profile(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_friend_request(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.respond_to_friend_request(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_story(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.follow_profile(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unfollow_profile(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_friend_request(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_friend_request(UUID, BOOLEAN) TO authenticated;
