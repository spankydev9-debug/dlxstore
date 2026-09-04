-- DLXSTORE — DLX Rewards Foundation
-- Adds server-side loyalty/reward infrastructure:
--   reward_milestones  -> admin-configurable purchase/share thresholds
--   customer_rewards   -> awarded coupon records (one per profile per milestone)
--   share_events       -> rate-limited share audit log
--
-- All milestone evaluation and coupon award logic lives in SECURITY DEFINER
-- RPCs. Customers can never directly write reward_milestones or customer_rewards.
-- Share anti-abuse: one share event per customer per channel per 24 hours,
-- plus a global cap of 4 recorded share events per customer per rolling 24 hours
-- so people cannot bypass the channel rule by switching channels.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. REWARD MILESTONES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reward_milestones (
  id                 UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  label              TEXT    NOT NULL,
  milestone_type     TEXT    NOT NULL CHECK (milestone_type IN ('purchase_count', 'share_count')),
  threshold          INTEGER NOT NULL CHECK (threshold > 0),
  -- Coupon template fields (copied into a real coupon row when awarded)
  coupon_code_prefix TEXT    NOT NULL DEFAULT 'DLX',
  coupon_type        TEXT    NOT NULL DEFAULT 'percentage' CHECK (coupon_type IN ('percentage', 'fixed')),
  coupon_value       NUMERIC NOT NULL CHECK (coupon_value > 0),
  coupon_min_order   NUMERIC NOT NULL DEFAULT 0 CHECK (coupon_min_order >= 0),
  coupon_expires_days INTEGER,          -- NULL = never expires
  is_active          BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (milestone_type, threshold)   -- Makes milestone seed data safely rerunnable
);

ALTER TABLE public.reward_milestones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage reward milestones" ON public.reward_milestones;
CREATE POLICY "Admins manage reward milestones"
  ON public.reward_milestones FOR ALL
  USING (public.is_admin());

DROP POLICY IF EXISTS "Authenticated users can read active milestones" ON public.reward_milestones;
CREATE POLICY "Authenticated users can read active milestones"
  ON public.reward_milestones FOR SELECT
  USING (is_active = true AND auth.uid() IS NOT NULL);

-- Backfill the uniqueness rule when the table already exists from an earlier run.
-- PostgreSQL does not support ADD CONSTRAINT IF NOT EXISTS, so guard with a check.
DO $$
BEGIN
  -- If an earlier re-run of the unconstrained seed produced duplicate milestones,
  -- collapse them first (keep the earliest row) so the constraint can be added.
  DELETE FROM public.reward_milestones a
  USING public.reward_milestones b
  WHERE a.id > b.id
    AND a.milestone_type = b.milestone_type
    AND a.threshold = b.threshold;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reward_milestones_milestone_type_threshold_key'
      AND conrelid = 'public.reward_milestones'::regclass
  ) THEN
    ALTER TABLE public.reward_milestones
      ADD CONSTRAINT reward_milestones_milestone_type_threshold_key
      UNIQUE (milestone_type, threshold);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. CUSTOMER REWARDS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.customer_rewards (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  milestone_id    UUID        NOT NULL REFERENCES public.reward_milestones(id) ON DELETE CASCADE,
  coupon_id       UUID        NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  coupon_code     TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'awarded' CHECK (status IN ('awarded', 'used', 'expired')),
  awarded_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  expires_at      TIMESTAMPTZ,
  used_at         TIMESTAMPTZ,
  UNIQUE (profile_id, milestone_id)    -- One reward per customer per milestone (prevents duplicates)
);

CREATE INDEX IF NOT EXISTS customer_rewards_profile_idx ON public.customer_rewards(profile_id);
CREATE INDEX IF NOT EXISTS customer_rewards_status_idx  ON public.customer_rewards(status);

ALTER TABLE public.customer_rewards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Customers read their own rewards" ON public.customer_rewards;
CREATE POLICY "Customers read their own rewards"
  ON public.customer_rewards FOR SELECT
  USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "Admins read all rewards" ON public.customer_rewards;
