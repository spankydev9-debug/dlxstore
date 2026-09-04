-- DLXSTORE — Rewards corrective hardening (concurrency + duplicate-milestone safety)
-- ---------------------------------------------------------------------------
-- The rewards foundation migration (20260902120000) is already applied remotely.
-- This corrective migration hardens two audit findings WITHOUT redesigning the
-- working reward behaviour:
--
--   1. record_share_event(): the per-channel cooldown and global rolling 24 h
--      cap used a read-then-insert pattern that two concurrent requests could
--      race past, letting a customer record more shares than intended. A
--      per-customer transactional advisory lock now makes the check + insert a
--      single atomic critical section while keeping the exact same limits.
--
--   2. Duplicate milestone cleanup: the earlier dedupe relied on UUID ordering
--      and, because customer_rewards.milestone_id is ON DELETE CASCADE, could
--      silently delete earned rewards attached to a duplicate milestone. We now
--      (a) pick a deterministic canonical milestone using creation semantics
--      (prefer any row actually referenced by customer_rewards, then the
--      earliest created_at, then smallest id), (b) re-point dependent rewards
--      to the canonical row, (c) delete duplicates only when they no longer
--      reference any reward. Rewards are always preserved.
--
-- Fully idempotent. SECURITY DEFINER + SET search_path = public preserved.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. record_share_event — race-safe share anti-abuse
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

  -- Serialize concurrent share recording per customer so the cooldown/cap
  -- checks below and the INSERT form one atomic critical section. Without this
  -- two simultaneous requests could both pass the checks and both be recorded.
  PERFORM pg_advisory_xact_lock(hashtextextended('share_event:' || v_uid::TEXT, 0));

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
-- 2. Duplicate milestone cleanup — customer-reward-safe
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_group     RECORD;
  v_canonical UUID;
  v_dup       UUID;
BEGIN
  FOR v_group IN
    SELECT milestone_type, threshold
    FROM public.reward_milestones
    GROUP BY milestone_type, threshold
    HAVING count(*) > 1
  LOOP
    -- Canonical candidate: any row in this duplicate group that is actually
    -- referenced by customer_rewards — re-pointing those is a no-op and the
    -- referenced row is by definition the one customers depend on.
    SELECT m.id INTO v_canonical
    FROM public.reward_milestones m
    WHERE m.milestone_type = v_group.milestone_type
      AND m.threshold = v_group.threshold
      AND EXISTS (
        SELECT 1 FROM public.customer_rewards cr WHERE cr.milestone_id = m.id
      )
    ORDER BY m.created_at ASC, m.id ASC
    LIMIT 1;

    -- Otherwise use deterministic creation semantics: the earliest milestone
    -- created (tie-break by smallest id). NOT UUID ordering alone.
    IF v_canonical IS NULL THEN
      SELECT m.id INTO v_canonical
      FROM public.reward_milestones m
      WHERE m.milestone_type = v_group.milestone_type
        AND m.threshold = v_group.threshold
      ORDER BY m.created_at ASC, m.id ASC
      LIMIT 1;
    END IF;

    -- Re-point every reward that references a duplicate milestone onto the
    -- canonical row — unless that same profile already has a reward for the
    -- canonical row, in which case we leave it untouched (preserving data).
    FOR v_dup IN
      SELECT m.id FROM public.reward_milestones m
      WHERE m.milestone_type = v_group.milestone_type
        AND m.threshold = v_group.threshold
        AND m.id <> v_canonical
    LOOP
      UPDATE public.customer_rewards cr
      SET milestone_id = v_canonical
      WHERE cr.milestone_id = v_dup
        AND NOT EXISTS (
          SELECT 1 FROM public.customer_rewards other
          WHERE other.profile_id = cr.profile_id
            AND other.milestone_id = v_canonical
        );
    END LOOP;

    -- Only delete duplicate rows that no longer own any rewards after the
    -- re-pointing. Any row still referenced (conflicting duplicate award edge
    -- case) is kept so existing customer rewards are never destroyed.
    DELETE FROM public.reward_milestones m
    WHERE m.milestone_type = v_group.milestone_type
      AND m.threshold = v_group.threshold
      AND m.id <> v_canonical
      AND NOT EXISTS (
        SELECT 1 FROM public.customer_rewards cr WHERE cr.milestone_id = m.id
      );
  END LOOP;
END $$;
