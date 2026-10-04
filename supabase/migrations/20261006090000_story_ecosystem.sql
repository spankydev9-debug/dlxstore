-- DLXSTORE — Stories ecosystem (ROADMAP Phase 5)
--
-- PRE-APPLICATION REQUIREMENTS
-- ----------------------------
-- 1. Read the remote migration ledger and obtain explicit operator approval.
-- 2. Requires `20260928102000_social_foundation.sql` to be present. That
--    migration owns `stories`, `story_viewers`, `story_reactions`,
--    `story_mentions` and `can_view_story()`. This file **reuses all of them**
--    and creates no competing story table.
-- 3. Additive and idempotent. No row is rewritten, moved or deleted. The only
--    pre-existing object this file changes is the body of `can_view_story()`
--    (see §2) plus one appended read path for tagged products.
--
-- WHAT WAS GENUINELY MISSING
-- --------------------------
-- The social foundation created the story tables and their RLS policies but
-- shipped no consumer code and left four real holes:
--   a. `stories` had no product linkage, so "product stories", "outfit stories"
--      and "direct product links" were impossible.
--   b. `can_view_story()` treated `archived_at IS NOT NULL` as visible to
--      everyone who passed the visibility check. Because an archived row has an
--      `expires_at` in the past, archiving a public story made it permanently
--      public. `archived_at` was also never written by anything, and an expired
--      story was invisible even to its own owner.
--   c. `profiles` RLS is self-or-admin only (`20260823143000`), so no client
--      could render another customer's name or avatar next to their story. This
--      is the same root cause the friend graph fixed with SECURITY DEFINER read
--      RPCs, and it is fixed the same way here.
--   d. Reads and writes had no RPC path: no feed, no viewer/reaction handling,
--      no notifications, and no storage bucket for story media.
--
-- DESIGN NOTES
-- ------------
-- * Product tagging is a join table (`story_products`), not a column, so one
--   story can feature a whole outfit. It references the canonical `products`
--   table and never copies catalogue data.
-- * Every read is a SECURITY DEFINER RPC returning a hand-picked column list,
--   following `get_my_friends()`. `profiles` itself is NOT reopened: email,
--   phone, role and `last_seen_at` stay private.
-- * Writes are RPC-first, as in the friend graph. `story_products` has no client
--   INSERT policy at all, so a product can only be tagged through
--   `create_story()`, which validates that every tagged product is visible.
-- * `story-media` is PRIVATE. A public bucket would leak expired and
--   close-friends media to anyone holding the URL. Objects live at
--   `<profile_id>/<story_id>.<ext>`, which lets a storage policy resolve the
--   story and reuse `can_view_story()` as the single authorization decision.
-- * There is no scheduler in this project, so expiry is evaluated on read
--   exactly like the streak projection: nothing is deleted or rewritten on a
--   timer. Archiving is an explicit owner action, not a cron job. This is why
--   `stories` media can outlive the 24-hour window in storage until the owner
--   deletes it — see the Phase 5 checkpoint for that genuine limitation.
-- * This file deliberately does NOT call `public.is_admin()`. That helper is
--   defined in `20260816150230` and `20260823132900` with `role = "admin"`
--   (double quotes) instead of `role = 'admin'`, which reads as a column
--   reference and is a suspected latent defect. The correct inline form used
--   everywhere else in the repo is used instead. See the Phase 5 checkpoint.

-- ============================================================================
-- 1. Product tagging
-- ============================================================================
-- One row per tagged product. `position` preserves the order the customer
-- chose, which is what makes a multi-product "outfit story" readable.
CREATE TABLE IF NOT EXISTS public.story_products (
  story_id   UUID NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  position   SMALLINT NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (story_id, product_id)
);

CREATE INDEX IF NOT EXISTS story_products_product_idx
  ON public.story_products (product_id);

ALTER TABLE public.story_products ENABLE ROW LEVEL SECURITY;

-- Read reuses the story visibility gate: if you may see the story, you may see
-- what it features. There is deliberately no client INSERT/UPDATE/DELETE
-- policy — `create_story()` is the only write path.
DROP POLICY IF EXISTS "Story viewers can read tagged products" ON public.story_products;
CREATE POLICY "Story viewers can read tagged products"
  ON public.story_products FOR SELECT
  USING (public.can_view_story(story_id));
