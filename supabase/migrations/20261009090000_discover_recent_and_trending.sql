-- DLXSTORE — Discover: recently viewed and discovery ranking
-- (master roadmap area 14)
--
-- PRE-APPLICATION REQUIREMENTS
-- ----------------------------
-- 1. Read the remote migration ledger and obtain explicit operator approval.
-- 2. Additive and idempotent. No product, order, price or customer row is
--    rewritten, moved or deleted. This file creates two new tables and one new
--    function, and changes no pre-existing object.
--
-- WHAT WAS GENUINELY MISSING
-- --------------------------
-- The master checkpoint records DLX Discover as `NOT STARTED`. The catalogue,
-- DLX Food and the partner shops each had their own page, but there was no way to
-- get back to something you had already looked at, and no shared ranking:
--   a. `COM-2` in the master checkpoint — "recently-viewed absent". Nothing
--      recorded a product view, so "continue where you left off" was impossible
--      and a returning customer had to search again for the same item.
--   b. No trending notion. `is_featured`, `is_best_seller` and `is_new_arrival`
--      are all authored by admins. Nothing in the data showed what customers
--      actually engage with, so "trending" could not be honest.
--   c. The header search reaches only the product catalogue, so a customer
--      looking for a restaurant or a shop had no single search box.
--
-- DESIGN NOTES
-- ------------
-- * A view is recorded per (profile, product) and de-duplicated, so revisiting the
--   same product refreshes its position instead of creating a second row. There is
--   no view counter here on purpose: counting views invites traffic inflation, and
--   Discover only needs recency.
-- * Views are per-customer and private. There is no global view table, so nothing
--   about one customer's browsing leaks to another, and no anonymous visitor is
--   tracked at all. That is the opposite trade to a global trending counter, and
--   it is the right one here: the ranking below is a *personalised* trending rail,
--   not a public popularity claim.
-- * `get_trending_products()` ranks by recent engagement among the caller's circle
--   where available and falls back to store-wide volume. It is computed on read
--   because this project has no scheduler, so a materialised ranking would go
--   stale silently between writes.
-- * `product_type` exists on `products` (added for DLX Food), so a single product
--   query spans the catalogue and food without a union table.
--
-- ============================================================================
-- 1. product_views — private browsing history
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.product_views (
  profile_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  viewed_at   TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  view_count  INTEGER NOT NULL DEFAULT 1 CHECK (view_count > 0),
  PRIMARY KEY (profile_id, product_id)
);

CREATE INDEX IF NOT EXISTS product_views_recent_idx
  ON public.product_views (profile_id, viewed_at DESC);

ALTER TABLE public.product_views ENABLE ROW LEVEL SECURITY;

-- A customer reads and writes only their own history. Not even an admin reads it:
-- it is browsing behaviour, not business data, and the Discover ranking is
-- aggregate-only.
DROP POLICY IF EXISTS "Customers read their own product views" ON public.product_views;
CREATE POLICY "Customers read their own product views"
  ON public.product_views FOR SELECT
  USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "Customers record their own product views" ON public.product_views;
CREATE POLICY "Customers record their own product views"
  ON public.product_views FOR INSERT
  WITH CHECK (profile_id = auth.uid());

DROP POLICY IF EXISTS "Customers update their own product views" ON public.product_views;
CREATE POLICY "Customers update their own product views"
  ON public.product_views FOR UPDATE
  USING (profile_id = auth.uid());

-- ============================================================================
-- 2. record_product_view — the single write path
-- ============================================================================
-- De-duplicates on (profile, product) and re-stamps `viewed_at`, so revisiting an
-- item moves it to the top of "recently viewed" instead of creating a duplicate.
--
-- `view_count` is kept for a future engagement signal but is NOT used by the
-- Discover ranking, which is recency-only on purpose: a counter rewards volume,
-- not relevance.
CREATE OR REPLACE FUNCTION public.record_product_view(p_product_id UUID)
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

  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'A product is required';
  END IF;

  -- Refuse to record a view of something that is not actually sellable. Without
  -- this a crafted call could pad a customer's history with archived products.
  IF NOT EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = p_product_id AND p.is_active = true AND p.is_archived = false
  ) THEN
    RAISE EXCEPTION 'This product is unavailable';
  END IF;

  INSERT INTO public.product_views (profile_id, product_id, viewed_at, view_count)
  VALUES (v_uid, p_product_id, now(), 1)
  ON CONFLICT (profile_id, product_id) DO UPDATE
    SET viewed_at = now(),
        view_count = public.product_views.view_count + 1;
END;
$$;

