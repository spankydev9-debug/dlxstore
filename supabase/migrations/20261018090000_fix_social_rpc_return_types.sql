-- ============================================================================
-- Forward fix — two shipped RPCs that exist but have never executed
-- ============================================================================
--
-- Both functions below were created by earlier migrations, are present in the
-- production ledger, and are called by live storefront code. Neither has ever
-- run successfully: PostgREST rejected both on every call with a SQLSTATE, the
-- callers swallow the error, and the affected UI silently renders without the
-- feature. Confirmed against production on 2026-10-04:
--
--   /discover          POST /rest/v1/rpc/get_trending_products
--                      -> 400, SQLSTATE 42P10
--                         "ORDER BY position 9 is not in select list"
--   /product/[slug]    POST /rest/v1/rpc/get_product_social_proof
--                      -> 400, SQLSTATE 42804
--                         "Returned type bigint does not match expected type
--                          integer in column 2."
--
-- This file only repairs those two function bodies. It creates no tables, adds
-- no columns, changes no data, and touches no other object.
--
-- ---------------------------------------------------------------------------
-- 1. public.get_trending_products(INTEGER) — 42P10
-- ---------------------------------------------------------------------------
-- Defined in 20261009090000_discover_recent_and_trending.sql.
--
-- The body ends:
--
--     ORDER BY 9 DESC, p.name ASC
--
-- but the function's RETURNS TABLE has exactly EIGHT columns:
--
--     1 id           p.id
--     2 name         p.name
--     3 slug         p.slug
--     4 price        p.price
--     5 discount_price p.discount_price
--     6 image_url    (SELECT pi.image_url ... LIMIT 1)
--     7 product_type p.product_type
--     8 score        (COALESCE(ce.circle_saves,0)*3 + COALESCE(ss.buyers,0))::INTEGER
--
-- and the RETURN QUERY select list emits those same eight expressions in that
-- same order. Position 9 has never existed in any revision of this function, so
-- the reference is out of range and PostgreSQL rejects the statement outright
-- (42P10) rather than falling back to some other ordering.
--
-- What position 9 was INTENDED to be: the trending score. The inline comment on
-- the eighth expression states the ranking rule outright — "Circle saves weigh
-- more than store volume: a save by someone you follow is a stronger signal
-- about your taste than an anonymous storewide sale" — and the expression is
-- the only computed ranking metric in the query. The trailing `p.name ASC` is
-- a deterministic tiebreaker, which only makes sense against a score column.
-- The author almost certainly had a ninth output column in an earlier draft
-- (a raw view count, most likely) that was later folded into the single
-- composite `score`, leaving the positional reference un-renumbered.
--
-- The fix names the column and sorts by name:
--
--     (COALESCE(...) * 3 + COALESCE(...))::INTEGER AS score
--     ...
--     ORDER BY score DESC, p.name ASC
--
-- This is deliberately not `ORDER BY 8`. Both are correct today, but a bare
-- ordinal is exactly what broke here: it silently rots the next time someone
-- adds or removes an output column, and it rots silently because 42P10 is only
-- raised when the ordinal exceeds the list. Naming the column keeps the
-- intended ranking and removes the failure mode. Ordering is unchanged in
-- substance: score descending, then name ascending.
--
-- ---------------------------------------------------------------------------
-- 2. public.get_product_social_proof(UUID) — 42804
-- ---------------------------------------------------------------------------
-- Defined in 20261008090000_social_commerce_core.sql.
--
-- plpgsql type-checks a RETURN QUERY tuple against the declared RETURNS TABLE
-- and requires an exact column-type match. Three of the nine columns were
-- bigint where INTEGER was declared, because `COUNT(...)` returns bigint:
--
--   position 2  buyer_count           COUNT(DISTINCT o.customer_id)          -- no cast
--   position 5  circle_buyer_count    CASE ... THEN 0 ELSE COUNT(...) END    -- no cast
--   position 6  circle_wishlist_count CASE ... THEN 0 ELSE COUNT(...) END    -- no cast
--
-- Positions 3 and 4 (wishlist_count, share_count) already carried `::INTEGER`,
-- so the intent is unambiguous and this is an oversight, not a design choice.
--
-- Worth recording: fixing only position 2 does NOT fix the function.
-- PostgreSQL reports one mismatch at a time, so a one-line fix moves the error
-- from "column 2" to "column 5" and the RPC still returns 400. The CASE
-- expressions are the subtle part — `THEN 0` is an integer literal and `ELSE
-- COUNT(...)` is bigint, so PostgreSQL resolves the CASE to bigint regardless of
-- what the literal branch suggests. The cast therefore has to go on the
-- aggregate inside the ELSE branch, which makes both arms integer and lets the
-- CASE resolve to INTEGER as declared.
--
-- The smallest safe change is applied: `::INTEGER` on those three aggregates,
-- nothing else. Column order, arity, names, types, volatility, security
-- definer, search_path and the whole of the visibility/blocking logic are
-- untouched, so the return contract callers depend on is unchanged. Both the
-- "only completed sales count as proof" rule and the "signed-out callers get 0
-- rather than an error" rule are preserved verbatim.
--
-- ---------------------------------------------------------------------------
-- Safety
-- ---------------------------------------------------------------------------
-- CREATE OR REPLACE with an unchanged signature preserves the existing owner,
-- ACL and comment. REVOKE/GRANT are re-issued to match the convention of the
-- migrations that created these functions and to keep the grants explicit;
-- they are idempotent. Both functions are read-only SELECT wrappers, so no
-- caller can observe a behavioural change beyond the functions now returning
-- rows at all.
--
-- Regression coverage lives in supabase/tests/p15_social_rpc_returns.sql.
--
--   DROP FUNCTION IF EXISTS public.get_trending_products(INTEGER);
--   DROP FUNCTION IF EXISTS public.get_product_social_proof(UUID);
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. get_trending_products — rank by the named score column, not position 9
-- ----------------------------------------------------------------------------
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
AS $fn$
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
         (COALESCE(ce.circle_saves, 0) * 3 + COALESCE(ss.buyers, 0))::INTEGER AS score
    FROM public.products p
    LEFT JOIN store_sales ss ON ss.product_id = p.id
    LEFT JOIN circle_engagement ce ON ce.product_id = p.id
   WHERE p.is_active = true
     AND p.is_archived = false
     -- Tier 1: never surface what cannot be bought right now.
     AND p.stock_quantity > 0
     AND (COALESCE(ce.circle_saves, 0) > 0 OR COALESCE(ss.buyers, 0) > 0)
   ORDER BY score DESC, p.name ASC
   LIMIT v_limit;