-- ============================================================================
-- 2. Archive privacy fix
-- ============================================================================
-- Behaviour-preserving apart from two corrections:
--   * an archived (i.e. expired) story is now visible to its owner and to
--     admins only, instead of to everyone who passed the visibility check;
--   * the unused `JOIN public.profiles owner` is dropped. It was never
--     referenced in the WHERE clause and, on a FK-backed inner join, cannot
--     filter a row out, so removing it is provably equivalent.
-- Every other branch — expiry, both-direction block check, own/public/
-- followers/close_friends visibility — is unchanged.
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
    WHERE s.id = p_story_id
      AND (
        s.expires_at > now()
        OR (
          s.archived_at IS NOT NULL
          AND (
            s.profile_id = auth.uid()
            OR EXISTS (SELECT 1 FROM public.profiles me WHERE me.id = auth.uid() AND me.role = 'admin')
          )
        )
      )
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

-- ============================================================================
-- 3. Media path -> story resolution
-- ============================================================================
-- Story media is stored at `<profile_id>/<story_id>.<ext>` in the private
-- `story-media` bucket. Parsing the story id back out of the object name is what
-- lets a storage policy reuse `can_view_story()` instead of inventing a second
-- visibility rule.
--
-- Returns NULL for anything that does not match, and `can_view_story(NULL)` is
-- false, so a malformed path can never widen access.
CREATE OR REPLACE FUNCTION public.story_id_from_media_path(p_path TEXT)
RETURNS UUID
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_file  TEXT;
  v_parts TEXT[];
BEGIN
  IF p_path IS NULL THEN
    RETURN NULL;
  END IF;

  v_file := split_part(p_path, '/', 2);
  IF v_file = '' THEN
    RETURN NULL;
  END IF;

  v_parts := regexp_match(
    v_file,
    '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.'
  );
  IF v_parts IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN v_parts[1]::UUID;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

-- ============================================================================
-- 4. Private story media bucket
-- ============================================================================
-- Private on purpose (see DESIGN NOTES). The browser uploads to and signs URLs
-- from this bucket with the caller's own JWT; no service-role key is required.
INSERT INTO storage.buckets (id, name, public)
VALUES ('story-media', 'story-media', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "Story owners upload their own story media" ON storage.objects;
CREATE POLICY "Story owners upload their own story media"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'story-media'
    AND split_part(name, '/', 1) = auth.uid()::TEXT
    AND public.story_id_from_media_path(name) IS NOT NULL
  );

DROP POLICY IF EXISTS "Story owners replace their own story media" ON storage.objects;
CREATE POLICY "Story owners replace their own story media"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'story-media'
    AND split_part(name, '/', 1) = auth.uid()::TEXT
  )
  WITH CHECK (
    bucket_id = 'story-media'
    AND split_part(name, '/', 1) = auth.uid()::TEXT
  );

DROP POLICY IF EXISTS "Story owners delete their own story media" ON storage.objects;
CREATE POLICY "Story owners delete their own story media"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'story-media'
    AND split_part(name, '/', 1) = auth.uid()::TEXT
  );

-- Read is gated by the story, not by the folder name, so a story's audience is
-- decided in exactly one place. The owner branch also covers an upload that
-- happens before the story row exists.
DROP POLICY IF EXISTS "Story media is readable by its audience" ON storage.objects;
CREATE POLICY "Story media is readable by its audience"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'story-media'
    AND (
      split_part(name, '/', 1) = auth.uid()::TEXT
      OR public.can_view_story(public.story_id_from_media_path(name))
    )
  );

