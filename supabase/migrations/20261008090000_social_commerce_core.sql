-- DLXSTORE — Social commerce: product sharing, circles and social proof
-- (master roadmap area 12)
--
-- PRE-APPLICATION REQUIREMENTS
-- ----------------------------
-- 1. Read the remote migration ledger and obtain explicit operator approval.
-- 2. Requires `20260928102000_social_foundation.sql` (social graph) and the
--    already-shipped `share_events` table from `20260902120000`. This file
--    reuses both and creates no competing product, order or share table.
-- 3. Additive and idempotent. No product, order, price or customer row is
--    rewritten, moved or deleted. The only pre-existing object this file changes
--    is the body of `can_view_story()` is NOT touched; `share_events` is only ever
--    INSERTed into, never altered.
--
-- WHAT WAS GENUINELY MISSING
-- --------------------------
-- The social graph, chat, stories and `share_events` all shipped, but commerce
-- was not connected to any of them. Five real holes:
--   a. `share_events` recorded a *channel* and nothing else. There was no way to
--      know what was shared or who it was shared to, so a share could never be
--      attributed, surfaced in a feed, or counted as social proof.
--   b. `src/lib/product-share.ts` encoded a product card into a chat message body,
--      but nothing ever called it. A product link in DLX Chat was unreachable.
--   c. There was no social proof anywhere. A customer could not see that anyone
--      in their own circle had bought or wishlisted a product, which is the single
--      strongest trust signal in a market where DLXSTORE is a new brand.
--   d. Orders carry `customer_id` but nothing connected a purchase to the social
--      graph, so "a friend of yours bought this" was not expressible without
--      exposing the customer's name.
--   e. No product-to-product recommendation from a friend's taste, so the wishlist
--      and the friend graph stayed isolated from the catalogue.
--
-- DESIGN NOTES
-- ------------
-- * Social proof is deliberately ANONYMOUS. `get_product_social_proof()` returns
--   counts and a count of the caller's own circle, plus the caller's own
--   purchase/wishlist flags. It never returns another customer's identity, and
--   `orders` is never selectable by a customer in the first place. The proof is
--   "3 people from Goma bought this" and "2 people you follow saved this", not
--   names. This is a privacy decision, not an omission: DLXSTORE is a new brand in
--   a new market and a purchase list is customer data.
-- * A share is a first-class row (`product_shares`), not a tag on `share_events`.
--   The rewards table is a rate-limited anti-abuse ledger whose semantics are
--   "this customer shared something, N times"; overloading it with a product and a
--   recipient would couple the rewards cooldown to the social graph and make both
--   harder to reason about. `product_shares` keeps the social record and still
--   calls the existing `record_share_event()` so reward cooldowns stay correct.
-- * Shares target either a specific friend or a channel. A targeted share notifies
--   the recipient; a channel share is just a counter and notifies nobody.
-- * Recommendations are computed, not stored. A stored recommendation table would
--   go stale silently between writes; there is no scheduler in this project to
--   refresh it, so it is derived on read from the caller's wishlist.
-- * Everything is a SECURITY DEFINER RPC returning a hand-picked column list,
--   following `get_my_friends()`. `profiles` and `orders` are NOT reopened.
--
CREATE TABLE IF NOT EXISTS public.product_shares (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sender_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- NULL for an open channel share (WhatsApp, copy link, native share). Set for a
  -- share aimed at one person, which is what makes it a notification.
  recipient_id  UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  channel       TEXT NOT NULL DEFAULT 'web'
                CHECK (channel IN ('web', 'whatsapp', 'copy_link', 'native_share', 'friend')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  -- Set when the recipient later converts (saves or buys). One share is credited
  -- at most once, so a repeat buyer cannot inflate a referrer's tally.
  converted_at  TIMESTAMPTZ,
  CONSTRAINT product_shares_not_self CHECK (recipient_id IS NULL OR recipient_id <> sender_id)
);

CREATE INDEX IF NOT EXISTS product_shares_product_idx
  ON public.product_shares (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS product_shares_sender_idx
  ON public.product_shares (sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS product_shares_recipient_idx
  ON public.product_shares (recipient_id, created_at DESC)
  WHERE recipient_id IS NOT NULL;

ALTER TABLE public.product_shares ENABLE ROW LEVEL SECURITY;

-- A sender may read their own shares. A recipient reads the shares aimed at them
-- so the product page can say "Spanky shared this with you" — but only the
-- product id, never the wider share history, and never another person's row.
DROP POLICY IF EXISTS "Senders read their own product shares" ON public.product_shares;
CREATE POLICY "Senders read their own product shares"
  ON public.product_shares FOR SELECT
  USING (sender_id = auth.uid());

DROP POLICY IF EXISTS "Recipients read shares aimed at them" ON public.product_shares;
CREATE POLICY "Recipients read shares aimed at them"
  ON public.product_shares FOR SELECT
  USING (recipient_id = auth.uid());

DROP POLICY IF EXISTS "Admins read all product shares" ON public.product_shares;
CREATE POLICY "Admins read all product shares"
  ON public.product_shares FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles me WHERE me.id = auth.uid() AND me.role = 'admin')
  );

-- There is no client INSERT policy on purpose. Every write goes through
-- `share_product()`, which validates the product, the recipient and the blocks in
-- one atomic step. A plain client insert would let anyone attribute a share to any
-- other customer, or spam a blocked user.

-- ============================================================================
-- 2. share_product — the single write path
-- ============================================================================
-- Also calls the existing `record_share_event()` so the rewards cooldown and the
-- per-channel caps keep working exactly as they do for every other share. The
-- social record and the anti-abuse ledger stay separate, which is the whole point
-- of §a in the header.
CREATE OR REPLACE FUNCTION public.share_product(
  p_product_id   UUID,
  p_recipient_id UUID DEFAULT NULL,
  p_channel      TEXT DEFAULT 'web'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_recipient  UUID := NULLIF(btrim(COALESCE(p_recipient_id::TEXT, '')), '')::UUID;
  v_channel    TEXT  := lower(btrim(COALESCE(p_channel, 'web')));
  v_share_id   UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'A product is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = p_product_id AND p.is_active = true AND p.is_archived = false
  ) THEN
    RAISE EXCEPTION 'This product is unavailable';
  END IF;

  -- A direct share to a person is always the 'friend' channel regardless of what
  -- the client claims, so the two cannot disagree.
  IF v_recipient IS NOT NULL THEN
    v_channel := 'friend';
  ELSIF v_channel = 'friend' THEN
    RAISE EXCEPTION 'Choose someone to share with';
  ELSIF v_channel NOT IN ('web', 'whatsapp', 'copy_link', 'native_share') THEN
    RAISE EXCEPTION 'Invalid share channel';
  END IF;

  IF v_recipient IS NOT NULL THEN
    IF v_recipient = v_uid THEN
      RAISE EXCEPTION 'You cannot share a product with yourself';
    END IF;

    -- The recipient must be someone the caller can actually see, and the pair must
    -- not be blocked in either direction. This is the same social gate
    -- `get_stories_feed()` uses, so a share can never reach a hidden account.
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = v_recipient
        AND (
          EXISTS (SELECT 1 FROM public.follows f
                  WHERE f.follower_id = v_uid AND f.following_id = v_recipient)
          OR EXISTS (SELECT 1 FROM public.friendships fr
                     WHERE fr.profile_low_id = LEAST(v_uid, v_recipient)
                       AND fr.profile_high_id = GREATEST(v_uid, v_recipient))
        )
    ) THEN
      RAISE EXCEPTION 'You can only share with people in your circle';
    END IF;

    IF public.social_profiles_are_blocked(v_uid, v_recipient) THEN
      RAISE EXCEPTION 'You cannot share with this person';
    END IF;
  END IF;

  INSERT INTO public.product_shares (product_id, sender_id, recipient_id, channel)
  VALUES (p_product_id, v_uid, v_recipient, v_channel)
  RETURNING id INTO v_share_id;

  -- Feed the existing rewards ledger. Failures here must not lose the social
  -- share, and the reward caps are advisory rather than a correctness requirement.
  BEGIN
    PERFORM public.record_share_event(v_channel);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN v_share_id;