END;
$fn$;

-- ----------------------------------------------------------------------------
-- 2. get_product_social_proof — cast the three bigint aggregates to INTEGER
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_product_social_proof(p_product_id UUID)
RETURNS TABLE (
    product_id            UUID,
    buyer_count           INTEGER,
    wishlist_count        INTEGER,
    share_count           INTEGER,
    circle_buyer_count    INTEGER,
    circle_wishlist_count INTEGER,
    i_bought_it           BOOLEAN,
    i_wishlisted_it       BOOLEAN,
    shared_with_me        BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
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
    (SELECT COUNT(DISTINCT o.customer_id)::INTEGER
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
      SELECT COUNT(DISTINCT o.customer_id)::INTEGER
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
      SELECT COUNT(DISTINCT w.user_id)::INTEGER
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
    -- "X shared this with me" is the one place a share reveals that a specific
    -- person acted, because the recipient is the one being told. No name is
    -- returned here; the UI already knows who the signed-in customer is.
    CASE WHEN v_uid IS NULL THEN false ELSE EXISTS (
      SELECT 1 FROM public.product_shares s
       WHERE s.product_id = p_product_id AND s.recipient_id = v_uid
    ) END;
END;
$fn$;

-- ----------------------------------------------------------------------------
-- Grants — idempotent; kept explicit to match the defining migrations
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_trending_products(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_product_social_proof(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_trending_products(INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_product_social_proof(UUID) TO anon, authenticated;