-- ============================================================================
-- 5. create_story — the single write path
-- ============================================================================
-- The caller supplies the story id, because the media object path must be built
-- before the upload happens and the storage policy resolves a story's audience
-- from `<profile_id>/<story_id>.<ext>`.
--
-- Everything the browser could lie about is re-validated here: the media rule
-- mirrors the table CHECK, the object path must sit under the caller's own
-- folder, the visibility must be a real enum value, and every tagged product
-- must actually be visible in the catalogue. Partial tagging is refused rather
-- than silently dropped, so a customer never publishes a story that is quietly
-- missing a product they chose.
--
-- Lifetime is fixed at 24 hours, matching the table default. It is deliberately
-- not a parameter: `stories.expires_at` is a product decision, not client input.
CREATE OR REPLACE FUNCTION public.create_story(
  p_story_id UUID,
  p_media_type TEXT,
  p_storage_object_path TEXT DEFAULT NULL,
  p_text_content TEXT DEFAULT NULL,
  p_background_color TEXT DEFAULT NULL,
  p_visibility TEXT DEFAULT 'followers',
  p_product_ids UUID[] DEFAULT ARRAY[]::UUID[]
)
RETURNS public.stories
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_story    public.stories;
  v_type     TEXT := lower(btrim(COALESCE(p_media_type, '')));
  v_vis      TEXT := lower(btrim(COALESCE(p_visibility, 'followers')));
  v_text     TEXT := NULLIF(btrim(COALESCE(p_text_content, '')), '');
  v_path     TEXT := NULLIF(btrim(COALESCE(p_storage_object_path, '')), '');
  v_backdrop TEXT := NULLIF(btrim(COALESCE(p_background_color, '')), '');
  v_products UUID[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_story_id IS NULL THEN
    RAISE EXCEPTION 'A story identifier is required';
  END IF;

  IF v_type NOT IN ('image', 'video', 'text') THEN
    RAISE EXCEPTION 'Invalid story media type';
  END IF;

  IF v_vis NOT IN ('public', 'followers', 'close_friends') THEN
    RAISE EXCEPTION 'Invalid story visibility';
  END IF;

  IF v_type = 'text' THEN
    IF v_text IS NULL THEN
      RAISE EXCEPTION 'A text story needs some text';
    END IF;
  ELSE
    IF v_path IS NULL THEN
      RAISE EXCEPTION 'An image or video story needs media';
    END IF;
    -- Without this the storage read policy could be pointed at another
    -- customer's object.
    IF split_part(v_path, '/', 1) <> v_uid::TEXT THEN
      RAISE EXCEPTION 'Story media must be uploaded to your own folder';
    END IF;
  END IF;

  IF v_text IS NOT NULL AND char_length(v_text) > 1000 THEN
    RAISE EXCEPTION 'A story caption cannot exceed 1000 characters';
  END IF;

  IF v_backdrop IS NOT NULL AND v_backdrop !~ '^#[0-9a-fA-F]{3,8}$' THEN
    RAISE EXCEPTION 'Invalid story background colour';
  END IF;

  -- De-duplicate while preserving the order the customer chose, then validate
  -- every remaining id against the same visibility rule that guards the public
  -- catalogue.
  v_products := ARRAY(
    SELECT d.pid
    FROM (
      SELECT t.pid, MIN(t.ordinality) AS first_at
      FROM unnest(COALESCE(p_product_ids, ARRAY[]::UUID[]))
        WITH ORDINALITY AS t(pid, ordinality)
      WHERE t.pid IS NOT NULL
      GROUP BY t.pid
    ) d
    ORDER BY d.first_at
  );

  IF COALESCE(array_length(v_products, 1), 0) > 5 THEN
    RAISE EXCEPTION 'A story can feature at most 5 products';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(v_products) AS t(pid)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = t.pid AND p.is_active = true AND p.is_archived = false
    )
  ) THEN
    RAISE EXCEPTION 'One or more tagged products are unavailable';
  END IF;

  INSERT INTO public.stories (
    id, profile_id, media_type, storage_object_path, text_content,
    background_color, visibility, expires_at
  )
  VALUES (
    p_story_id, v_uid, v_type, v_path, v_text,
    v_backdrop, v_vis, now() + INTERVAL '24 hours'
  )
  RETURNING * INTO v_story;

  IF COALESCE(array_length(v_products, 1), 0) > 0 THEN
    INSERT INTO public.story_products (story_id, product_id, position)
    SELECT v_story.id, t.pid, (t.ordinality - 1)::SMALLINT
    FROM unnest(v_products) WITH ORDINALITY AS t(pid, ordinality)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN v_story;
END;
$$;