CREATE POLICY "Admins read all rewards"
  ON public.customer_rewards FOR SELECT
  USING (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. SHARE EVENTS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.share_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  channel     TEXT        NOT NULL DEFAULT 'web' CHECK (channel IN ('web', 'whatsapp', 'copy_link', 'native_share')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS share_events_profile_idx ON public.share_events(profile_id);
CREATE INDEX IF NOT EXISTS share_events_profile_day_idx
  ON public.share_events(profile_id, channel, created_at DESC);

ALTER TABLE public.share_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Customers read their own share events" ON public.share_events;
CREATE POLICY "Customers read their own share events"
  ON public.share_events FOR SELECT
  USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "Admins read all share events" ON public.share_events;
CREATE POLICY "Admins read all share events"
  ON public.share_events FOR SELECT
  USING (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. REWARD COUPON OWNERSHIP ENFORCEMENT
--
-- Reward coupons must only be redeemable by the customer who earned them.
-- Ownership is inferred from customer_rewards (never from a browser claim).
-- This is enforced inside apply_order_coupon(), the SECURITY DEFINER BEFORE
-- INSERT trigger that already validates every coupon at order creation, so the
-- ownership check, the single used_count increment, and the reward consumption
-- all happen atomically in the same transaction as create_customer_order's
-- INSERT. Normal/admin/public coupons keep exactly their previous behaviour.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_order_coupon()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  selected_coupon  public.coupons%ROWTYPE;
  reward           public.customer_rewards%ROWTYPE;
  gross_amount     NUMERIC;
  expected_discount NUMERIC;
BEGIN
  IF NEW.coupon_code IS NULL OR btrim(NEW.coupon_code) = '' THEN
    NEW.coupon_code := NULL;
    NEW.discount_amount := 0;
    RETURN NEW;
  END IF;

  SELECT * INTO selected_coupon
  FROM public.coupons
  WHERE code = upper(btrim(NEW.coupon_code))
  FOR UPDATE;

  IF NOT FOUND
     OR NOT selected_coupon.active
     OR (selected_coupon.expires_at IS NOT NULL AND selected_coupon.expires_at <= now())
     OR (selected_coupon.max_uses IS NOT NULL AND selected_coupon.used_count >= selected_coupon.max_uses)
  THEN
    RAISE EXCEPTION 'Coupon is invalid or unavailable';
  END IF;

  -- When the coupon code matches a customer reward, the authenticated caller
  -- MUST own that reward: auth.uid() must equal customer_rewards.profile_id,
  -- the reward must be in 'awarded' state, and the reward must not be expired.
  -- auth.uid() in the trigger reflects the RPC caller, so a reward coupon
  -- submitted by any other customer is rejected here in the database.
  SELECT * INTO reward
  FROM public.customer_rewards
  WHERE coupon_code = selected_coupon.code;
  IF FOUND THEN
    IF reward.profile_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'This reward coupon belongs to another account';
    END IF;
    IF reward.status IS DISTINCT FROM 'awarded' THEN
      RAISE EXCEPTION 'This reward coupon has already been used';
    END IF;
    IF reward.expires_at IS NOT NULL AND reward.expires_at <= now() THEN
      RAISE EXCEPTION 'This reward coupon has expired';
    END IF;
  END IF;

  gross_amount := NEW.total_amount + COALESCE(NEW.discount_amount, 0);
  IF gross_amount < selected_coupon.min_order THEN
    RAISE EXCEPTION 'Coupon minimum order not reached';
  END IF;

  expected_discount := CASE
    WHEN selected_coupon.type = 'percentage' THEN round(gross_amount * selected_coupon.value / 100, 2)
    ELSE least(selected_coupon.value, gross_amount)
  END;
  IF COALESCE(NEW.discount_amount, 0) <> expected_discount THEN
    RAISE EXCEPTION 'Coupon discount does not match';
  END IF;

  NEW.coupon_code := selected_coupon.code;

  -- Increment coupon usage exactly once. The SELECT ... FOR UPDATE above
  -- serializes concurrent orders using the same code so multi-use coupons are
  -- never over-applied and this counters a double redemption of a reward coupon.
  UPDATE public.coupons SET used_count = used_count + 1 WHERE id = selected_coupon.id;

  -- Consume the earned reward in the same transaction so a reward coupon can
  -- never be redeemed twice.
  IF reward.id IS NOT NULL THEN
    UPDATE public.customer_rewards
    SET status = 'used', used_at = timezone('utc', now())
    WHERE id = reward.id;
  END IF;

  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. HELPER: generate a unique reward coupon code
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_reward_coupon_code(p_prefix TEXT, p_profile_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code TEXT;
  v_attempt INT := 0;
BEGIN
  LOOP
    v_attempt := v_attempt + 1;
    v_code := upper(p_prefix) || '-' ||
              substr(encode(sha256(p_profile_id::TEXT::BYTEA || v_attempt::TEXT::BYTEA), 'hex'), 1, 8);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.coupons WHERE code = v_code);
    IF v_attempt > 20 THEN
      RAISE EXCEPTION 'Could not generate a unique coupon code after 20 attempts';
    END IF;
  END LOOP;
  RETURN v_code;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. HELPER: award a single milestone (atomic + idempotent)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.award_milestone_if_not_awarded(
  p_profile_id  UUID,
  p_milestone   public.reward_milestones
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code        TEXT;
  v_coupon_id   UUID;
  v_expires_at  TIMESTAMPTZ;
BEGIN
  -- Serialize concurrent awards for the same (profile, milestone) pair. Without
  -- this, two racing transactions could both pass the EXISTS check below, each
  -- would create its own real coupon, and the loser would silently leave an
  -- orphan coupon behind when its customer_rewards INSERT hits ON CONFLICT.
  -- The transaction-level advisory lock guarantees exactly one coupon per
  -- awarded milestone; the ON CONFLICT guard below remains as belt-and-braces.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_profile_id::TEXT || ':' || p_milestone.id::TEXT, 0)
  );

  -- Idempotency: the UNIQUE(profile_id, milestone_id) constraint handles duplicates.
  -- We use ON CONFLICT DO NOTHING so this is safe to call multiple times.
  IF EXISTS (
    SELECT 1 FROM public.customer_rewards
    WHERE profile_id = p_profile_id AND milestone_id = p_milestone.id
  ) THEN
    RETURN;
  END IF;

  -- Generate a unique code for this customer + milestone
  v_code := public.generate_reward_coupon_code(p_milestone.coupon_code_prefix, p_profile_id);

  IF p_milestone.coupon_expires_days IS NOT NULL THEN
    v_expires_at := timezone('utc', now()) + (p_milestone.coupon_expires_days || ' days')::INTERVAL;
  END IF;

  -- Create the real coupon
  INSERT INTO public.coupons (code, type, value, min_order, max_uses, audience, expires_at, active)
  VALUES (v_code, p_milestone.coupon_type, p_milestone.coupon_value, p_milestone.coupon_min_order,
          1, 'campaign', v_expires_at, true)
  RETURNING id INTO v_coupon_id;

  -- Record the reward
  INSERT INTO public.customer_rewards
    (profile_id, milestone_id, coupon_id, coupon_code, status, expires_at)
  VALUES
    (p_profile_id, p_milestone.id, v_coupon_id, v_code, 'awarded', v_expires_at)
  ON CONFLICT (profile_id, milestone_id) DO NOTHING;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RPC: check purchase milestones for a customer (called from order trigger)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_purchase_milestones(p_profile_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_count BIGINT;
  v_milestone   public.reward_milestones;
BEGIN
  -- Count only qualifying (delivered) orders
  SELECT count(*) INTO v_order_count
  FROM public.orders
  WHERE customer_id = p_profile_id
    AND status = 'delivered';

  FOR v_milestone IN
    SELECT * FROM public.reward_milestones
    WHERE milestone_type = 'purchase_count'
      AND is_active = true
      AND threshold <= v_order_count
    ORDER BY threshold ASC
  LOOP
    PERFORM public.award_milestone_if_not_awarded(p_profile_id, v_milestone);
  END LOOP;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. TRIGGER: auto-check milestones when an order is marked delivered
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_check_rewards_on_order_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only fire when status transitions TO 'delivered'
  IF NEW.status = 'delivered' AND (OLD.status IS DISTINCT FROM 'delivered') AND NEW.customer_id IS NOT NULL THEN
    PERFORM public.check_purchase_milestones(NEW.customer_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rewards_on_order_update ON public.orders;
CREATE TRIGGER trg_rewards_on_order_update
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.trg_check_rewards_on_order_update();

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. RPC: record_share_event (anti-abuse: per-channel cooldown + global 24 h cap)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_share_event(p_channel TEXT DEFAULT 'web')
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid             UUID := auth.uid();
  v_channel         TEXT := lower(btrim(p_channel));
  v_event_id        UUID;
  v_share_count     BIGINT;
  v_rewards_before  BIGINT;
  v_rewards_after   BIGINT;
  v_milestone       public.reward_milestones;
  v_awarded         BOOLEAN := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF v_channel NOT IN ('web', 'whatsapp', 'copy_link', 'native_share') THEN
    RAISE EXCEPTION 'Invalid share channel';
  END IF;

  -- Anti-abuse: at most one event per channel per 24 hours per customer
  IF EXISTS (
    SELECT 1 FROM public.share_events
    WHERE profile_id = v_uid
      AND channel = v_channel
      AND created_at > now() - INTERVAL '24 hours'
  ) THEN
    RETURN jsonb_build_object(
      'recorded', false,
      'reason', 'cooldown',
      'awarded', false
    );
  END IF;

  -- Global anti-abuse: cap recorded share events at 4 per rolling 24 hours
  -- across ALL channels so a customer cannot bypass the per-channel cooldown
  -- simply by switching between web, whatsapp, copy_link and native_share.
  IF (
    SELECT count(*) FROM public.share_events
    WHERE profile_id = v_uid AND created_at > now() - INTERVAL '24 hours'
  ) >= 4 THEN
    RETURN jsonb_build_object(
      'recorded', false,
      'reason', 'daily_limit',
      'awarded', false
    );
  END IF;

  INSERT INTO public.share_events (profile_id, channel)
  VALUES (v_uid, v_channel)
  RETURNING id INTO v_event_id;

  -- Re-count total share events for this user and check milestones
  SELECT count(*) INTO v_share_count
  FROM public.share_events
  WHERE profile_id = v_uid;

  SELECT count(*) INTO v_rewards_before
  FROM public.customer_rewards
  WHERE profile_id = v_uid;

  FOR v_milestone IN
    SELECT * FROM public.reward_milestones
    WHERE milestone_type = 'share_count'
      AND is_active = true
      AND threshold <= v_share_count
    ORDER BY threshold ASC
  LOOP
    PERFORM public.award_milestone_if_not_awarded(v_uid, v_milestone);
  END LOOP;

  -- 'awarded' is true only when this event actually unlocked a new reward
  SELECT count(*) INTO v_rewards_after
  FROM public.customer_rewards
  WHERE profile_id = v_uid;

  v_awarded := v_rewards_after > v_rewards_before;

  RETURN jsonb_build_object(
    'recorded', true,
    'share_count', v_share_count,
    'awarded', v_awarded
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. RPC: get_my_rewards_summary (dashboard read — no writes)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_rewards_summary()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid               UUID := auth.uid();
  v_order_count       BIGINT;
  v_share_count       BIGINT;
  v_next_purchase_ms  JSONB;
  v_next_share_ms     JSONB;
  v_rewards           JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT count(*) INTO v_order_count
  FROM public.orders
  WHERE customer_id = v_uid AND status = 'delivered';

  SELECT count(*) INTO v_share_count
  FROM public.share_events
  WHERE profile_id = v_uid;

  -- Next purchase milestone not yet awarded
  SELECT to_jsonb(m.*) INTO v_next_purchase_ms
  FROM public.reward_milestones m
  WHERE m.milestone_type = 'purchase_count'
    AND m.is_active = true
    AND m.threshold > v_order_count
    AND NOT EXISTS (
      SELECT 1 FROM public.customer_rewards cr
      WHERE cr.profile_id = v_uid AND cr.milestone_id = m.id
    )
  ORDER BY m.threshold ASC
  LIMIT 1;

  -- Next share milestone not yet awarded
  SELECT to_jsonb(m.*) INTO v_next_share_ms
  FROM public.reward_milestones m
  WHERE m.milestone_type = 'share_count'
    AND m.is_active = true
    AND m.threshold > v_share_count
    AND NOT EXISTS (
      SELECT 1 FROM public.customer_rewards cr
      WHERE cr.profile_id = v_uid AND cr.milestone_id = m.id
    )
  ORDER BY m.threshold ASC
  LIMIT 1;

  -- All rewards with coupon details
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id',             cr.id,
      'profile_id',     cr.profile_id,
      'milestone_id',   cr.milestone_id,
      'coupon_id',      cr.coupon_id,
      'coupon_code',    cr.coupon_code,
      'status',         cr.status,
      'awarded_at',     cr.awarded_at,
      'expires_at',     cr.expires_at,
      'used_at',        cr.used_at,
      'milestone_label', m.label,
      'coupon_type',    c.type,
      'coupon_value',   c.value
    )
    ORDER BY cr.awarded_at DESC
  ), '[]'::JSONB) INTO v_rewards
  FROM public.customer_rewards cr
  JOIN public.reward_milestones m ON m.id = cr.milestone_id
  JOIN public.coupons c ON c.id = cr.coupon_id
  WHERE cr.profile_id = v_uid;

  RETURN jsonb_build_object(
    'qualifying_order_count', v_order_count,
    'share_count',            v_share_count,
    'next_purchase_milestone', v_next_purchase_ms,
    'next_share_milestone',   v_next_share_ms,
    'rewards',                v_rewards
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. GRANTS
-- ─────────────────────────────────────────────────────────────────────────────
-- Only the RPCs the application actually calls are granted to authenticated.
-- All other reward functions are internal SECURITY DEFINER helpers invoked by
-- triggers or by other functions: customers must never invoke them directly
-- (e.g. checking milestones for arbitrary profile IDs), so their default
-- PUBLIC EXECUTE privilege is revoked.
REVOKE ALL ON FUNCTION public.check_purchase_milestones(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.award_milestone_if_not_awarded(UUID, public.reward_milestones) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_reward_coupon_code(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_check_rewards_on_order_update() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.record_share_event(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_rewards_summary() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. SEED: default milestones
-- Adjust thresholds and coupon values to match business decisions.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.reward_milestones
  (label, milestone_type, threshold, coupon_code_prefix, coupon_type, coupon_value, coupon_min_order, coupon_expires_days)
VALUES
  ('5 premières commandes livrées',  'purchase_count', 5,  'DLX5',  'percentage', 5,  10, 60),
  ('10 commandes livrées',           'purchase_count', 10, 'DLX10', 'percentage', 10, 15, 60),
  ('20 commandes livrées',           'purchase_count', 20, 'DLX20', 'fixed',      5,  20, 90),
  ('5 partages DLXSTORE',            'share_count',    5,  'SHARE5','percentage', 5,  10, 30),
  ('10 partages DLXSTORE',           'share_count',    10, 'SHARE10','percentage',10,  15, 30)
ON CONFLICT (milestone_type, threshold) DO NOTHING;

-- REVERSIBLE (rollback)
--   DROP TRIGGER IF EXISTS trg_rewards_on_order_update ON public.orders;
--   DROP FUNCTION IF EXISTS public.trg_check_rewards_on_order_update();
--   DROP FUNCTION IF EXISTS public.get_my_rewards_summary();
--   DROP FUNCTION IF EXISTS public.record_share_event(TEXT);
--   DROP FUNCTION IF EXISTS public.check_purchase_milestones(UUID);
--   DROP FUNCTION IF EXISTS public.award_milestone_if_not_awarded(UUID, public.reward_milestones);
--   DROP FUNCTION IF EXISTS public.generate_reward_coupon_code(TEXT, UUID);
--   DROP TABLE IF EXISTS public.share_events;
--   DROP TABLE IF EXISTS public.customer_rewards;
--   DROP TABLE IF EXISTS public.reward_milestones;