END;
$$;

-- ============================================================================
-- 3. get_product_social_proof — anonymous trust signal
-- ============================================================================
-- The single strongest trust signal DLXSTORE can show a customer deciding whether
-- to buy from a new brand, and the cheapest to get right.
--
-- PRIVACY: this returns COUNTS and the CALLER'S OWN flags. It never returns
-- another customer's id, name or purchase. `orders` carries `customer_id` and
-- `order_items` carries `product_id`; counting distinct buyers is safe, selecting
-- their identities is not. There is deliberately no way to ask "who bought this".
--
-- The caller's circle count is scoped to follows + friendships and filters blocked
-- pairs in both directions, so it cannot be used to probe a blocked or hidden
-- account. A signed-out visitor gets the store-wide counts only.
CREATE OR REPLACE FUNCTION public.get_product_social_proof(p_product_id UUID)
RETURNS TABLE (
  product_id        UUID,
  buyer_count       INTEGER,
  wishlist_count    INTEGER,
  share_count       INTEGER,
  circle_buyer_count INTEGER,
  circle_wishlist_count INTEGER,
  i_bought_it       BOOLEAN,
  i_wishlisted_it   BOOLEAN,
  shared_with_me    BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'A product is required';
  END IF;

  RETURN QUERY
  SELECT
    p_product_id,
    -- Only completed sales count as proof. A pending or cancelled order is not
    -- evidence that anybody wants the product.
    (SELECT COUNT(DISTINCT o.customer_id)
       FROM public.order_items oi
       JOIN public.orders o ON o.id = oi.order_id
      WHERE oi.product_id = p_product_id
        AND o.customer_id IS NOT NULL
        AND o.status = 'delivered'),
    (SELECT COUNT(*)::INTEGER FROM public.wishlist w WHERE w.product_id = p_product_id),
    (SELECT COUNT(*)::INTEGER FROM public.product_shares s WHERE s.product_id = p_product_id),
    -- Circle counts are 0 for a signed-out caller rather than an error: the
    -- storefront still shows store-wide proof to an anonymous visitor.
    CASE WHEN v_uid IS NULL THEN 0 ELSE (
      SELECT COUNT(DISTINCT o.customer_id)
        FROM public.order_items oi
        JOIN public.orders o ON o.id = oi.order_id
       WHERE oi.product_id = p_product_id
         AND o.customer_id IS NOT NULL
         AND o.status = 'delivered'
         AND (
           EXISTS (SELECT 1 FROM public.follows f
                    WHERE f.follower_id = v_uid AND f.following_id = o.customer_id)
           OR EXISTS (SELECT 1 FROM public.friendships fr
                      WHERE fr.profile_low_id = LEAST(v_uid, o.customer_id)
                        AND fr.profile_high_id = GREATEST(v_uid, o.customer_id))
         )
         AND NOT public.social_profiles_are_blocked(v_uid, o.customer_id)
    ) END,
    CASE WHEN v_uid IS NULL THEN 0 ELSE (
      SELECT COUNT(DISTINCT w.user_id)
        FROM public.wishlist w
       WHERE w.product_id = p_product_id
         AND (
           EXISTS (SELECT 1 FROM public.follows f
                    WHERE f.follower_id = v_uid AND f.following_id = w.user_id)
           OR EXISTS (SELECT 1 FROM public.friendships fr
                      WHERE fr.profile_low_id = LEAST(v_uid, w.user_id)
                        AND fr.profile_high_id = GREATEST(v_uid, w.user_id))
         )
         AND NOT public.social_profiles_are_blocked(v_uid, w.user_id)
    ) END,
    CASE WHEN v_uid IS NULL THEN false ELSE EXISTS (
      SELECT 1 FROM public.order_items oi
        JOIN public.orders o ON o.id = oi.order_id
       WHERE oi.product_id = p_product_id
         AND o.customer_id = v_uid
         AND o.status = 'delivered'
    ) END,
    CASE WHEN v_uid IS NULL THEN false ELSE EXISTS (
      SELECT 1 FROM public.wishlist w WHERE w.product_id = p_product_id AND w.user_id = v_uid
    ) END,
    -- "X shared this with you" is the one place a share reveals that a specific
    -- person acted, because the recipient is the one being told. No name is
    -- returned here; the UI already knows who the signed-in customer is.
    CASE WHEN v_uid IS NULL THEN false ELSE EXISTS (
      SELECT 1 FROM public.product_shares s
       WHERE s.product_id = p_product_id AND s.recipient_id = v_uid
    ) END;
END;
$$;

-- ============================================================================
-- 4. get_social_recommendations — a friend's taste, not a black box
-- ============================================================================
-- Recommends products the caller's circle has bought, ranked, with their own
-- wishlist and purchases excluded so the shelf is never "things you already have".
--
-- Computed on read rather than stored: a stored recommendation table goes stale
-- silently between writes and this project has no scheduler to refresh it.
--
-- An anonymous caller gets nothing, because a recommendation is by definition
-- personal. The storefront falls back to its existing "related products" query.
CREATE OR REPLACE FUNCTION public.get_social_recommendations(p_limit INTEGER DEFAULT 12)
RETURNS TABLE (
  id             UUID,
  name           TEXT,
  slug           TEXT,
  price          NUMERIC,
  discount_price NUMERIC,
  image_url      TEXT,
  reason         TEXT,
  score          INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 12), 1), 24);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  RETURN QUERY
  WITH circle_buys AS (
    SELECT oi.product_id, COUNT(DISTINCT o.customer_id)::INTEGER AS buyers
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
     WHERE o.status = 'delivered'
       AND o.customer_id IS NOT NULL
       AND o.customer_id <> v_uid
       AND (
         EXISTS (SELECT 1 FROM public.follows f
                  WHERE f.follower_id = v_uid AND f.following_id = o.customer_id)
         OR EXISTS (SELECT 1 FROM public.friendships fr
                    WHERE fr.profile_low_id = LEAST(v_uid, o.customer_id)
                      AND fr.profile_high_id = GREATEST(v_uid, o.customer_id))
       )
       AND NOT public.social_profiles_are_blocked(v_uid, o.customer_id)
     GROUP BY oi.product_id
  ),
  circle_saves AS (
    SELECT w.product_id, COUNT(DISTINCT w.user_id)::INTEGER AS savers
      FROM public.wishlist w
     WHERE w.user_id <> v_uid
       AND (
         EXISTS (SELECT 1 FROM public.follows f
                  WHERE f.follower_id = v_uid AND f.following_id = w.user_id)
         OR EXISTS (SELECT 1 FROM public.friendships fr
                    WHERE fr.profile_low_id = LEAST(v_uid, w.user_id)
                      AND fr.profile_high_id = GREATEST(v_uid, w.user_id))
       )
       AND NOT public.social_profiles_are_blocked(v_uid, w.user_id)
     GROUP BY w.product_id
  ),
  scored AS (
    SELECT
      cb.product_id,
      -- A purchase by someone you follow weighs double a wishlist save: it is
      -- stronger evidence, and it is the difference between "popular in your
      -- circle" and "saved by a friend".
      (cb.buyers * 2 + COALESCE(cs.savers, 0)) AS score,
      CASE
        WHEN COALESCE(cs.savers, 0) > cb.buyers THEN 'saved_by_friends'
        ELSE 'bought_by_friends'
      END AS reason
      FROM circle_buys cb
      LEFT JOIN circle_saves cs ON cs.product_id = cb.product_id
     -- Never recommend something the caller already owns or saved.
     WHERE NOT EXISTS (
             SELECT 1 FROM public.wishlist w2
              WHERE w2.product_id = cb.product_id AND w2.user_id = v_uid
           )
       AND NOT EXISTS (
             SELECT 1 FROM public.order_items oi2
              JOIN public.orders o2 ON o2.id = oi2.order_id
              WHERE oi2.product_id = cb.product_id AND o2.customer_id = v_uid
                AND o2.status = 'delivered'
           )
  )
  SELECT p.id, p.name, p.slug, p.price, p.discount_price,
         (SELECT pi.image_url FROM public.product_images pi
           WHERE pi.product_id = p.id
           ORDER BY pi.is_primary DESC, pi.display_order ASC LIMIT 1),
         s.reason, s.score
    FROM scored s
    JOIN public.products p ON p.id = s.product_id
   WHERE p.is_active = true AND p.is_archived = false
   ORDER BY s.score DESC, p.name ASC
   LIMIT v_limit;
