-- DLXSTORE — daily streaks: counter, milestones, badges, in-app reminder
--
-- ROADMAP Phase 9 — "DLX Streaks". Implements the agreed design:
--   * Any authenticated activity on a calendar day advances the streak, once
--     per day. There is no explicit "check in" button to forget.
--   * A missed day ends the current streak: the counter resets and the streak
--     restarts. `longest_count` and earned milestones are permanent, which is
--     the "recovery" story — you start again, you never lose history.
--   * Reminders are IN-APP ONLY. This project has no scheduler (no pg_cron, no
--     cron jobs in any migration), so nothing here fires on a timer. The
--     "your streak expires tonight" prompt is computed on read instead.
--
-- WHY THIS IS NOT THE REWARDS SYSTEM
-- -----------------------------------
-- `reward_milestones.milestone_type` is constrained to
-- ('purchase_count','share_count') and `customer_rewards` requires a `coupon_id`,
-- so a streak is a coupon. Reusing that machinery would need a CHECK constraint
-- change and would couple engagement to discounts. Streaks get their own two
-- small tables instead. `streak_milestones` is the badge ledger *and* the
-- notification idempotency record, in the same spirit as the
-- UNIQUE (profile_id, milestone_id) guard on `customer_rewards`.
--
-- TIMEZONE
-- --------
-- A "day" is Africa/Kinshasa, matching `src/lib/store-config.ts` (`launch.timezone`).
-- Using UTC would roll the day over at 22:00 local time for a DRC customer.
--
-- PRE-APPLICATION REQUIREMENTS
-- ----------------------------
-- 1. Review the remote migration history and obtain explicit approval.
-- 2. Additive and idempotent: no data is rewritten, moved or deleted.
-- 3. Self-contained apart from `public.profiles` and `public.notifications`.
-- 4. Grants are explicit. Supabase's platform defaults make every new
--    `public` function executable by `anon`, `authenticated` and `service_role`,
--    so `REVOKE ... FROM PUBLIC` is not enough on its own. Only
--    `record_streak_activity` and `get_my_streak` are reachable by a customer.