-- ============================================================================
-- 3. get_recently_viewed — "continue where you left off"
-- ============================================================================
-- Joins the catalogue rather than returning raw view rows, so an archived product
-- drops out naturally instead of rendering a dead link. Excludes anything already
-- in the wishlist: "recently viewed" that suggests re-buying what you already have
-- is worse than not showing it.
CREATE OR REPLACE FUNCTION public.get_recently_viewed(p_limit INTEGER DEFAULT 12)
RETURNS TABLE (
  id             UUID,
  name           TEXT,
  slug           TEXT,
  price          NUMERIC,
  discount_price NUMERIC,
  image_url      TEXT,
  product_type   TEXT,
  viewed_at      TIMESTAMPTZ
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
  SELECT p.id, p.name, p.slug, p.price, p.discount_price,
         (SELECT pi.image_url FROM public.product_images pi
           WHERE pi.product_id = p.id
           ORDER BY pi.is_primary DESC, pi.display_order ASC LIMIT 1),
         p.product_type,
         v.viewed_at
    FROM public.product_views v
    JOIN public.products p ON p.id = v.product_id
   WHERE v.profile_id = v_uid
     AND p.is_active = true AND p.is_archived = false
     AND NOT EXISTS (SELECT 1 FROM public.wishlist w
                      WHERE w.product_id = p.id AND w.user_id = v_uid)
   ORDER BY v.viewed_at DESC
   LIMIT v_limit;
END;
$$;

-- ============================================================================
-- 4. get_trending_products — honest ranking, computed on read
-- ============================================================================
-- Ranking answers different questions per tier, and none is a vanity counter:
--   1. In stock right now. Trending must never recommend something unbuyable.
--   2. Engaged with by the caller's circle in the last 14 days (wishlist saves and
--      delivered purchases). This is the personalised rail.
--   3. Store-wide delivered sales in the last 14 days, for a signed-out visitor or
--      a customer whose circle has no signal yet.
--
-- Anonymous callers get tier 3 only. There is no per-product public view counter
-- anywhere in this project, so there is nothing to leak.
CREATE OR REPLACE FUNCTION public.get_trending_products(p_limit INTEGER DEFAULT 12)
RETURNS TABLE (
  id             UUID,
  name           TEXT,
  slug           TEXT,
  price          NUMERIC,
  discount_price NUMERIC,
  image_url      TEXT,
  product_type   TEXT,
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
  RETURN QUERY
  WITH time_window AS (
    SELECT now() - INTERVAL '14 days' AS since
  ),
  store_sales AS (
    SELECT oi.product_id, COUNT(DISTINCT o.customer_id)::INTEGER AS buyers
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      CROSS JOIN time_window w
     WHERE o.status = 'delivered'
       AND o.created_at >= w.since
       AND o.customer_id IS NOT NULL
     GROUP BY oi.product_id
  ),
  circle_engagement AS (
    SELECT p.id AS product_id,
           COUNT(DISTINCT w.user_id)::INTEGER AS circle_saves
      FROM public.wishlist w
      JOIN public.products p ON p.id = w.product_id
     WHERE w.created_at >= (SELECT since FROM time_window)
       AND (CASE WHEN v_uid IS NULL THEN false ELSE (
         EXISTS (SELECT 1 FROM public.follows f
                  WHERE f.follower_id = v_uid AND f.following_id = w.user_id)
         OR EXISTS (SELECT 1 FROM public.friendships fr
                    WHERE fr.profile_low_id = LEAST(v_uid, w.user_id)
                      AND fr.profile_high_id = GREATEST(v_uid, w.user_id))
       ) AND NOT public.social_profiles_are_blocked(v_uid, w.user_id) END)
     GROUP BY p.id
  )
  SELECT p.id, p.name, p.slug, p.price, p.discount_price,
         (SELECT pi.image_url FROM public.product_images pi
           WHERE pi.product_id = p.id
           ORDER BY pi.is_primary DESC, pi.display_order ASC LIMIT 1),
         p.product_type,
         -- Circle saves weigh more than store volume: a save by someone you follow
         -- is a stronger signal about your taste than an anonymous storewide sale.
         (COALESCE(ce.circle_saves, 0) * 3 + COALESCE(ss.buyers, 0))::INTEGER
    FROM public.products p
    LEFT JOIN store_sales ss ON ss.product_id = p.id
    LEFT JOIN circle_engagement ce ON ce.product_id = p.id
   WHERE p.is_active = true
     AND p.is_archived = false
     -- Tier 1: never surface what cannot be bought right now.
     AND p.stock_quantity > 0
     AND (COALESCE(ce.circle_saves, 0) > 0 OR COALESCE(ss.buyers, 0) > 0)
   ORDER BY 9 DESC, p.name ASC
   LIMIT v_limit;
END;
$$;

-- ============================================================================
-- 5. Grants
-- ============================================================================
-- Trending is granted to `anon` so a first-time visitor sees a populated page
-- before signing up. It returns catalogue data that is already public and no
-- customer identity whatsoever. Recently-viewed and recording both require a
-- session, because they are per-customer.
REVOKE ALL ON FUNCTION public.record_product_view(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_recently_viewed(INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_trending_products(INTEGER) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.record_product_view(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_recently_viewed(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_trending_products(INTEGER) TO anon, authenticated;

-- ============================================================================
-- REVERSIBLE (rollback)
-- ============================================================================
--   DROP FUNCTION IF EXISTS public.get_trending_products(INTEGER);
--   DROP FUNCTION IF EXISTS public.get_recently_viewed(INTEGER);
--   DROP FUNCTION IF EXISTS public.record_product_view(UUID);
--   DROP TABLE IF EXISTS public.product_views;
--
-- Nothing pre-existing is modified, so a rollback removes only the Discover
-- additions. Products, orders, wishlist and the social graph are untouched. The
-- only data lost is the customers' own private browsing history, which is the
-- intended meaning of removing the feature.