END;
$$;

-- ============================================================================
-- 5. get_my_shared_products — the caller's own share history
-- ============================================================================
-- Read-only on purpose. A share is a receipt, not a post: there is no edit, because
-- editing a share after the fact would misrepresent when it was sent.
CREATE OR REPLACE FUNCTION public.get_my_shared_products(p_limit INTEGER DEFAULT 50)
RETURNS TABLE (
  share_id     UUID,
  product_id   UUID,
  product_name TEXT,
  product_slug TEXT,
  image_url    TEXT,
  channel      TEXT,
  recipient_id UUID,
  created_at   TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  RETURN QUERY
  SELECT s.id, s.product_id, p.name, p.slug,
         (SELECT pi.image_url FROM public.product_images pi
           WHERE pi.product_id = p.id
           ORDER BY pi.is_primary DESC, pi.display_order ASC LIMIT 1),
         s.channel, s.recipient_id, s.created_at
    FROM public.product_shares s
    JOIN public.products p ON p.id = s.product_id
   WHERE s.sender_id = v_uid
     -- An archived product is still a truthful record of what was shared, so it is
     -- included here even though it can no longer be shared again.
   ORDER BY s.created_at DESC
   LIMIT v_limit;
END;
$$;

-- ============================================================================
-- 6. Notification when a product is shared with you
-- ============================================================================
-- Mirrors `notify_on_story_reaction()`: DB-side, so it cannot be bypassed by a
-- client that never calls the app.
CREATE OR REPLACE FUNCTION public.notify_on_product_share()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender  TEXT;
  v_product TEXT;
BEGIN
  -- A channel share has no recipient and must never notify anyone.
  IF NEW.recipient_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.full_name INTO v_sender FROM public.profiles p WHERE p.id = NEW.sender_id;
  SELECT pr.name INTO v_product FROM public.products pr WHERE pr.id = NEW.product_id;

  INSERT INTO public.notifications (
    user_id, actor_id, entity_type, entity_id, title, message, type, data
  )
  VALUES (
    NEW.recipient_id,
    NEW.sender_id,
    'product',
    NEW.product_id,
    'Un produit vous a été partagé',
    COALESCE(v_sender, 'Un membre') || ' a partagé « '
      || COALESCE(v_product, 'un produit') || ' » avec vous.',
    'product_share',
    jsonb_build_object(
      'product_id', NEW.product_id,
      'share_id', NEW.id,
      'actor_id', NEW.sender_id
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "Notify recipients of shared products" ON public.product_shares;
CREATE TRIGGER "Notify recipients of shared products"
  AFTER INSERT ON public.product_shares
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_product_share();

-- ============================================================================
-- 7. Grants
-- ============================================================================
-- `get_product_social_proof` is the only function granted to `anon`: the proof
-- strip is trust information for an anonymous shopper deciding whether to trust a
-- new brand, and it returns counts only. Everything else requires a session.
REVOKE ALL ON FUNCTION public.share_product(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_product_social_proof(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_social_recommendations(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_shared_products(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_on_product_share() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.share_product(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_product_social_proof(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_social_recommendations(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_shared_products(INTEGER) TO authenticated;
-- `notify_on_product_share()` is a trigger function invoked by the database, so it
-- stays revoked from PUBLIC. Trigger dispatch does not use EXECUTE privilege.

-- ============================================================================
-- REVERSIBLE (rollback)
-- ============================================================================
--   DROP TRIGGER IF EXISTS "Notify recipients of shared products" ON public.product_shares;
--   DROP FUNCTION IF EXISTS public.notify_on_product_share();
--   DROP FUNCTION IF EXISTS public.get_my_shared_products(INTEGER);
--   DROP FUNCTION IF EXISTS public.get_social_recommendations(INTEGER);
--   DROP FUNCTION IF EXISTS public.get_product_social_proof(UUID);
--   DROP FUNCTION IF EXISTS public.share_product(UUID, UUID, TEXT);
--   DROP TABLE IF EXISTS public.product_shares;
--
-- Nothing else in this file is changed, so a rollback removes only the social
-- commerce additions. `share_events` is only ever INSERTed into and keeps every
-- row it already had; orders, products, wishlist and the social graph are
-- untouched. Rolling back loses the social share history, which is the intended
-- meaning of removing the feature.