-- ============================================================================
-- 1. Streak state
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.streaks (
  profile_id         UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  current_count      INTEGER NOT NULL DEFAULT 0 CHECK (current_count >= 0),
  longest_count      INTEGER NOT NULL DEFAULT 0 CHECK (longest_count >= 0),
  -- Lifetime count of distinct active days. "New Streak" is derived from this
  -- being > 0, so it needs no row of its own.
  total_active_days  INTEGER NOT NULL DEFAULT 0 CHECK (total_active_days >= 0),
  -- The calendar day of the most recent activity, in Africa/Kinshasa.
  last_activity_date DATE,
  started_on         DATE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.streaks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Customers read their own streak" ON public.streaks;
CREATE POLICY "Customers read their own streak"
  ON public.streaks FOR SELECT
  USING (profile_id = auth.uid() OR public.is_admin());

-- No client INSERT/UPDATE policy: the day-boundary arithmetic in
-- record_streak_activity() must stay authoritative.

-- ============================================================================
-- 2. Milestone ledger
-- ============================================================================
-- One row per (profile, threshold). Written only by record_streak_activity().
CREATE TABLE IF NOT EXISTS public.streak_milestones (
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  threshold  INTEGER NOT NULL CHECK (threshold > 0),
  earned_at  TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (profile_id, threshold)
);

ALTER TABLE public.streak_milestones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Customers read their own streak milestones" ON public.streak_milestones;
CREATE POLICY "Customers read their own streak milestones"
  ON public.streak_milestones FOR SELECT
  USING (profile_id = auth.uid() OR public.is_admin());

-- ============================================================================
-- 3. Shared state projection
-- ============================================================================
-- Both RPCs return the same shape so the client has one mapper, not two.
CREATE OR REPLACE FUNCTION public.build_streak_state(
  p_profile_id UUID,
  p_advanced_today BOOLEAN DEFAULT FALSE,
  p_awarded INTEGER[] DEFAULT ARRAY[]::INTEGER[]
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row    public.streaks;
  v_today  DATE := (now() AT TIME ZONE 'Africa/Kinshasa')::DATE;
  v_badges JSONB;
  v_next   JSONB;
  -- The stored counter records what the last activity produced. With no
  -- scheduler to expire it, a read must not present a stale counter as live, so
  -- the projected value is 0 once the last activity is older than yesterday.
  v_broken     BOOLEAN;
  v_effective  INTEGER;
BEGIN
  SELECT * INTO v_row FROM public.streaks WHERE profile_id = p_profile_id;

  IF v_row.profile_id IS NULL THEN
    RETURN jsonb_build_object(
      'current_count', 0,
      'longest_count', 0,
      'total_active_days', 0,
      'last_activity_date', NULL,
      'streak_broken', false,
      'activity_recorded_today', false,
      'expires_today', false,
      'advanced_today', p_advanced_today,
      'milestones_awarded', to_jsonb(p_awarded),
      'next_milestone', NULL,
      'badges', '[]'::JSONB
    );
  END IF;

  v_broken := v_row.current_count > 0
    AND v_row.last_activity_date IS NOT NULL
    AND v_row.last_activity_date < (v_today - 1);

  v_effective := CASE WHEN v_broken THEN 0 ELSE v_row.current_count END;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('threshold', m.threshold, 'earned_at', m.earned_at) ORDER BY m.threshold), '[]'::JSONB)
  INTO v_badges
  FROM public.streak_milestones m
  WHERE m.profile_id = p_profile_id;

  -- A flat list of earned thresholds. "New Streak" is implied by
  -- total_active_days > 0, so it needs no ledger row; the client maps labels.
  -- Nearest milestone that has not been earned yet.
  SELECT jsonb_build_object('threshold', t.threshold, 'days_remaining', GREATEST(t.threshold - v_effective, 1))
  INTO v_next
  FROM unnest(ARRAY[3, 7, 30, 100, 365]) AS t(threshold)
  WHERE v_effective < t.threshold
  ORDER BY t.threshold
  LIMIT 1;

  RETURN jsonb_build_object(
    -- Projected, not raw: 0 when the streak has already lapsed.
    'current_count', v_effective,
    'streak_broken', v_broken,
    'longest_count', v_row.longest_count,
    'total_active_days', v_row.total_active_days,
    'last_activity_date', v_row.last_activity_date,
    'activity_recorded_today', v_row.last_activity_date = v_today,
    -- Alive but not yet extended today: this is the in-app reminder signal.
    -- No scheduler is involved; the prompt is computed when the customer reads.
    'expires_today', v_row.current_count > 0
      AND v_row.last_activity_date = (v_today - 1),
    'advanced_today', p_advanced_today,
    'milestones_awarded', to_jsonb(p_awarded),
    'next_milestone', v_next,
    'badges', v_badges
  );
END;
$$;

