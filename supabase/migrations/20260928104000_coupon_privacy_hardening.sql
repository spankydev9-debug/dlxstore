-- DLXSTORE — coupon privacy hardening
--
-- Apply only after the remote migration history is confirmed. This supersedes
-- the original public active-coupon SELECT policy with a minimal validation
-- RPC, so campaign and reward codes cannot be enumerated from the browser.

ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read active coupons for validation" ON public.coupons;
DROP POLICY IF EXISTS "Admins can manage coupons" ON public.coupons;

CREATE POLICY "Admins manage coupons"
  ON public.coupons FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

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

  SELECT * INTO v_coupon
  FROM public.coupons
  WHERE code = upper(btrim(p_code));

  IF NOT FOUND
    OR NOT v_coupon.active
    OR (v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at <= now())
    OR (v_coupon.max_uses IS NOT NULL AND v_coupon.used_count >= v_coupon.max_uses)
    OR p_subtotal < v_coupon.min_order
  THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.orders
    WHERE customer_id = auth.uid() AND status = 'delivered'
  ) INTO v_is_returning;

  SELECT EXISTS (
    SELECT 1 FROM public.customer_rewards
    WHERE coupon_id = v_coupon.id
      AND profile_id = auth.uid()
      AND status = 'awarded'
      AND (expires_at IS NULL OR expires_at > now())
  ) INTO v_is_reward_owner;

  IF (v_coupon.audience = 'returning' AND NOT v_is_returning)
    OR (v_coupon.audience IN ('referral', 'campaign') AND NOT v_is_reward_owner)
    OR (EXISTS (SELECT 1 FROM public.customer_rewards WHERE coupon_id = v_coupon.id) AND NOT v_is_reward_owner)
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

REVOKE ALL ON FUNCTION public.quote_coupon(TEXT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.quote_coupon(TEXT, NUMERIC) TO authenticated;
