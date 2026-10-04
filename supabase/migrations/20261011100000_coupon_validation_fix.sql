-- ============================================================================
-- DLXSTORE — coupon validation correctness and residual grant hardening
--
-- SECURITY + CORRECTNESS FIX. Verified against a real Postgres 17 instance;
-- see docs/CHECKPOINT-SEC-01-SHOP-STATS.md for the transcripts.
--
-- THE DEFECT (confirmed by test, not inferred)
-- --------------------------------------------
-- `quote_coupon()` in 20260928104000_coupon_privacy_hardening.sql declares
-- `RETURNS TABLE (id, code, type, value, min_order, expires_at, discount)`. In
-- PL/pgSQL every RETURNS TABLE column name becomes an implicitly declared output
-- variable. The body then references bare column names that collide with those
-- variables. There are THREE such collisions, each an independent hard error:
--
--   1. WHERE code = upper(btrim(p_code))               -- "code" is ambiguous
--   2. AND (expires_at IS NULL OR expires_at > now())  -- "expires_at" is ambiguous
--   3. WHERE coupon_id = v_coupon.id / profile_id = ...  -- "id" would collide too,
--      once reached; `id` is an output variable AND a column of customer_rewards
--
-- Postgres rejects each with:
--
--   ERROR: column reference "<name>" is ambiguous
--   DETAIL: It could refer to either a PL/pgSQL variable or a table column.
--
-- Reproduced as a legitimate signed-in customer applying a valid public coupon:
--   SELECT * FROM public.quote_coupon('WELCOME10', 100);
--   -> ERROR (every call, for every customer, for every coupon)
--
-- This is worse than the documented vulnerability: it is not that coupons leak, it
-- is that coupon validation is entirely non-functional. The client
-- (`src/services/db/coupons.ts:validateCoupon`) throws on any error whose code is
-- not PGRST202, so every checkout that tries to apply a coupon fails outright.
--
-- THE FIX
-- -------
-- Table-alias and qualify EVERY column reference in the body (`c.`, `o.`, `cr.`).
-- That removes all three ambiguities without renaming any output column, so the
-- RPC's return shape — and therefore the existing TypeScript client — is unchanged.
-- No API change.
--
-- RESIDUAL GRANT ISSUE (also confirmed)
-- ------------------------------------
-- The prepared fix ends with `REVOKE ALL ... FROM PUBLIC`, which — as
-- 20261007090000_revoke_internal_helper_grants.sql documents — removes nothing in
-- practice, because Supabase's platform-level default privileges leave `anon` with
-- EXECUTE. Verified on this instance:
--
--   quote_coupon -> {postgres=X,anon=X,authenticated=X,service_role=X}
--
-- An anonymous caller currently reaches the function body. It returns no rows
-- only because of the `auth.uid() IS NULL` guard inside it. That is defence in
-- depth working by accident of code order, not an authorization boundary: any
-- future edit that reorders or removes that guard re-exposes the function.
--
-- So this file also performs the explicit `REVOKE ... FROM anon`, which actually
-- takes effect, while keeping `authenticated` (the legitimate checkout caller) and
-- `service_role` (server routes).
--
-- Direct table reads of `coupons` remain protected by the "Admins manage coupons"
-- policy, verified: anon and a signed-in non-admin both read 0 rows. This file
-- therefore does NOT reopen or duplicate any policy — it fixes the RPC and its
-- grant, nothing else.
--
-- Purely additive and idempotent. No coupon row is modified or deleted.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.quote_coupon(
  p_code TEXT,
  p_subtotal NUMERIC
)
RETURNS TABLE (
  id UUID,
  code TEXT,
  type TEXT,
  value NUMERIC,
  min_order NUMERIC,
  expires_at TIMESTAMPTZ,
  discount NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_coupon public.coupons%ROWTYPE;
  v_is_returning BOOLEAN;
  v_is_reward_owner BOOLEAN;
  v_discount NUMERIC;
BEGIN
  IF auth.uid() IS NULL OR p_subtotal IS NULL OR p_subtotal < 0 THEN
    RETURN;
  END IF;

  -- `c.` qualification is required: the unqualified `code` collides with the
  -- RETURNS TABLE output variable of the same name. Without it this function
  -- raises "column reference code is ambiguous" on every call.
  SELECT c.* INTO v_coupon
    FROM public.coupons c
   WHERE c.code = upper(btrim(p_code));

  IF NOT FOUND
    OR NOT v_coupon.active
    OR (v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at <= now())
    OR (v_coupon.max_uses IS NOT NULL AND v_coupon.used_count >= v_coupon.max_uses)
    OR p_subtotal < v_coupon.min_order
  THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.customer_id = auth.uid() AND o.status = 'delivered'
  ) INTO v_is_returning;

  SELECT EXISTS (
    SELECT 1 FROM public.customer_rewards cr
    WHERE cr.coupon_id = v_coupon.id
      AND cr.profile_id = auth.uid()
      AND cr.status = 'awarded'
      AND (cr.expires_at IS NULL OR cr.expires_at > now())
  ) INTO v_is_reward_owner;

  -- A coupon awarded to at least one customer is private to its owners, whatever
  -- its declared audience: otherwise a reward code could be guessed by anyone who
  -- knows it exists.
  IF (v_coupon.audience = 'returning' AND NOT v_is_returning)
    OR (v_coupon.audience IN ('referral', 'campaign') AND NOT v_is_reward_owner)
    OR (EXISTS (SELECT 1 FROM public.customer_rewards cr2
                 WHERE cr2.coupon_id = v_coupon.id)
        AND NOT v_is_reward_owner)
  THEN
    RETURN;
  END IF;

  v_discount := CASE
    WHEN v_coupon.type = 'percentage' THEN round(p_subtotal * v_coupon.value / 100, 2)
    ELSE least(v_coupon.value, p_subtotal)
  END;

  RETURN QUERY SELECT
    v_coupon.id,
    v_coupon.code,
    v_coupon.type,
    v_coupon.value,
    v_coupon.min_order,
    v_coupon.expires_at,
    v_discount;
END;
$$;

-- Remove the platform-default EXECUTE grants that `REVOKE ... FROM PUBLIC` cannot
-- reach. `authenticated` is kept because checkout is a legitimate browser caller;
-- `service_role` is kept because the server-side API routes run as service_role.
REVOKE ALL ON FUNCTION public.quote_coupon(TEXT, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quote_coupon(TEXT, NUMERIC) TO authenticated, service_role;

-- REVERSIBLE (rollback)
--   REVOKE ALL ON FUNCTION public.quote_coupon(TEXT, NUMERIC) FROM anon;
--   GRANT EXECUTE ON FUNCTION public.quote_coupon(TEXT, NUMERIC) TO anon, authenticated;
--
-- The rollback restores both the ambiguous-column body and the anon grant, i.e.
-- the pre-fix state. It is written for a conscious operator decision.