-- Supabase grants EXECUTE on new public-schema functions to anon/authenticated/
-- service_role by default, so REVOKE FROM PUBLIC alone is NOT sufficient. The
-- helper accepts an arbitrary profile_id and is SECURITY DEFINER, so leaving it
-- callable by `authenticated` would let any customer read another customer's
-- streak state. Verified on Postgres 17 against a real grant/RLS test.
REVOKE ALL ON FUNCTION public.build_streak_state(UUID, BOOLEAN, INTEGER[]) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 4. record_streak_activity
-- ============================================================================
-- Idempotent per calendar day. Safe to call on every authenticated page view:
-- calling it three times in one day still counts as one day.
CREATE OR REPLACE FUNCTION public.record_streak_activity()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_today    DATE := (now() AT TIME ZONE 'Africa/Kinshasa')::DATE;
  v_row      public.streaks;
  v_advanced BOOLEAN := false;
  v_awarded  INTEGER[] := ARRAY[]::INTEGER[];
  v_inserted INTEGER;
  t          INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  INSERT INTO public.streaks (profile_id)
  VALUES (v_uid)
  ON CONFLICT (profile_id) DO NOTHING;

  SELECT * INTO v_row
  FROM public.streaks
  WHERE profile_id = v_uid
  FOR UPDATE;

  -- Already counted today: nothing to do.
  IF v_row.last_activity_date = v_today THEN
    RETURN public.build_streak_state(v_uid, false, v_awarded);
  END IF;

  IF v_row.last_activity_date = (v_today - 1) THEN
    -- Consecutive day: extend.
    v_row.current_count := v_row.current_count + 1;
  ELSE
    -- First ever day, or the streak broke. Hard break, history is kept in
    -- longest_count and total_active_days.
    v_row.current_count := 1;
  END IF;

  v_advanced := true;

  UPDATE public.streaks
  SET current_count = v_row.current_count,
      longest_count = GREATEST(longest_count, v_row.current_count),
      total_active_days = total_active_days + 1,
      last_activity_date = v_today,
      started_on = COALESCE(started_on, v_today),
      updated_at = timezone('utc', now())
  WHERE profile_id = v_uid;

  -- Award every milestone now reached. ON CONFLICT DO NOTHING makes a repeated
  -- call safe even if the counter were ever rewound.
  FOREACH t IN ARRAY ARRAY[3, 7, 30, 100, 365]
  LOOP
    IF v_row.current_count >= t THEN
      -- Separate variable on purpose: ON CONFLICT DO NOTHING returns no row, so
      -- the loop variable must not be reused as the "was it inserted?" probe.
      v_inserted := NULL;
      INSERT INTO public.streak_milestones (profile_id, threshold)
      VALUES (v_uid, t)
      ON CONFLICT (profile_id, threshold) DO NOTHING
      RETURNING threshold INTO v_inserted;

      IF v_inserted IS NOT NULL THEN
        v_awarded := array_append(v_awarded, v_inserted);
      END IF;
    END IF;
  END LOOP;

  RETURN public.build_streak_state(v_uid, v_advanced, v_awarded);
END;
$$;

REVOKE ALL ON FUNCTION public.record_streak_activity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_streak_activity() TO authenticated;

-- ============================================================================
-- 5. get_my_streak
-- ============================================================================
-- Read-only counterpart used by the dashboard panel, so opening the panel does
-- not itself count as activity.
CREATE OR REPLACE FUNCTION public.get_my_streak()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  RETURN public.build_streak_state(auth.uid(), false, ARRAY[]::INTEGER[]);
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_streak() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_streak() TO authenticated;

-- ============================================================================
-- 6. Milestone notification
-- ============================================================================
-- `notifications` has no client INSERT policy by design; triggers running as
-- SECURITY DEFINER are the only normal write path (20260928100000:48-50).
-- The ledger's primary key is the idempotency guard, so a threshold can never
-- notify twice even if the row is somehow re-created.
CREATE OR REPLACE FUNCTION public.notify_on_streak_milestone()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (user_id, actor_id, entity_type, entity_id, title, message, type, data)
  VALUES (
    NEW.profile_id,
    NULL,
    'streak_milestone',
    NEW.profile_id,
    'Series de jours atteinte',
    CASE NEW.threshold
      WHEN 3   THEN '3 jours d''affilée. Continuez comme ça !'
      WHEN 7   THEN '7 jours d''affilée. Votre série est solide !'
      WHEN 30  THEN '30 jours d''affilée. Impressionnant !'
      WHEN 100 THEN '100 jours d''affilée. Quelle constance !'
      WHEN 365 THEN '365 jours d''affilée. Une année entière ensemble !'
      ELSE 'Vous avez atteint un nouveau palier.'
    END,
    'streak_milestone',
    jsonb_build_object('threshold', NEW.threshold)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "Notify customers of streak milestones" ON public.streak_milestones;
CREATE TRIGGER "Notify customers of streak milestones"
  AFTER INSERT ON public.streak_milestones
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_streak_milestone();

REVOKE ALL ON FUNCTION public.notify_on_streak_milestone() FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- REVERSIBLE (rollback)
--   DROP TRIGGER IF EXISTS "Notify customers of streak milestones" ON public.streak_milestones;
--   DROP FUNCTION IF EXISTS public.notify_on_streak_milestone();
--   DROP FUNCTION IF EXISTS public.get_my_streak();
--   DROP FUNCTION IF EXISTS public.record_streak_activity();
--   DROP FUNCTION IF EXISTS public.build_streak_state(UUID, BOOLEAN, INTEGER[]);
--   DROP TABLE IF EXISTS public.streak_milestones;
--   DROP TABLE IF EXISTS public.streaks;
-- ============================================================================