-- ============================================================================
-- 6. get_stories_feed — the rail the customer actually sees
-- ============================================================================
-- Scope is the caller's social circle only: themselves, the people they follow,
-- and their friends. Public stories from strangers are deliberately NOT included
-- — that is discovery, which belongs to the later Discover phase, and pulling it
-- in now would turn the rail into an unfiltered firehose.
--
-- `can_view_story()` remains the single visibility decision, so 'followers' and
-- 'close_friends' stories are filtered by the same rule the RLS policy uses.
--
-- `viewer_count` is NULL for other people's stories rather than 0: the existing
-- `story_viewers` policy only exposes viewers to the story owner, so reporting a
-- number here would either leak it or lie. The UI shows counts on own stories.
CREATE OR REPLACE FUNCTION public.get_stories_feed()
RETURNS TABLE (
  id UUID,
  author_id UUID,
  author_username TEXT,
  author_name TEXT,
  author_avatar_url TEXT,
  media_type TEXT,
  storage_object_path TEXT,
  text_content TEXT,
  background_color TEXT,
  visibility TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  is_mine BOOLEAN,
  viewed BOOLEAN,
  viewer_count INTEGER,
  reaction_count INTEGER,
  my_reactions TEXT[],
  products JSONB
)
LANGUAGE plpgsql
STABLE
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
    s.id,
    s.profile_id,
    p.username,
    p.full_name,
    p.avatar_url,
    s.media_type,
    s.storage_object_path,
    s.text_content,
    s.background_color,
    s.visibility,
    s.expires_at,
    s.created_at,
    (s.profile_id = v_uid),
    EXISTS (
      SELECT 1 FROM public.story_viewers v
      WHERE v.story_id = s.id AND v.viewer_id = v_uid
    ),
    CASE
      WHEN s.profile_id = v_uid THEN (
        SELECT COUNT(*)::INTEGER FROM public.story_viewers v WHERE v.story_id = s.id
      )
      ELSE NULL
    END,
    (SELECT COUNT(*)::INTEGER FROM public.story_reactions r WHERE r.story_id = s.id),
    ARRAY(
      SELECT r.emoji FROM public.story_reactions r
      WHERE r.story_id = s.id AND r.profile_id = v_uid
      ORDER BY r.created_at
    ),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', tp.id,
        'name', tp.name,
        'slug', tp.slug,
        'price', tp.price,
        'discount_price', tp.discount_price,
        'image_url', (
          SELECT pi.image_url FROM public.product_images pi
          WHERE pi.product_id = tp.id
          ORDER BY pi.is_primary DESC, pi.display_order ASC
          LIMIT 1
        )
      ) ORDER BY sp.position, tp.name)
      FROM public.story_products sp
      JOIN public.products tp ON tp.id = sp.product_id
      WHERE sp.story_id = s.id
        AND tp.is_active = true
        AND tp.is_archived = false
    ), '[]'::JSONB)
  FROM public.stories s
  JOIN public.profiles p ON p.id = s.profile_id
  WHERE s.expires_at > now()
    AND s.archived_at IS NULL
    AND public.can_view_story(s.id)
    AND NOT public.social_profiles_are_blocked(v_uid, s.profile_id)
    AND (
      s.profile_id = v_uid
      OR EXISTS (
        SELECT 1 FROM public.follows f
        WHERE f.follower_id = v_uid AND f.following_id = s.profile_id
      )
      OR EXISTS (
        SELECT 1 FROM public.friendships fr
        WHERE fr.profile_low_id = LEAST(v_uid, s.profile_id)
          AND fr.profile_high_id = GREATEST(v_uid, s.profile_id)
      )
    )
  ORDER BY s.created_at ASC
  LIMIT 200;
END;
$$;

