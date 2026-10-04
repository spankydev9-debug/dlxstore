-- ============================================================================
-- Phase 11 (P11) — Growth & loyalty
-- Roadmap Phase 17. Rewards, points, loyalty levels, shopping/streak/referral/
-- birthday rewards, VIP benefits, referral system, flash sales, bundles,
-- campaigns and personalised promotions, abandoned-cart recovery.
--
-- What already existed and is deliberately extended rather than duplicated:
--   * public.coupons                  (20260818190600) - coupon validation
--   * public.reward_milestones        (20260902120000) - milestone -> coupon
--   * public.customer_rewards         (20260902120000) - awarded coupons
-- The milestone system awards *coupons*. This migration adds *points*, *tiers*,
-- *referrals*, *flash sales*, *bundles*, *campaigns*, *personalised
-- promotions* and *cart recovery*, which none of the above covered.
--
-- Design notes:
--   * points_ledger is the append-only source of truth; customer_points is a
--     cached balance kept correct by trigger. Balances can always be rebuilt
--     from the ledger with public.rebuild_points_balance().
--   * Every award is keyed on (profile_id, reason, reference_id) so re-running
--     an award -- a retried webhook, a re-delivered order, a double-click -- can
--     never mint points twice.
--   * Tier is a pure function of lifetime_earned, so it cannot drift.
--   * All RPCs are SECURITY DEFINER with a pinned search_path and are granted
--     only to the roles that need them. Internal writers are revoked from
--     PUBLIC *and* anon, because Supabase's default ACL grants both roles and
--     revoking only from PUBLIC does nothing. This is the trap recorded in the
--     Phase 4 Streaks and Phase 13 Discover findings.
-- ============================================================================

-- ============================================================================
-- 1. Loyalty tiers
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.loyalty_tiers (
  id                    UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  TEXT    NOT NULL UNIQUE
                                  CHECK (code IN ('bronze', 'silver', 'gold', 'vip')),
  label                 TEXT    NOT NULL,
  min_points            INTEGER NOT NULL CHECK (min_points >= 0),
  -- Benefits
  discount_percent      NUMERIC NOT NULL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 100),
  free_shipping         BOOLEAN NOT NULL DEFAULT false,
  early_access          BOOLEAN NOT NULL DEFAULT false,
  birthday_bonus_points INTEGER NOT NULL DEFAULT 0 CHECK (birthday_bonus_points >= 0),
  points_multiplier     NUMERIC NOT NULL DEFAULT 1 CHECK (points_multiplier >= 0),
  sort_order            INTEGER NOT NULL DEFAULT 0,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (min_points)
);

COMMENT ON TABLE public.loyalty_tiers IS
  'Loyalty levels. Tier is derived from points_ledger.lifetime_earned, never stored as truth.';

INSERT INTO public.loyalty_tiers
  (code, label, min_points, discount_percent, free_shipping, early_access, birthday_bonus_points, points_multiplier, sort_order)
VALUES
  ('bronze', 'Bronze',       0,    0,  false, false,   50, 1.0, 1),
  ('silver', 'Silver',     500,    5,  false, false,  100, 1.2, 2),
  ('gold',   'Gold',      2000,   10,  true,  false,  200, 1.5, 3),
  ('vip',    'VIP',      10000,   20,  true,  true,   500, 2.0, 4)
ON CONFLICT (code) DO UPDATE SET
  label                 = EXCLUDED.label,
  min_points            = EXCLUDED.min_points,
  discount_percent      = EXCLUDED.discount_percent,
  free_shipping         = EXCLUDED.free_shipping,
  early_access          = EXCLUDED.early_access,
  birthday_bonus_points = EXCLUDED.birthday_bonus_points,
  points_multiplier     = EXCLUDED.points_multiplier,
  sort_order            = EXCLUDED.sort_order;

