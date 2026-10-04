-- ============================================================================
-- DLXSTORE — partner shop statistics authorization
--
-- SECURITY FIX. Confirmed by direct testing against a real Postgres 17 instance,
-- not inferred. See docs/CHECKPOINT-SEC-01-SHOP-STATS.md for the transcript.
--
-- THE VULNERABILITY (confirmed)
-- ----------------------------
-- `get_shop_stats(uuid)` in 20260826170000_partner_shop_foundation.sql is
-- SECURITY DEFINER, contains no authorization check, and returns per-shop
-- `total_revenue`. It is never granted or revoked anywhere, so Supabase's
-- platform-level default privileges leave EXECUTE on `anon`:
--
--   SELECT proacl FROM pg_proc WHERE proname = 'get_shop_stats';
--   {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,...}
--
-- Reproduced as role `anon` with no session and no JWT:
--   SELECT * FROM public.get_shop_stats('<shop uuid>');
--   -> product_count=1, total_orders=1, total_revenue=999999
--
-- Because the function is SECURITY DEFINER it runs with the definer's rights and
-- the RLS inside it applies to the definer, so no table policy can stop this. Any
-- anonymous HTTP caller can enumerate shop revenue through PostgREST at
-- POST /rest/v1/rpc/get_shop_stats.
--
-- WHY THIS IS NOT A BLANKET REVOKE
-- --------------------------------
-- `src/services/db/partner-shops.ts:236` calls this RPC from the browser. Its only
-- caller is `PartnerControls.tsx`, which is rendered solely from
-- `/admin/dashboard`, gated on `user.role === "admin"`. Revoking EXECUTE outright
-- would break a legitimate operator screen in exchange for hiding a number from an
-- admin who is already entitled to it. So the fix scopes the *data* instead: the
-- caller must be an admin or the shop's own owner.
--
-- This is why 20261007090000_revoke_internal_helper_grants.sql deliberately left
-- this function alone and tracked it as an open decision. This file closes it.
--
-- DESIGN
-- ------
-- * Admin -> full numbers. This is the existing, legitimate admin flow and is
--   preserved exactly.
-- * Vendor who owns the shop (vendors.profile_id = auth.uid()) -> their own
--   numbers, which is strictly more than they had before and is what a seller
--   should be able to see.
-- * Anyone else, including anonymous -> no rows at all. This is a deliberate
--   change from "return the numbers": silently returning zeros would tell a
--   legitimate admin their stats are empty and would be a worse failure than an
--   error.
-- * `auth.uid() IS NULL` is checked explicitly so an anonymous caller cannot
--   accidentally match a shop whose `profile_id` happens to be NULL. Note that
--   `vendors.profile_id` is nullable (ON DELETE SET NULL), so a deleted owner
--   leaves a NULL that must NOT be treated as a match.
-- * The admin test is inline (`role = 'admin'`) rather than `public.is_admin()`:
--   that helper is defined with `role = "admin"` (double quotes) in
--   20260816150230 and 20260823132900, which Postgres reads as a column reference.
--   Using it here would make this security fix silently non-functional.
--
-- Purely a permissions/authorization change: no table, column, row or grant on any
-- unrelated object is modified. Idempotent.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_shop_stats(shop_id UUID)
RETURNS TABLE(
  product_count BIGINT,
  total_orders BIGINT,
  total_revenue NUMERIC
) AS $$
DECLARE
  -- Explicitly NULL for an anonymous caller. `coalesce(..., false)` would hide the
  -- NULL profile_id case behind a boolean and let a deleted-owner shop match.
  v_is_admin BOOLEAN := COALESCE(
    (SELECT EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = auth.uid() AND p.role = 'admin'
    )), false
  );
  v_owns_shop BOOLEAN := COALESCE(
    (SELECT EXISTS (
      SELECT 1 FROM public.vendors v
       WHERE v.id = get_shop_stats.shop_id
         AND v.profile_id = auth.uid()
    )), false
  );
BEGIN
  -- No session, or a session that is neither an admin nor the shop owner: return
  -- no rows rather than the requested shop's financials.
  IF auth.uid() IS NULL OR NOT (v_is_admin OR v_owns_shop) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    COUNT(DISTINCT sp.product_id)::BIGINT,
    COUNT(DISTINCT o.id)::BIGINT,
    COALESCE(SUM(o.total_amount), 0)
  FROM public.shop_products sp
  LEFT JOIN public.order_items oi ON oi.product_id = sp.product_id
  LEFT JOIN public.orders o ON o.id = oi.order_id
  WHERE sp.shop_id = get_shop_stats.shop_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Drop the platform-level default EXECUTE grants that made this reachable, then
-- grant only what a legitimate browser caller needs. `service_role` is retained
-- because the server-side API routes run as service_role.
REVOKE ALL ON FUNCTION public.get_shop_stats(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_shop_stats(UUID) TO authenticated, service_role;

-- REVERSIBLE (rollback)
--   REVOKE ALL ON FUNCTION public.get_shop_stats(UUID) FROM anon;
--   GRANT EXECUTE ON FUNCTION public.get_shop_stats(UUID) TO anon, authenticated;
--
-- The rollback restores the vulnerable state deliberately; it is written for a
-- conscious operator decision, not as a routine undo.