-- ============================================================================
-- 7. get_my_stories — the customer's own story history
-- ============================================================================
-- Unlike the feed this includes expired and archived stories, because it is the
-- owner's own record. Archiving is what keeps an expired story visible to its
-- owner (see §2); a story that is neither active nor archived is simply gone,
-- which is the honest consequence of a 24-hour story and no scheduler.
CREATE OR REPLACE FUNCTION public.get_my_stories()
RETURNS TABLE (
  id UUID,
  author_id UUID,
  author_username TEXT,
  author_name TEXT,
  author_avatar_url TEXT,
  media_type TEXT,
  storage_object_path TEXT,
  text_content TEXT,
  background_color TEXT,
  visibility TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  is_mine BOOLEAN,
  is_archived BOOLEAN,
  is_expired BOOLEAN,
  viewer_count INTEGER,
  reaction_count INTEGER,
  my_reactions TEXT[],
  products JSONB
)
LANGUAGE plpgsql
STABLE
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
    s.id,
    s.profile_id,
    p.username,
    p.full_name,
    p.avatar_url,
    s.media_type,
    s.storage_object_path,
    s.text_content,
    s.background_color,
    s.visibility,
    s.expires_at,
    s.created_at,
    true,
    (s.archived_at IS NOT NULL),
    (s.expires_at <= now()),
    (SELECT COUNT(*)::INTEGER FROM public.story_viewers v WHERE v.story_id = s.id),
    (SELECT COUNT(*)::INTEGER FROM public.story_reactions r WHERE r.story_id = s.id),
    ARRAY(
      SELECT r.emoji FROM public.story_reactions r
      WHERE r.story_id = s.id AND r.profile_id = v_uid
      ORDER BY r.created_at
    ),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', tp.id,
        'name', tp.name,
        'slug', tp.slug,
        'price', tp.price,
        'discount_price', tp.discount_price,
        'image_url', (
          SELECT pi.image_url FROM public.product_images pi
          WHERE pi.product_id = tp.id
          ORDER BY pi.is_primary DESC, pi.display_order ASC
          LIMIT 1
        )
      ) ORDER BY sp.position, tp.name)
      FROM public.story_products sp
      JOIN public.products tp ON tp.id = sp.product_id
      WHERE sp.story_id = s.id
    ), '[]'::JSONB)
  FROM public.stories s
  JOIN public.profiles p ON p.id = s.profile_id
  WHERE s.profile_id = v_uid
    AND (s.expires_at > now() OR s.archived_at IS NOT NULL)
  ORDER BY s.created_at DESC
  LIMIT 200;
END;
$$;