-- ============================================================================
-- 2. Configurable economics (so tuning never needs a migration)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.loyalty_settings (
  key        TEXT PRIMARY KEY,
  value      NUMERIC NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

INSERT INTO public.loyalty_settings (key, value) VALUES
  ('points_per_usd',        0.2),   -- 1 point per 5 USD of delivered spend
  ('referral_referrer_pts', 500),
  ('referral_referee_pts',  250),
  ('referral_signed_up_pts', 100),
  ('referral_min_order',    25),    -- USD; order value that qualifies a referral
  ('streak_day_points',     10),
  ('recovery_discount_pct', 10),
  ('cart_recovery_window_hours', 72)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = timezone('utc', now());

-- ============================================================================
-- 3. Points ledger (append-only truth) + cached balance
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.points_ledger (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id   UUID    NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  delta        INTEGER NOT NULL CHECK (delta <> 0),
  reason       TEXT    NOT NULL CHECK (reason IN (
                 'order_delivered', 'streak', 'referral_earned', 'referral_signed_up',
                 'birthday', 'redemption', 'admin_adjustment', 'recovery')),
  reference_id TEXT,               -- order id, referral id, streak date, ...
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- One award per (customer, reason, reference). This is what makes every award
-- path idempotent, including trigger-driven ones that can fire twice.
CREATE UNIQUE INDEX IF NOT EXISTS points_ledger_idempotency_idx
  ON public.points_ledger (profile_id, reason, reference_id)
  WHERE reference_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS points_ledger_profile_idx ON public.points_ledger (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS points_ledger_reason_idx   ON public.points_ledger (reason);

CREATE TABLE IF NOT EXISTS public.customer_points (
  profile_id       UUID    PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  balance          INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  lifetime_earned  INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_earned >= 0),
  lifetime_redeemed INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_redeemed >= 0),
  tier_code        TEXT    NOT NULL DEFAULT 'bronze'
                            CHECK (tier_code IN ('bronze', 'silver', 'gold', 'vip')),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS customer_points_tier_idx ON public.customer_points (tier_code);

-- ============================================================================
-- 4. Referrals
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.referral_codes (
  code       TEXT    PRIMARY KEY,
  profile_id UUID    NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.referrals (
  id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id   UUID    NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  referee_id    UUID    NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  referral_code TEXT    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'qualified', 'rewarded', 'rejected')),
  order_id      UUID    REFERENCES public.orders(id) ON DELETE SET NULL,
  qualified_at  TIMESTAMPTZ,
  rewarded_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  -- A customer can only ever be referred by one person.
  UNIQUE (referee_id),
  -- No self-referral, enforced in the database rather than only in the UI.
  CHECK (referrer_id <> referee_id)
);

CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON public.referrals (referrer_id, status);
CREATE INDEX IF NOT EXISTS referrals_code_idx    ON public.referrals (referral_code);

-- Birthday is stored month/day only. Storing a full birth year for a customer
-- base in Goma is a privacy liability and buys nothing that the birthday bonus
-- or the birthday message needs.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS birthday_month SMALLINT
  CHECK (birthday_month IS NULL OR birthday_month BETWEEN 1 AND 12);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS birthday_day SMALLINT
  CHECK (birthday_day IS NULL OR birthday_day BETWEEN 1 AND 31);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS birthday_reward_year SMALLINT;

COMMENT ON COLUMN public.profiles.birthday_month IS
  'Month only (1-12). Deliberately no birth year: see migration header.';

-- ============================================================================
-- 5. Flash sales
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.flash_sales (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT    NOT NULL,
  slug             TEXT    NOT NULL UNIQUE,
  tagline          TEXT,
  discount_percent NUMERIC NOT NULL CHECK (discount_percent > 0 AND discount_percent <= 90),
  starts_at        TIMESTAMPTZ NOT NULL,
  ends_at          TIMESTAMPTZ NOT NULL,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS flash_sales_window_idx ON public.flash_sales (is_active, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS public.flash_sale_products (
  flash_sale_id      UUID    NOT NULL REFERENCES public.flash_sales(id) ON DELETE CASCADE,
  product_id         UUID    NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  discount_percent   NUMERIC CHECK (discount_percent IS NULL OR (discount_percent > 0 AND discount_percent <= 90)),
  stock_limit        INTEGER CHECK (stock_limit IS NULL OR stock_limit > 0),
  sold_count         INTEGER NOT NULL DEFAULT 0 CHECK (sold_count >= 0),
  PRIMARY KEY (flash_sale_id, product_id)
);

-- ============================================================================
-- 6. Bundles
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.product_bundles (
  id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT    NOT NULL,
  slug           TEXT    NOT NULL UNIQUE,
  description    TEXT,
  image_url      TEXT,
  bundle_price   NUMERIC NOT NULL CHECK (bundle_price >= 0),
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.bundle_items (
  id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id  UUID    NOT NULL REFERENCES public.product_bundles(id) ON DELETE CASCADE,
  product_id UUID    NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity   INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  UNIQUE (bundle_id, product_id)
);

CREATE INDEX IF NOT EXISTS bundle_items_bundle_idx ON public.bundle_items (bundle_id);

-- ============================================================================
-- 7. Campaigns + personalised promotions
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.campaigns (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT    NOT NULL,
  slug             TEXT    NOT NULL UNIQUE,
  description      TEXT,
  channel          TEXT    NOT NULL DEFAULT 'in_app'
                           CHECK (channel IN ('in_app', 'whatsapp', 'push', 'email')),
  segment          TEXT    NOT NULL DEFAULT 'all'
                           CHECK (segment IN ('all', 'vip', 'gold', 'new', 'inactive', 'birthday')),
  discount_percent NUMERIC CHECK (discount_percent IS NULL OR (discount_percent > 0 AND discount_percent <= 90)),
  min_order        NUMERIC NOT NULL DEFAULT 0 CHECK (min_order >= 0),
  coupon_code      TEXT    REFERENCES public.coupons(code) ON DELETE SET NULL,
  starts_at        TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  ends_at          TIMESTAMPTZ NOT NULL,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS campaigns_window_idx ON public.campaigns (is_active, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS public.personalized_promotions (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id      UUID    REFERENCES public.campaigns(id) ON DELETE CASCADE,
  profile_id       UUID    REFERENCES public.profiles(id) ON DELETE CASCADE,
  segment          TEXT    NOT NULL DEFAULT 'all'
                           CHECK (segment IN ('all', 'vip', 'gold', 'new', 'inactive', 'birthday')),
  title            TEXT    NOT NULL,
  message          TEXT,
  discount_percent NUMERIC CHECK (discount_percent IS NULL OR (discount_percent > 0 AND discount_percent <= 90)),
  coupon_code      TEXT    REFERENCES public.coupons(code) ON DELETE SET NULL,
  starts_at        TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  ends_at          TIMESTAMPTZ NOT NULL,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  dismissed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS personalized_promotions_profile_idx
  ON public.personalized_promotions (profile_id, ends_at DESC);
CREATE INDEX IF NOT EXISTS personalized_promotions_segment_idx
  ON public.personalized_promotions (segment, ends_at DESC);

-- ============================================================================
-- 8. Abandoned-cart recovery
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.abandoned_carts (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id   UUID    NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  items        JSONB   NOT NULL,
  subtotal     NUMERIC NOT NULL CHECK (subtotal >= 0),
  coupon_code  TEXT,
  status       TEXT    NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open', 'recovered', 'expired')),
  recovery_code TEXT   NOT NULL UNIQUE,
  reminders_sent INTEGER NOT NULL DEFAULT 0 CHECK (reminders_sent >= 0),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  recovered_at  TIMESTAMPTZ
);

-- One *open* cart per customer, enforced by a partial unique index because the
-- constraint is conditional (recovered/expired rows must not block a new one).
CREATE UNIQUE INDEX IF NOT EXISTS abandoned_carts_one_open_per_customer_idx
  ON public.abandoned_carts (profile_id) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS abandoned_carts_recovery_idx ON public.abandoned_carts (recovery_code);

-- ============================================================================
-- 9. Row level security
-- ============================================================================
ALTER TABLE public.loyalty_tiers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_settings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.points_ledger       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_points     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_codes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flash_sales         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flash_sale_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_bundles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bundle_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personalized_promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.abandoned_carts     ENABLE ROW LEVEL SECURITY;

-- Tiers are public marketing copy.
DROP POLICY IF EXISTS "Anyone can read active loyalty tiers" ON public.loyalty_tiers;
CREATE POLICY "Anyone can read active loyalty tiers"
  ON public.loyalty_tiers FOR SELECT USING (is_active = true);

-- Settings are internal configuration; admins only.
DROP POLICY IF EXISTS "Admins manage loyalty settings" ON public.loyalty_settings;
CREATE POLICY "Admins manage loyalty settings"
  ON public.loyalty_settings FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- A customer reads their own ledger; nobody edits it directly (RPC only).
DROP POLICY IF EXISTS "Customers read their own points ledger" ON public.points_ledger;
CREATE POLICY "Customers read their own points ledger"
  ON public.points_ledger FOR SELECT USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "Customers read their own points balance" ON public.customer_points;
CREATE POLICY "Customers read their own points balance"
  ON public.customer_points FOR SELECT USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "Customers read their own referral code" ON public.referral_codes;
CREATE POLICY "Customers read their own referral code"
  ON public.referral_codes FOR SELECT USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "Customers read referrals involving them" ON public.referrals;
CREATE POLICY "Customers read referrals involving them"
  ON public.referrals FOR SELECT
  USING (referrer_id = auth.uid() OR referee_id = auth.uid());

-- Flash sales and bundles are catalogue data, readable by anyone.
DROP POLICY IF EXISTS "Anyone can read active flash sales" ON public.flash_sales;
CREATE POLICY "Anyone can read active flash sales"
  ON public.flash_sales FOR SELECT USING (is_active = true);

DROP POLICY IF EXISTS "Anyone can read flash sale products" ON public.flash_sale_products;
CREATE POLICY "Anyone can read flash sale products"
  ON public.flash_sale_products FOR SELECT USING (true);

DROP POLICY IF EXISTS "Anyone can read active bundles" ON public.product_bundles;
CREATE POLICY "Anyone can read active bundles"
  ON public.product_bundles FOR SELECT USING (is_active = true);

DROP POLICY IF EXISTS "Anyone can read bundle items" ON public.bundle_items;
CREATE POLICY "Anyone can read bundle items"
  ON public.bundle_items FOR SELECT USING (true);

DROP POLICY IF EXISTS "Anyone can read active campaigns" ON public.campaigns;
CREATE POLICY "Anyone can read active campaigns"
  ON public.campaigns FOR SELECT USING (is_active = true);

-- A promotion is visible if it is targeted at this customer, or at a segment
-- the customer currently belongs to.
DROP POLICY IF EXISTS "Customers read promotions for their segment" ON public.personalized_promotions;
CREATE POLICY "Customers read promotions for their segment"
  ON public.personalized_promotions FOR SELECT
  USING (
    is_active = true
    AND (profile_id IS NULL OR profile_id = auth.uid())
  );

DROP POLICY IF EXISTS "Customers manage their own abandoned carts" ON public.abandoned_carts;
CREATE POLICY "Customers manage their own abandoned carts"
  ON public.abandoned_carts FOR ALL
  USING (profile_id = auth.uid()) WITH CHECK (profile_id = auth.uid());

-- Admins moderate the growth surfaces.
DROP POLICY IF EXISTS "Admins manage flash sales" ON public.flash_sales;
CREATE POLICY "Admins manage flash sales"
  ON public.flash_sales FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins manage flash sale products" ON public.flash_sale_products;
CREATE POLICY "Admins manage flash sale products"
  ON public.flash_sale_products FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins manage bundles" ON public.product_bundles;
CREATE POLICY "Admins manage bundles"
  ON public.product_bundles FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins manage bundle items" ON public.bundle_items;
CREATE POLICY "Admins manage bundle items"
  ON public.bundle_items FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins manage campaigns" ON public.campaigns;
CREATE POLICY "Admins manage campaigns"
  ON public.campaigns FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins manage personalized promotions" ON public.personalized_promotions;
CREATE POLICY "Admins manage personalized promotions"
  ON public.personalized_promotions FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ============================================================================
-- 10. Helpers
-- ============================================================================

-- Resolve a numeric setting with a fallback, so a missing key can never make
-- an award path throw.
CREATE OR REPLACE FUNCTION public.loyalty_setting(p_key TEXT, p_fallback NUMERIC)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT value FROM public.loyalty_settings WHERE key = p_key),
    p_fallback
  );
$$;

-- The tier a given lifetime-earned total maps to. Highest satisfied min_points
-- wins, so tiers can be re-ordered without touching the awarding logic.
CREATE OR REPLACE FUNCTION public.tier_for_points(p_lifetime INTEGER)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT code FROM public.loyalty_tiers
      WHERE is_active = true AND min_points <= p_lifetime
      ORDER BY min_points DESC LIMIT 1),
    'bronze'
  );
$$;

-- The single write path for points. Everything else calls this.
-- Idempotent on (profile_id, reason, reference_id).
CREATE OR REPLACE FUNCTION public.award_points(
  p_profile_id   UUID,
  p_delta        INTEGER,
  p_reason       TEXT,
  p_reference_id TEXT DEFAULT NULL,
  p_description  TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance INTEGER;
BEGIN
  IF p_profile_id IS NULL THEN
    RETURN 0;
  END IF;
  IF p_delta = 0 THEN
    RETURN 0;
  END IF;

  -- ON CONFLICT DO NOTHING makes a repeated award a no-op instead of an error,
  -- so callers never need to pre-check whether they have already paid out.
  INSERT INTO public.points_ledger (profile_id, delta, reason, reference_id, description)
  VALUES (p_profile_id, p_delta, p_reason, p_reference_id, p_description)
  ON CONFLICT DO NOTHING;

  IF NOT FOUND THEN
    -- Already awarded; return the current balance unchanged.
    SELECT balance INTO v_balance FROM public.customer_points WHERE profile_id = p_profile_id;
    RETURN COALESCE(v_balance, 0);
  END IF;

  -- Recompute from the ledger rather than doing `balance = balance + delta`.
  -- This is self-healing: it cannot drift, and it repairs itself if it ever did.
  PERFORM public.rebuild_points_balance(p_profile_id);
  SELECT balance INTO v_balance FROM public.customer_points WHERE profile_id = p_profile_id;
  RETURN COALESCE(v_balance, 0);
END;
$$;

-- Rebuild the cached balance/tier for one customer from the append-only ledger.
CREATE OR REPLACE FUNCTION public.rebuild_points_balance(p_profile_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_earned   INTEGER;
  v_redeemed INTEGER;
BEGIN
  SELECT
    COALESCE(SUM(delta) FILTER (WHERE delta > 0), 0),
    COALESCE(-SUM(delta) FILTER (WHERE delta < 0), 0)
  INTO v_earned, v_redeemed
  FROM public.points_ledger
  WHERE profile_id = p_profile_id;

  INSERT INTO public.customer_points (profile_id, balance, lifetime_earned, lifetime_redeemed, tier_code, updated_at)
  VALUES (
    p_profile_id,
    GREATEST(v_earned - v_redeemed, 0),
    v_earned,
    v_redeemed,
    public.tier_for_points(v_earned),
    timezone('utc', now())
  )
  ON CONFLICT (profile_id) DO UPDATE SET
    balance           = GREATEST(v_earned - v_redeemed, 0),
    lifetime_earned   = v_earned,
    lifetime_redeemed = v_redeemed,
    tier_code         = public.tier_for_points(v_earned),
    updated_at        = timezone('utc', now());
END;
$$;

-- Give every profile a referral code on signup. Idempotent.
CREATE OR REPLACE FUNCTION public.ensure_referral_code(p_profile_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code TEXT;
BEGIN
  SELECT code INTO v_code FROM public.referral_codes WHERE profile_id = p_profile_id;
  IF v_code IS NOT NULL THEN
    RETURN v_code;
  END IF;

  -- Ambiguity-free code: the profile UUID already carries 32 hex characters.
  v_code := 'DLX' || UPPER(SUBSTRING(REPLACE(p_profile_id::TEXT, '-', '') FROM 1 FOR 9));
  INSERT INTO public.referral_codes (code, profile_id)
  VALUES (v_code, p_profile_id)
  ON CONFLICT (profile_id) DO UPDATE SET profile_id = EXCLUDED.profile_id;
  RETURN v_code;
END;
$$;

-- ============================================================================
-- 11. Triggers
-- ============================================================================

-- New profile -> zeroed balance, referral code.
CREATE OR REPLACE FUNCTION public.handle_new_profile_loyalty()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.customer_points (profile_id, balance, lifetime_earned, lifetime_redeemed, tier_code)
  VALUES (NEW.id, 0, 0, 0, 'bronze')
  ON CONFLICT (profile_id) DO NOTHING;

  PERFORM public.ensure_referral_code(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_created_loyalty ON public.profiles;
CREATE TRIGGER on_profile_created_loyalty
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_profile_loyalty();

-- Order delivered -> points, scaled by the customer's tier multiplier.
CREATE OR REPLACE FUNCTION public.handle_order_delivered_points()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate      NUMERIC;
  v_multiplier NUMERIC;
  v_base      INTEGER;
  v_awarded   INTEGER;
BEGIN
  IF NEW.status IS DISTINCT FROM 'delivered' THEN
    RETURN NEW;
  END IF;
  -- OLD does not exist on INSERT, so guard the transition case separately.
  IF TG_OP = 'UPDATE' AND OLD.status = 'delivered' THEN
    RETURN NEW;
  END IF;
  IF NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_rate := public.loyalty_setting('points_per_usd', 0.2);
  IF v_rate <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(lt.points_multiplier, 1)
    INTO v_multiplier
    FROM public.customer_points cp
    JOIN public.loyalty_tiers lt ON lt.code = cp.tier_code
   WHERE cp.profile_id = NEW.customer_id;

  v_base := FLOOR(COALESCE(NEW.total_amount, 0) * v_rate * COALESCE(v_multiplier, 1))::INTEGER;
  IF v_base <= 0 THEN
    RETURN NEW;
  END IF;

  v_awarded := public.award_points(
    NEW.customer_id, v_base, 'order_delivered', NEW.id::TEXT,
    'Points for order ' || LEFT(NEW.id::TEXT, 8)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_order_delivered_award_points ON public.orders;
CREATE TRIGGER on_order_delivered_award_points
  AFTER INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.handle_order_delivered_points();

-- Referral qualifies when the referee places a delivered order above the
-- configured minimum, and pays both sides exactly once (reference_id = order).
CREATE OR REPLACE FUNCTION public.evaluate_referral_on_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_min   NUMERIC;
  v_ref   public.referrals%ROWTYPE;
  v_ref_pts INTEGER;
  v_new_pts INTEGER;
BEGIN
  IF NEW.status IS DISTINCT FROM 'delivered' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'delivered' THEN
    RETURN NEW;
  END IF;
  IF NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_min := public.loyalty_setting('referral_min_order', 25);
  IF COALESCE(NEW.total_amount, 0) < v_min THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_ref
    FROM public.referrals
   WHERE referee_id = NEW.customer_id AND status IN ('pending', 'qualified')
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  UPDATE public.referrals
     SET status = 'qualified', qualified_at = timezone('utc', now()), order_id = NEW.id
   WHERE id = v_ref.id;

  v_ref_pts := public.loyalty_setting('referral_referrer_pts', 500)::INTEGER;
  v_new_pts := public.loyalty_setting('referral_referee_pts', 250)::INTEGER;

  PERFORM public.award_points(v_ref.referrer_id, v_ref_pts, 'referral_earned', v_ref.id::TEXT,
    'Referral qualified: ' || v_ref.referee_id::TEXT);
  PERFORM public.award_points(v_ref.referee_id, v_new_pts, 'referral_signed_up', v_ref.id::TEXT,
    'Referral bonus');

  UPDATE public.referrals SET status = 'rewarded', rewarded_at = timezone('utc', now())
   WHERE id = v_ref.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_order_evaluate_referral ON public.orders;
CREATE TRIGGER on_order_evaluate_referral
  AFTER INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.evaluate_referral_on_order();

-- ============================================================================
-- 12. RPCs
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_loyalty_summary()
RETURNS TABLE (
  tier_code           TEXT,
  tier_label          TEXT,
  balance             INTEGER,
  lifetime_earned     INTEGER,
  lifetime_redeemed   INTEGER,
  points_to_next_tier INTEGER,
  next_tier_label     TEXT,
  discount_percent    NUMERIC,
  free_shipping       BOOLEAN,
  early_access        BOOLEAN,
  points_multiplier   NUMERIC,
  referral_code       TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (SELECT auth.uid() AS uid),
  pts AS (
    SELECT cp.* FROM public.customer_points cp, me
    WHERE cp.profile_id = me.uid
  ),
  cur AS (
    SELECT lt.* FROM public.loyalty_tiers lt
    JOIN pts ON pts.tier_code = lt.code
  ),
  nxt AS (
    SELECT lt.* FROM public.loyalty_tiers lt, pts
    WHERE lt.is_active = true AND lt.min_points > pts.lifetime_earned
    ORDER BY lt.min_points ASC LIMIT 1
  )
  SELECT
    COALESCE(cur.code, 'bronze'),
    COALESCE(cur.label, 'Bronze'),
    COALESCE(pts.balance, 0),
    COALESCE(pts.lifetime_earned, 0),
    COALESCE(pts.lifetime_redeemed, 0),
    CASE WHEN nxt.min_points IS NULL THEN 0
         ELSE GREATEST(nxt.min_points - COALESCE(pts.lifetime_earned, 0), 0) END,
    COALESCE(nxt.label, ''),
    COALESCE(cur.discount_percent, 0),
    COALESCE(cur.free_shipping, false),
    COALESCE(cur.early_access, false),
    COALESCE(cur.points_multiplier, 1),
    (SELECT rc.code FROM public.referral_codes rc WHERE rc.profile_id = (SELECT uid FROM me))
  FROM (SELECT 1) one
  LEFT JOIN pts ON true
  LEFT JOIN cur ON true
  LEFT JOIN nxt ON true;
$$;

CREATE OR REPLACE FUNCTION public.get_points_history(p_limit INTEGER DEFAULT 25)
RETURNS TABLE (
  id          UUID,
  delta       INTEGER,
  reason      TEXT,
  description TEXT,
  created_at  TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id, l.delta, l.reason, l.description, l.created_at
    FROM public.points_ledger l
   WHERE l.profile_id = auth.uid()
   ORDER BY l.created_at DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
$$;

CREATE OR REPLACE FUNCTION public.get_referral_code()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.ensure_referral_code(auth.uid());
$$;

-- Apply someone else's code to my own account. Self-referral and re-referral
-- are rejected in the database, not just in the client.
CREATE OR REPLACE FUNCTION public.apply_referral_code(p_code TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me      UUID := auth.uid();
  v_owner   UUID;
BEGIN
  IF v_me IS NULL THEN
    RETURN 'You must be signed in to use a referral code.';
  END IF;

  SELECT profile_id INTO v_owner FROM public.referral_codes WHERE UPPER(code) = UPPER(TRIM(p_code));
  IF v_owner IS NULL THEN
    RETURN 'That referral code does not exist.';
  END IF;
  IF v_owner = v_me THEN
    RETURN 'You cannot use your own referral code.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.referrals WHERE referee_id = v_me) THEN
    RETURN 'You already used a referral code.';
  END IF;

  INSERT INTO public.referrals (referrer_id, referee_id, referral_code)
  VALUES (v_owner, v_me, TRIM(p_code))
  ON CONFLICT (referee_id) DO NOTHING;

  -- Immediate small bonus for signing up; the larger referrer bonus waits
  -- until the referee's first delivered order (see evaluate_referral_on_order).
  PERFORM public.award_points(
    v_me, public.loyalty_setting('referral_signed_up_pts', 100)::INTEGER,
    'referral_signed_up', NULL, 'Welcome referral bonus'
  );

  RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION public.get_referrals()
RETURNS TABLE (
  total      INTEGER,
  qualified  INTEGER,
  rewarded   INTEGER,
  code       TEXT,
  invites    JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me UUID := auth.uid();
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COUNT(*)::INTEGER FROM public.referrals WHERE referrer_id = v_me),
    (SELECT COUNT(*)::INTEGER FROM public.referrals WHERE referrer_id = v_me AND status = 'qualified'),
    (SELECT COUNT(*)::INTEGER FROM public.referrals WHERE referrer_id = v_me AND status = 'rewarded'),
    COALESCE((SELECT rc.code FROM public.referral_codes rc WHERE rc.profile_id = v_me), ''),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'referee_id',   r.referee_id,
        'full_name',    p.full_name,
        'status',       r.status,
        'qualified_at', r.qualified_at,
        'rewarded_at',  r.rewarded_at
      ) ORDER BY r.created_at DESC)
      FROM public.referrals r
      LEFT JOIN public.profiles p ON p.id = r.referee_id
      WHERE r.referrer_id = v_me
    ), '[]'::jsonb);
END;
$$;

-- Active flash sales with their products and effective prices.
CREATE OR REPLACE FUNCTION public.get_active_flash_sales()
RETURNS TABLE (
  flash_sale_id    UUID,
  name             TEXT,
  slug             TEXT,
  tagline          TEXT,
  discount_percent NUMERIC,
  ends_at          TIMESTAMPTZ,
  product_id       UUID,
  product_name     TEXT,
  product_slug     TEXT,
  image_url        TEXT,
  original_price   NUMERIC,
  sale_price       NUMERIC,
  stock_quantity   INTEGER,
  sold_count       INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    fs.id, fs.name, fs.slug, fs.tagline, fs.discount_percent, fs.ends_at,
    p.id, p.name, p.slug,
    (SELECT pi.image_url FROM public.product_images pi
      WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC, pi.created_at ASC LIMIT 1),
    COALESCE(p.discount_price, p.price),
    ROUND(COALESCE(p.discount_price, p.price) * (1 - COALESCE(fsp.discount_percent, fs.discount_percent) / 100), 2),
    p.stock_quantity,
    fsp.sold_count
  FROM public.flash_sales fs
  JOIN public.flash_sale_products fsp ON fsp.flash_sale_id = fs.id
  JOIN public.products p ON p.id = fsp.product_id
  WHERE fs.is_active = true
    AND fs.starts_at <= timezone('utc', now())
    AND fs.ends_at   >  timezone('utc', now())
    AND p.is_active = true
    AND p.is_archived = false
    AND p.stock_quantity > 0
  ORDER BY fs.ends_at ASC, fs.discount_percent DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_active_bundles()
RETURNS TABLE (
  bundle_id      UUID,
  name           TEXT,
  slug           TEXT,
  description    TEXT,
  image_url      TEXT,
  bundle_price   NUMERIC,
  items_total    NUMERIC,
  savings        NUMERIC,
  savings_percent NUMERIC,
  item_count     INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    b.id, b.name, b.slug, b.description, b.image_url, b.bundle_price,
    COALESCE(SUM(COALESCE(p.discount_price, p.price) * bi.quantity), 0),
    GREATEST(COALESCE(SUM(COALESCE(p.discount_price, p.price) * bi.quantity), 0) - b.bundle_price, 0),
    CASE
      WHEN COALESCE(SUM(COALESCE(p.discount_price, p.price) * bi.quantity), 0) > 0
      THEN ROUND(
        GREATEST(SUM(COALESCE(p.discount_price, p.price) * bi.quantity) - b.bundle_price, 0)
        / SUM(COALESCE(p.discount_price, p.price) * bi.quantity) * 100, 1)
      ELSE 0
    END,
    COALESCE(SUM(bi.quantity), 0)::INTEGER
  FROM public.product_bundles b
  JOIN public.bundle_items bi ON bi.bundle_id = b.id
  JOIN public.products p ON p.id = bi.product_id AND p.is_active = true AND p.is_archived = false
  WHERE b.is_active = true
  GROUP BY b.id
  -- Cannot order by the `savings_percent` output alias: in a RETURNS TABLE
  -- function the output column names are parameters, not columns, so the
  -- alias is not in scope for ORDER BY. Repeat the expression instead.
  ORDER BY (
    CASE
      WHEN COALESCE(SUM(COALESCE(p.discount_price, p.price) * bi.quantity), 0) > 0
      THEN GREATEST(SUM(COALESCE(p.discount_price, p.price) * bi.quantity) - b.bundle_price, 0)
           / SUM(COALESCE(p.discount_price, p.price) * bi.quantity)
      ELSE 0
    END
  ) DESC;
$$;

-- Promotions targeted at me: my tier segment plus 'all', minus anything I
-- already dismissed.
CREATE OR REPLACE FUNCTION public.get_personalized_promotions()
RETURNS TABLE (
  id               UUID,
  title            TEXT,
  message          TEXT,
  segment          TEXT,
  discount_percent NUMERIC,
  coupon_code      TEXT,
  ends_at          TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT
      auth.uid() AS uid,
      COALESCE((SELECT tier_code FROM public.customer_points WHERE profile_id = auth.uid()), 'bronze') AS tier
  )
  SELECT pp.id, pp.title, pp.message, pp.segment, pp.discount_percent, pp.coupon_code, pp.ends_at
    FROM public.personalized_promotions pp, me
   WHERE pp.is_active = true
     AND pp.starts_at <= timezone('utc', now())
     AND pp.ends_at   >  timezone('utc', now())
     AND pp.dismissed_at IS NULL
     AND (pp.profile_id IS NULL OR pp.profile_id = me.uid)
     AND pp.segment IN ('all', me.tier)
     -- Gold members see gold-targeted campaigns; VIP members see both.
     AND (pp.segment <> 'gold' OR me.tier IN ('gold', 'vip'))
   ORDER BY pp.ends_at ASC
   LIMIT 20;
$$;

CREATE OR REPLACE FUNCTION public.dismiss_promotion(p_promotion_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me UUID := auth.uid();
BEGIN
  IF v_me IS NULL THEN
    RETURN false;
  END IF;
  -- Scoped to my own rows: a customer cannot dismiss someone else's promotion.
  UPDATE public.personalized_promotions
     SET dismissed_at = timezone('utc', now())
   WHERE id = p_promotion_id
     AND (profile_id IS NULL OR profile_id = v_me);
  RETURN FOUND;
END;
$$;

-- Record an in-progress cart. Keeps one open row per customer and resets the
-- recovery window on each new visit, so reminders track real intent.
CREATE OR REPLACE FUNCTION public.track_abandoned_cart(
  p_items       JSONB,
  p_subtotal    NUMERIC,
  p_coupon_code TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me    UUID := auth.uid();
  v_id    UUID;
  v_hours INTEGER;
BEGIN
  IF v_me IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN NULL;
  END IF;
  IF COALESCE(p_subtotal, 0) <= 0 THEN
    RETURN NULL;
  END IF;

  v_hours := public.loyalty_setting('cart_recovery_window_hours', 72)::INTEGER;

  INSERT INTO public.abandoned_carts (profile_id, items, subtotal, coupon_code, recovery_code, last_seen_at)
  VALUES (v_me, p_items, p_subtotal, p_coupon_code,
          'REC' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 12)),
          timezone('utc', now()))
  ON CONFLICT (profile_id) WHERE status = 'open'
  DO UPDATE SET
    items       = EXCLUDED.items,
    subtotal    = EXCLUDED.subtotal,
    coupon_code = EXCLUDED.coupon_code,
    last_seen_at = timezone('utc', now())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- What's recoverable for me right now.
CREATE OR REPLACE FUNCTION public.get_cart_recovery_offer()
RETURNS TABLE (
  cart_id          UUID,
  items            JSONB,
  subtotal         NUMERIC,
  coupon_code      TEXT,
  discount_percent NUMERIC,
  recovery_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me    UUID := auth.uid();
  v_hours INTEGER;
BEGIN
  IF v_me IS NULL THEN
    RETURN;
  END IF;
  v_hours := public.loyalty_setting('cart_recovery_window_hours', 72)::INTEGER;

  RETURN QUERY
  SELECT ac.id, ac.items, ac.subtotal, ac.coupon_code,
         public.loyalty_setting('recovery_discount_pct', 10),
         ac.last_seen_at + make_interval(hours => v_hours)
    FROM public.abandoned_carts ac
   WHERE ac.profile_id = v_me
     AND ac.status = 'open'
     AND ac.last_seen_at + make_interval(hours => v_hours) > timezone('utc', now())
   LIMIT 1;
END;
$$;

-- Called when an order is placed: the cart is no longer abandoned.
CREATE OR REPLACE FUNCTION public.mark_cart_recovered()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.abandoned_carts
     SET status = 'recovered', recovered_at = timezone('utc', now())
   WHERE profile_id = auth.uid() AND status = 'open';
  RETURN FOUND;
END;
$$;

-- Admin: grant a manual points adjustment (support, goodwill, corrections).
CREATE OR REPLACE FUNCTION public.admin_adjust_points(
  p_profile_id  UUID,
  p_delta       INTEGER,
  p_description TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  -- NULL reference keeps this outside the idempotency index on purpose: an
  -- admin may legitimately need to grant the same adjustment twice.
  RETURN public.award_points(
    p_profile_id, p_delta, 'admin_adjustment', NULL,
    COALESCE(p_description, 'Manual adjustment by admin')
  );
END;
$$;

-- Admin: the leaderboard. Loyalty data is customer-visible in aggregate.
CREATE OR REPLACE FUNCTION public.admin_loyalty_overview()
RETURNS TABLE (
  profile_id     UUID,
  full_name      TEXT,
  tier_code      TEXT,
  balance        INTEGER,
  lifetime_earned INTEGER,
  referral_count INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    cp.profile_id, p.full_name, cp.tier_code, cp.balance, cp.lifetime_earned,
    (SELECT COUNT(*)::INTEGER FROM public.referrals r WHERE r.referrer_id = cp.profile_id)
  FROM public.customer_points cp
  JOIN public.profiles p ON p.id = cp.profile_id
  WHERE public.is_admin()
  ORDER BY cp.lifetime_earned DESC
  LIMIT 100;
$$;

-- ============================================================================
-- 13. Grants
-- ============================================================================
-- Readers go to anon + authenticated where the data is genuinely public
-- (tiers, flash sales, bundles), and to authenticated only where it is
-- per-customer. Internal writers go to neither PUBLIC nor anon.
REVOKE ALL ON FUNCTION public.award_points(UUID, INTEGER, TEXT, TEXT, TEXT)                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rebuild_points_balance(UUID)                                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ensure_referral_code(UUID)                                     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.handle_new_profile_loyalty()                                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.handle_order_delivered_points()                                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.evaluate_referral_on_order()                                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.loyalty_setting(TEXT, NUMERIC)                                  FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.get_loyalty_summary()            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_points_history(INTEGER)      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_referral_code()              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.apply_referral_code(TEXT)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_referrals()                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_personalized_promotions()    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dismiss_promotion(UUID)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.track_abandoned_cart(JSONB, NUMERIC, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_cart_recovery_offer()        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_cart_recovered()            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_adjust_points(UUID, INTEGER, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_loyalty_overview()         FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.get_active_flash_sales()         FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_active_bundles()             FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tier_for_points(INTEGER)        FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_loyalty_summary()            TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_points_history(INTEGER)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_referral_code()              TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_referral_code(TEXT)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_referrals()                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_personalized_promotions()    TO authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_promotion(UUID)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.track_abandoned_cart(JSONB, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cart_recovery_offer()        TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_cart_recovered()            TO authenticated;

-- Catalogue-adjacent reads stay public so the storefront can render them
-- before sign-in, mirroring the deliberate `anon` grant on trending products.
GRANT EXECUTE ON FUNCTION public.get_active_flash_sales()         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_bundles()             TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_adjust_points(UUID, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_loyalty_overview()          TO authenticated;

-- `award_points` is deliberately NOT granted to authenticated. Points are
-- minted only by the order/referral triggers or by an admin adjustment.
-- The internal helpers are likewise not granted: they are reached through the
-- SECURITY DEFINER entry points above, which run as the owner.

-- ============================================================================
-- 14. Table grants (explicit, not inherited from Supabase's default ACL)
-- ============================================================================
REVOKE ALL ON public.loyalty_tiers            FROM PUBLIC;
REVOKE ALL ON public.loyalty_settings         FROM PUBLIC;
REVOKE ALL ON public.points_ledger            FROM PUBLIC;
REVOKE ALL ON public.customer_points          FROM PUBLIC;
REVOKE ALL ON public.referral_codes           FROM PUBLIC;
REVOKE ALL ON public.referrals                FROM PUBLIC;
REVOKE ALL ON public.flash_sales              FROM PUBLIC;
REVOKE ALL ON public.flash_sale_products      FROM PUBLIC;
REVOKE ALL ON public.product_bundles          FROM PUBLIC;
REVOKE ALL ON public.bundle_items             FROM PUBLIC;
REVOKE ALL ON public.campaigns                FROM PUBLIC;
REVOKE ALL ON public.personalized_promotions  FROM PUBLIC;
REVOKE ALL ON public.abandoned_carts          FROM PUBLIC;

-- Catalogue-adjacent marketing data: readable before sign-in.
GRANT SELECT ON public.loyalty_tiers       TO anon, authenticated;
GRANT SELECT ON public.flash_sales         TO anon, authenticated;
GRANT SELECT ON public.flash_sale_products TO anon, authenticated;
GRANT SELECT ON public.product_bundles     TO anon, authenticated;
GRANT SELECT ON public.bundle_items        TO anon, authenticated;
GRANT SELECT ON public.campaigns           TO anon, authenticated;

-- Per-customer data: signed-in only. RLS narrows each table further.
GRANT SELECT                ON public.points_ledger           TO authenticated;
GRANT SELECT                ON public.customer_points         TO authenticated;
GRANT SELECT                ON public.referral_codes          TO authenticated;
GRANT SELECT                ON public.referrals               TO authenticated;
GRANT SELECT                ON public.personalized_promotions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.abandoned_carts        TO authenticated;

-- Admin-managed config. RLS restricts these rows to admins.
GRANT SELECT, INSERT, UPDATE ON public.loyalty_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flash_sales, public.flash_sale_products,
  public.product_bundles, public.bundle_items, public.campaigns, public.personalized_promotions TO authenticated;

-- sequence access for admin inserts
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