-- ============================================================================
-- 8. get_story_viewers — owner-only audience list
-- ============================================================================
-- Mirrors the `story_viewers` RLS policy: only the story's owner (or an admin)
-- may see who watched. Blocked pairs are filtered in both directions, exactly as
-- the friend-graph reads do.
CREATE OR REPLACE FUNCTION public.get_story_viewers(p_story_id UUID)
RETURNS TABLE (
  viewer_id UUID,
  username TEXT,
  full_name TEXT,
  avatar_url TEXT,
  viewed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.stories s
    WHERE s.id = p_story_id
      AND (
        s.profile_id = v_uid
        OR EXISTS (SELECT 1 FROM public.profiles me WHERE me.id = v_uid AND me.role = 'admin')
      )
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  RETURN QUERY
  SELECT v.viewer_id,
         p.username,
         p.full_name,
         p.avatar_url,
         v.viewed_at
  FROM public.story_viewers v
  JOIN public.profiles p ON p.id = v.viewer_id
  WHERE v.story_id = p_story_id
    AND NOT public.social_profiles_are_blocked(v_uid, p.id)
  ORDER BY v.viewed_at DESC;
END;
$$;

-- ============================================================================
-- 9. record_story_view — idempotent, and never self-counted
-- ============================================================================
-- `story_viewers` already has an INSERT policy gated on `can_view_story`, but a
-- plain client insert has no idempotency and would let an owner inflate their own
-- viewer count. This RPC makes opening a story safe to repeat.
CREATE OR REPLACE FUNCTION public.record_story_view(p_story_id UUID)
RETURNS VOID
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

  IF p_story_id IS NULL OR NOT public.can_view_story(p_story_id) THEN
    RAISE EXCEPTION 'This story is unavailable';
  END IF;

  -- Watching your own story is not an audience signal.
  IF EXISTS (SELECT 1 FROM public.stories s WHERE s.id = p_story_id AND s.profile_id = v_uid) THEN
    RETURN;
  END IF;

  INSERT INTO public.story_viewers (story_id, viewer_id)
  VALUES (p_story_id, v_uid)
  ON CONFLICT (story_id, viewer_id) DO NOTHING;
END;
$$;

-- ============================================================================
-- 10. set_story_reaction — toggle one emoji
-- ============================================================================
-- Returns the caller's full reaction set for that story so the UI never has to
-- guess after a toggle. The emoji is validated against the same bounds as the
-- `story_reactions` CHECK, plus a control-character guard: an emoji field is not
-- a place to smuggle a newline or a URL.
CREATE OR REPLACE FUNCTION public.set_story_reaction(
  p_story_id UUID,
  p_emoji TEXT
)
RETURNS TEXT[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_emoji TEXT := btrim(COALESCE(p_emoji, ''));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF v_emoji = '' OR char_length(v_emoji) > 32 OR v_emoji ~ '[\n\r\t]' THEN
    RAISE EXCEPTION 'Invalid reaction';
  END IF;

  IF p_story_id IS NULL OR NOT public.can_view_story(p_story_id) THEN
    RAISE EXCEPTION 'This story is unavailable';
  END IF;

  DELETE FROM public.story_reactions
  WHERE story_id = p_story_id AND profile_id = v_uid AND emoji = v_emoji;

  IF NOT FOUND THEN
    INSERT INTO public.story_reactions (story_id, profile_id, emoji)
    VALUES (p_story_id, v_uid, v_emoji)
    ON CONFLICT (story_id, profile_id, emoji) DO NOTHING;
  END IF;

  RETURN ARRAY(
    SELECT r.emoji FROM public.story_reactions r
    WHERE r.story_id = p_story_id AND r.profile_id = v_uid
    ORDER BY r.created_at
  );
END;
$$;

-- ============================================================================
-- 11. set_story_archived — explicit owner action, not a cron job
-- ============================================================================
-- There is no scheduler, so nothing expires rows automatically. Archiving (or
-- hiding a live story early) is the owner's decision. Un-archiving an expired
-- story makes it invisible again, which is correct: it was already past its
-- 24 hours.
CREATE OR REPLACE FUNCTION public.set_story_archived(
  p_story_id UUID,
  p_archived BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_found BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.stories s
    WHERE s.id = p_story_id
      AND (
        s.profile_id = v_uid
        OR EXISTS (SELECT 1 FROM public.profiles me WHERE me.id = v_uid AND me.role = 'admin')
      )
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  UPDATE public.stories
  SET archived_at = CASE WHEN p_archived THEN now() ELSE NULL END
  WHERE id = p_story_id;

  GET DIAGNOSTICS v_found = ROW_COUNT;
  RETURN v_found;
END;
$$;

-- ============================================================================
-- 12. delete_story — owner-only, idempotent
-- ============================================================================
-- Returns false instead of raising when the row is already gone, so a delete
-- from a second device does not surface a spurious error. The associated media
-- object is removed by the client through the `story-media` DELETE policy; if
-- that call fails the row is still gone and the orphaned object stays private
-- and unreachable, because the storage read policy resolves a story id that no
-- longer exists.
CREATE OR REPLACE FUNCTION public.delete_story(p_story_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_found BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.stories s
    WHERE s.id = p_story_id
      AND (
        s.profile_id = v_uid
        OR EXISTS (SELECT 1 FROM public.profiles me WHERE me.id = v_uid AND me.role = 'admin')
      )
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  DELETE FROM public.stories WHERE id = p_story_id;
  GET DIAGNOSTICS v_found = ROW_COUNT;
  RETURN v_found;
END;
$$;

-- ============================================================================
-- 13. Notifications — the write path is a trigger, never the browser
-- ============================================================================
-- `notifications` has no client INSERT policy on purpose
-- (`20260928100000:48-50`); SECURITY DEFINER triggers are the only normal write
-- path. Without these two, reacting to a story or being tagged in one was
-- completely silent, which is most of why stories felt bolted on.
--
-- `entity_type`/`entity_id` and `data.story_id` are what let the notification
-- deep-link straight back to the story instead of dumping the customer on a
-- generic account page.

-- Someone reacted to your story.
CREATE OR REPLACE FUNCTION public.notify_on_story_reaction()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
  v_actor TEXT;
BEGIN
  SELECT s.profile_id INTO v_owner FROM public.stories s WHERE s.id = NEW.story_id;

  IF v_owner IS NULL OR v_owner = NEW.profile_id THEN
    RETURN NEW;
  END IF;

  SELECT p.full_name INTO v_actor FROM public.profiles p WHERE p.id = NEW.profile_id;

  INSERT INTO public.notifications (
    user_id, actor_id, entity_type, entity_id, title, message, type, data
  )
  VALUES (
    v_owner,
    NEW.profile_id,
    'story',
    NEW.story_id,
    'Nouvelle réaction à votre story',
    COALESCE(v_actor, 'Un membre') || ' a réagi ' || NEW.emoji || ' à votre story.',
    'story_reaction',
    jsonb_build_object(
      'story_id', NEW.story_id,
      'emoji', NEW.emoji,
      'actor_id', NEW.profile_id
    )
  );

  RETURN NEW;
END;
$$;

-- You were mentioned in a story.
CREATE OR REPLACE FUNCTION public.notify_on_story_mention()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
  v_owner_name TEXT;
BEGIN
  SELECT s.profile_id INTO v_owner FROM public.stories s WHERE s.id = NEW.story_id;

  IF v_owner IS NULL OR v_owner = NEW.mentioned_profile_id THEN
    RETURN NEW;
  END IF;

  SELECT p.full_name INTO v_owner_name FROM public.profiles p WHERE p.id = v_owner;

  INSERT INTO public.notifications (
    user_id, actor_id, entity_type, entity_id, title, message, type, data
  )
  VALUES (
    NEW.mentioned_profile_id,
    v_owner,
    'story',
    NEW.story_id,
    'Vous êtes mentionné dans une story',
    COALESCE(v_owner_name, 'Un membre') || ' vous a mentionné dans une story.',
    'story_mention',
    jsonb_build_object(
      'story_id', NEW.story_id,
      'author_id', v_owner
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "Notify story owners of new reactions" ON public.story_reactions;
CREATE TRIGGER "Notify story owners of new reactions"
  AFTER INSERT ON public.story_reactions
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_story_reaction();

DROP TRIGGER IF EXISTS "Notify mentioned profiles in stories" ON public.story_mentions;
CREATE TRIGGER "Notify mentioned profiles in stories"
  AFTER INSERT ON public.story_mentions
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_story_mention();

-- ============================================================================
-- 14. Grants
-- ============================================================================
-- Every new function is revoked from PUBLIC first. The grant is deliberately to
-- `authenticated` only and never to `anon`: story media lives in a private
-- bucket and the feed is scoped to the caller's social circle, so there is
-- nothing meaningful for a signed-out visitor to call. Public story browsing is
-- a Discover-phase decision, not something to open by accident here.
REVOKE ALL ON FUNCTION public.can_view_story(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.story_id_from_media_path(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_story(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_stories_feed() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_stories() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_story_viewers(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_story_view(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_story_reaction(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_story_archived(UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_story(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_on_story_reaction() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_on_story_mention() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.can_view_story(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.story_id_from_media_path(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_story(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_stories_feed() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_stories() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_story_viewers(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_story_view(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_story_reaction(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_story_archived(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_story(UUID) TO authenticated;
-- The two trigger functions are invoked by the database, never by a client, so they
-- stay revoked from PUBLIC. Trigger dispatch does not go through EXECUTE privilege.
-- ============================================================================
-- REVERSIBLE (rollback)
-- ============================================================================
--   DROP TRIGGER IF EXISTS "Notify story owners of new reactions" ON public.story_reactions;
--   DROP TRIGGER IF EXISTS "Notify mentioned profiles in stories" ON public.story_mentions;
--   DROP FUNCTION IF EXISTS public.notify_on_story_reaction();
--   DROP FUNCTION IF EXISTS public.notify_on_story_mention();
--   DROP FUNCTION IF EXISTS public.delete_story(UUID);
--   DROP FUNCTION IF EXISTS public.set_story_archived(UUID, BOOLEAN);
--   DROP FUNCTION IF EXISTS public.set_story_reaction(UUID, TEXT);
--   DROP FUNCTION IF EXISTS public.record_story_view(UUID);
--   DROP FUNCTION IF EXISTS public.get_story_viewers(UUID);
--   DROP FUNCTION IF EXISTS public.get_my_stories();
--   DROP FUNCTION IF EXISTS public.get_stories_feed();
--   DROP FUNCTION IF EXISTS public.create_story(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID[]);
--   DROP TABLE IF EXISTS public.story_products;
--
-- `can_view_story()` and `story_id_from_media_path()` are intentionally NOT
-- dropped: `can_view_story()` predates this file (restore its original body from
-- `20260928102000_social_foundation.sql` if the archive fix must be undone) and
-- the four `story-media` storage policies reference the parser. Remove those
-- policies and the bucket only after the functions are gone.
--
-- Story rows, viewers, reactions and mentions are never touched by this file, so
-- a rollback cannot lose customer content.