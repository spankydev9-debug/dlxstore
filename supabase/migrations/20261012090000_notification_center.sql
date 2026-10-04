-- DLXSTORE — notification center: preferences, unified channels, admin broadcast
--
-- ROADMAP area 16 — "Notifications" (your list position 9).
--
-- WHAT ALREADY EXISTED AND IS DELIBERATELY NOT REBUILT
-- ---------------------------------------------------
--   * `public.notifications` (schema.sql:127) with a `type` TEXT column.
--   * The order triggers and the hardened RLS from
--     `20260928100000_notification_security_and_realtime.sql`, which made
--     notification creation database-owned. `notifications` has NO INSERT policy
--     for `authenticated` on purpose, and that stays true here.
--   * Producers that already write notifications and are NOT touched by this
--     migration: orders (new + status), chat messages, friend request/accepted,
--     streak milestones, story reaction, story mention, product share.
--   * `Realtime` publication membership for `notifications`, already added by
--     20260928100000 and re-asserted idempotently at the end of this file.
--
-- WHAT THIS MIGRATION ADDS
-- ------------------------
--   1. A single SQL-owned mapping from `type` to a customer-facing *channel*
--      (`orders` | `social` | `messages` | `rewards` | `system`). The UI never
--      hard-codes the mapping for server reads; it asks for a channel.
--   2. `notification_preferences` — "users choose what they receive" implemented
--      as a row per (profile, channel). Missing row means enabled.
--   3. A `BEFORE INSERT` trigger that suppresses inserts for a channel the
--      recipient has switched off. This is what makes preferences apply to
--      *every* existing producer without rewriting one of them.
--   4. The missing DELETE policy. `deleteNotification()` in the client has been
--      calling a delete that RLS rejected, so deletions silently did nothing.
--   5. Customer RPCs: paginated/filtered read, unread summary, mark-all-read
--      (optionally scoped to a channel), clear-read, read/write preferences.
--   6. `broadcast_notification()` — an admin-only, audience-scoped send path for
--      promotions and new drops. It exists so admin campaigns never need a
--      browser INSERT policy on `notifications`.
--   7. A low-stock trigger on `products`. Today the low-stock alert only exists
--      in the local demo path (`src/services/db/products.ts:262`) and never
--      reaches a real admin.
--
-- PRE-APPLICATION REQUIREMENTS
-- ----------------------------
--   1. Read the remote migration ledger and obtain explicit operator approval.
--      This file is NOT applied by the agent that wrote it.
--   2. Apply after `20260928100000`. Every column that migration adds is also
--      re-asserted here with `ADD COLUMN IF NOT EXISTS` so this file is
--      self-sufficient if the ledger shows it was skipped.
--   3. Additive and idempotent. No notification row is rewritten, moved or
--      deleted. No `type` value is changed.
--   4. Grants are explicit. Supabase's platform defaults make every new `public`
--      function executable by `anon`, so `REVOKE ... FROM PUBLIC` alone is not
--      enough; each function is revoked and then granted deliberately.
--
-- A KNOWN, ACCEPTED SIDE EFFECT
-- -----------------------------
-- A `BEFORE INSERT` trigger returning NULL cancels the row. Nothing in the
-- codebase depends on the insert returning an id: every producer in
-- 20260829080000, 20260928100000, 20261004090000, 20261005090000,
-- 20261006090000 and 20261008090000 performs a plain `INSERT` with no
-- `RETURNING`. The suppression therefore only removes a notification, which is
-- exactly the requested behaviour.

-- ============================================================================
-- 1. Columns this file depends on (re-asserted, idempotent)
-- ============================================================================
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS entity_type TEXT,
  ADD COLUMN IF NOT EXISTS entity_id UUID,
  ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON public.notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_unread_user_created_idx
  ON public.notifications (user_id, created_at DESC)
  WHERE is_read = false;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2. Channel mapping — the single source of truth
-- ============================================================================
-- Adding a new notification type is a one-line change here. The UI reads the
-- channel from this mapping (through the RPCs below), so it cannot drift.
CREATE OR REPLACE FUNCTION public.notification_channel(p_type TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_type IN ('order_status', 'new_order') THEN 'orders'
    WHEN p_type IN ('chat_message') THEN 'messages'
    WHEN p_type IN (
      'friend_request', 'friend_accepted',
      'story_reaction', 'story_mention',
      'product_share', 'product_reaction'
    ) THEN 'social'
    WHEN p_type IN ('reward', 'streak_milestone', 'promotion', 'new_drop') THEN 'rewards'
    ELSE 'system'
  END;
$$;

CREATE OR REPLACE FUNCTION public.notification_channel_valid(p_channel TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT p_channel IN ('orders', 'social', 'messages', 'rewards', 'system');
$$;

-- Channels the customer is NOT allowed to switch off.
--
-- `order_status` is the only customer-facing type in this set: it is the
-- delivery contract for a cash-on-delivery purchase in Goma, and a customer who
-- never learns their parcel is out for delivery has lost a real trip. The other
-- three are operational alerts addressed to admins.
CREATE OR REPLACE FUNCTION public.notification_channel_mandatory(p_type TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT p_type IN ('order_status', 'new_order', 'low_stock', 'partner_application');
$$;
-- ============================================================================
-- 3. Preferences
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  channel    TEXT NOT NULL CHECK (public.notification_channel_valid(channel)),
  enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (profile_id, channel)
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Customers read their own notification preferences" ON public.notification_preferences;
CREATE POLICY "Customers read their own notification preferences"
  ON public.notification_preferences FOR SELECT
  USING (profile_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "Customers create their own notification preferences" ON public.notification_preferences;
CREATE POLICY "Customers create their own notification preferences"
  ON public.notification_preferences FOR INSERT
  WITH CHECK (profile_id = auth.uid());

DROP POLICY IF EXISTS "Customers update their own notification preferences" ON public.notification_preferences;
CREATE POLICY "Customers update their own notification preferences"
  ON public.notification_preferences FOR UPDATE
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

DROP POLICY IF EXISTS "Customers delete their own notification preferences" ON public.notification_preferences;
CREATE POLICY "Customers delete their own notification preferences"
  ON public.notification_preferences FOR DELETE
  USING (profile_id = auth.uid());

-- ============================================================================
-- 4. Notification RLS (re-asserted so this file never depends on ledger order)
-- ============================================================================
DROP POLICY IF EXISTS "Users can view and edit their own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Admins can create notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can read their own or admin notifications" ON public.notifications;
DROP POLICY IF EXISTS "Authenticated users can insert notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can update their own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can delete their own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Notification recipients and admins can read" ON public.notifications;
DROP POLICY IF EXISTS "Notification recipients can mark their own notifications read" ON public.notifications;
DROP POLICY IF EXISTS "Notification recipients can delete their own notifications" ON public.notifications;

CREATE POLICY "Notification recipients and admins can read"
  ON public.notifications FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "Notification recipients can mark their own notifications read"
  ON public.notifications FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- The policy `20260928100000` never created. Without it the client delete
-- matched zero rows and still reported success.
CREATE POLICY "Notification recipients can delete their own notifications"
  ON public.notifications FOR DELETE
  USING (user_id = auth.uid());

-- Still no INSERT policy. Database triggers and the admin RPC below are the only
-- write paths, so a browser cannot forge a notification for another account.
-- ============================================================================
-- 5. Preference enforcement (applies to every existing producer)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.notification_should_deliver(
  p_user_id UUID,
  p_type TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_channel TEXT;
  v_enabled BOOLEAN;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF public.notification_channel_mandatory(p_type) THEN
    RETURN TRUE;
  END IF;

  v_channel := public.notification_channel(p_type);

  SELECT p.enabled INTO v_enabled
  FROM public.notification_preferences p
  WHERE p.profile_id = p_user_id
    AND p.channel = v_channel;

  -- No stored row means the customer has never expressed a preference, so the
  -- default is to deliver. Opt-in-by-default matches how the channel behaved
  -- before this migration existed.
  RETURN COALESCE(v_enabled, TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_notification_preferences()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.notification_should_deliver(NEW.user_id, NEW.type) THEN
    -- Returning NULL cancels this row only. See the header note: no producer
    -- relies on an insert RETURNING value.
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_notification_preferences ON public.notifications;
CREATE TRIGGER trg_enforce_notification_preferences
  BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_notification_preferences();

-- ============================================================================
-- 6. Customer read + mutate RPCs
-- ============================================================================
-- These are SECURITY INVOKER on purpose: RLS stays the authorization decision,
-- and every function additionally pins `user_id = auth.uid()`. That combination
-- is what the over-broad EXECUTE-grant class in
-- `20261007090000_revoke_internal_helper_grants.sql` was about, so no read RPC
-- here accepts an identity argument.
CREATE OR REPLACE FUNCTION public.get_my_notifications(
  p_channel TEXT DEFAULT NULL,
  p_unread_only BOOLEAN DEFAULT FALSE,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS SETOF public.notifications
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT n.*
  FROM public.notifications n
  WHERE n.user_id = auth.uid()
    AND (
      p_channel IS NULL
      OR (
        public.notification_channel_valid(p_channel)
        AND public.notification_channel(n.type) = p_channel
      )
    )
    AND (COALESCE(p_unread_only, FALSE) = FALSE OR n.is_read = FALSE)
  ORDER BY n.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

CREATE OR REPLACE FUNCTION public.get_my_notification_summary()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH mine AS (
    SELECT public.notification_channel(type) AS channel, is_read
    FROM public.notifications
    WHERE user_id = auth.uid()
  ),
  per_channel AS (
    SELECT
      c.channel,
      COALESCE(agg.total, 0)  AS total,
      COALESCE(agg.unread, 0) AS unread
    FROM unnest(ARRAY['orders', 'social', 'messages', 'rewards', 'system']) AS c(channel)
    LEFT JOIN (
      SELECT channel, COUNT(*)::INTEGER AS total,
             COUNT(*) FILTER (WHERE is_read = FALSE)::INTEGER AS unread
      FROM mine
      GROUP BY channel
    ) AS agg ON agg.channel = c.channel
  )
  SELECT jsonb_build_object(
    'total',   COALESCE((SELECT COUNT(*) FROM mine), 0),
    'unread',  COALESCE((SELECT COUNT(*) FILTER (WHERE is_read = FALSE) FROM mine), 0),
    'channels', COALESCE(
      (SELECT jsonb_object_agg(
         channel,
         jsonb_build_object('total', total, 'unread', unread)
       ) FROM per_channel),
      '{}'::JSONB
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read(p_channel TEXT DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_count INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_channel IS NOT NULL AND NOT public.notification_channel_valid(p_channel) THEN
    RAISE EXCEPTION 'unknown_notification_channel' USING ERRCODE = '22023';
  END IF;

  UPDATE public.notifications
  SET is_read = TRUE
  WHERE user_id = v_uid
    AND is_read = FALSE
    AND (
      p_channel IS NULL
      OR public.notification_channel(type) = p_channel
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- "Clear read" is the only bulk delete offered. It cannot touch an unread row,
-- so a customer can never lose a notification they have not seen yet.
CREATE OR REPLACE FUNCTION public.delete_my_read_notifications()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_count INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  DELETE FROM public.notifications
  WHERE user_id = v_uid
    AND is_read = TRUE;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ============================================================================
-- 7. Preference RPCs
-- ============================================================================
-- These two are SECURITY DEFINER, unlike the notification read RPCs above.
-- `notification_preferences` is deliberately NOT exposed to PostgREST: it gets
-- no table grant to `authenticated`, exactly as `streaks` and `friendships` are
-- handled in 20261005090000 and 20261004090000. The identity guard inside each
-- function is therefore the authorization decision, and the RLS policies below
-- remain as defence in depth for whoever exposes the table later.
CREATE OR REPLACE FUNCTION public.get_my_notification_preferences()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_result JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT COALESCE(
    jsonb_object_agg(
      c.channel,
      jsonb_build_object(
        -- `orders` reports enabled=true unconditionally because the database
        -- refuses to store it as false (see set_my_notification_preference).
        'enabled', CASE
          WHEN c.channel = 'orders' THEN TRUE
          ELSE COALESCE(p.enabled, TRUE)
        END,
        'mandatory', c.channel = 'orders'
      )
    ),
    '{}'::JSONB
  )
  INTO v_result
  FROM unnest(ARRAY['orders', 'social', 'messages', 'rewards', 'system']) AS c(channel)
  LEFT JOIN public.notification_preferences p
    ON p.profile_id = v_uid AND p.channel = c.channel;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_my_notification_preference(
  p_channel TEXT,
  p_enabled BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT public.notification_channel_valid(p_channel) THEN
    RAISE EXCEPTION 'unknown_notification_channel' USING ERRCODE = '22023';
  END IF;

  -- `orders` is part of the delivery contract and cannot be switched off. The
  -- UI renders it as a locked, always-on row; the database enforces the same
  -- rule so a hand-crafted request cannot disable order updates.
  IF p_channel = 'orders' AND p_enabled = FALSE THEN
    RAISE EXCEPTION 'mandatory_notification_channel' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.notification_preferences (profile_id, channel, enabled, updated_at)
  VALUES (v_uid, p_channel, COALESCE(p_enabled, TRUE), timezone('utc', now()))
  ON CONFLICT (profile_id, channel)
  DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = timezone('utc', now());

  RETURN public.get_my_notification_preferences();
END;
$$;
-- ============================================================================
-- 8. Admin broadcast (promotions, new drops)
-- ============================================================================
-- The ONLY way an admin can create a notification for someone else. It is
-- SECURITY DEFINER because `notifications` has no INSERT policy; the
-- authorization decision is made inside the function with `public.is_admin()`,
-- which is exactly the pattern `20260928100000:48-50` describes for campaigns.
--
-- The allowed `p_type` set is deliberately narrow. An admin cannot forge an
-- `order_status` notification through this path, so a campaign can never be
-- mistaken for a delivery update.
CREATE OR REPLACE FUNCTION public.broadcast_notification(
  p_title TEXT,
  p_message TEXT,
  p_type TEXT,
  p_audience TEXT DEFAULT 'customers',
  p_entity_type TEXT DEFAULT NULL,
  p_entity_id UUID DEFAULT NULL,
  p_data JSONB DEFAULT '{}'::JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
  v_title TEXT := btrim(COALESCE(p_title, ''));
  v_message TEXT := btrim(COALESCE(p_message, ''));
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  IF p_type NOT IN ('promotion', 'new_drop', 'reward', 'system') THEN
    RAISE EXCEPTION 'unsupported_broadcast_type' USING ERRCODE = '22023';
  END IF;

  IF v_title = '' OR v_message = '' THEN
    RAISE EXCEPTION 'title_and_message_required' USING ERRCODE = '22023';
  END IF;

  IF p_audience NOT IN ('customers', 'admins', 'all') THEN
    RAISE EXCEPTION 'unsupported_audience' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.notifications (
    user_id, actor_id, entity_type, entity_id, title, message, type, data
  )
  SELECT
    pr.id,
    auth.uid(),
    p_entity_type,
    p_entity_id,
    left(v_title, 160),
    left(v_message, 500),
    p_type,
    COALESCE(p_data, '{}'::JSONB)
  FROM public.profiles pr
  WHERE (p_audience = 'all')
     OR (p_audience = 'customers' AND pr.role <> 'admin')
     OR (p_audience = 'admins' AND pr.role = 'admin');

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Recipients who switched this channel off are suppressed by
  -- trg_enforce_notification_preferences, so the returned count can be lower
  -- than the audience size. The UI reports it honestly as "sent".
  RETURN v_count;
END;
$$;

-- ============================================================================
-- 9. Low-stock admin alert (the production gap)
-- ============================================================================
-- Fires once per downward crossing of `low_stock_threshold`, not on every stock
-- change inside the warning band, so a quiet week does not produce a flood.
CREATE OR REPLACE FUNCTION public.notify_admins_on_low_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_threshold INTEGER;
  v_admin RECORD;
BEGIN
  IF NEW.stock_quantity IS NOT DISTINCT FROM OLD.stock_quantity THEN
    RETURN NEW;
  END IF;

  v_threshold := COALESCE(NEW.low_stock_threshold, 3);

  IF NOT (COALESCE(OLD.stock_quantity, 0) >= v_threshold
          AND COALESCE(NEW.stock_quantity, 0) < v_threshold) THEN
    RETURN NEW;
  END IF;

  FOR v_admin IN SELECT id FROM public.profiles WHERE role = 'admin'
  LOOP
    INSERT INTO public.notifications (
      user_id, actor_id, entity_type, entity_id, title, message, type, data
    )
    VALUES (
      v_admin.id,
      NULL,
      'product',
      NEW.id,
      'Stock bas',
      COALESCE(NEW.name, 'Un article') || ' n''a plus que '
        || COALESCE(NEW.stock_quantity, 0) || ' unité(s) en stock.',
      'low_stock',
      jsonb_build_object(
        'product_id', NEW.id,
        'stock_quantity', COALESCE(NEW.stock_quantity, 0),
        'threshold', v_threshold
      )
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_admins_on_low_stock ON public.products;
CREATE TRIGGER trg_notify_admins_on_low_stock
  AFTER UPDATE OF stock_quantity ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.notify_admins_on_low_stock();
-- ============================================================================
-- 10. Realtime + grants
-- ============================================================================
-- Idempotent, and tolerant of a project where the publication does not exist
-- yet. Realtime filters still enforce table RLS for each subscriber, so the
-- contract for a realtime row is a policy-visible row for that user.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
EXCEPTION
  WHEN undefined_object OR duplicate_object THEN NULL;
END;
$$;

-- Trigger functions and internal helpers are never callable by a client.
REVOKE ALL ON FUNCTION public.notification_should_deliver(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_notification_preferences() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_admins_on_low_stock() FROM PUBLIC, anon, authenticated;

-- Channel mapping helpers are pure and carry no data: `authenticated` only, so
-- they can be used inside RLS-visible SQL without widening anonymous reach.
REVOKE ALL ON FUNCTION public.notification_channel(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.notification_channel_valid(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.notification_channel_mandatory(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notification_channel(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.notification_channel_valid(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.notification_channel_mandatory(TEXT) TO authenticated;

-- Customer surface.
REVOKE ALL ON FUNCTION public.get_my_notifications(TEXT, BOOLEAN, INTEGER, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_notification_summary() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_all_notifications_read(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_my_read_notifications() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_notification_preferences() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_my_notification_preference(TEXT, BOOLEAN) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_my_notifications(TEXT, BOOLEAN, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_notification_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_my_read_notifications() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_notification_preferences() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_my_notification_preference(TEXT, BOOLEAN) TO authenticated;

-- Admin surface. The internal `is_admin()` check is the authorization decision;
-- an anonymous caller is rejected inside the function even if it can reach it.
REVOKE ALL ON FUNCTION public.broadcast_notification(TEXT, TEXT, TEXT, TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.broadcast_notification(TEXT, TEXT, TEXT, TEXT, TEXT, UUID, JSONB) TO authenticated;

-- ============================================================================
-- REVERSIBLE (rollback)
--   DROP TRIGGER IF EXISTS trg_notify_admins_on_low_stock ON public.products;
--   DROP FUNCTION IF EXISTS public.notify_admins_on_low_stock();
--   DROP FUNCTION IF EXISTS public.broadcast_notification(TEXT, TEXT, TEXT, TEXT, TEXT, UUID, JSONB);
--   DROP FUNCTION IF EXISTS public.set_my_notification_preference(TEXT, BOOLEAN);
--   DROP FUNCTION IF EXISTS public.get_my_notification_preferences();
--   DROP FUNCTION IF EXISTS public.delete_my_read_notifications();
--   DROP FUNCTION IF EXISTS public.mark_all_notifications_read(TEXT);
--   DROP FUNCTION IF EXISTS public.get_my_notification_summary();
--   DROP FUNCTION IF EXISTS public.get_my_notifications(TEXT, BOOLEAN, INTEGER, INTEGER);
--   DROP TRIGGER IF EXISTS trg_enforce_notification_preferences ON public.notifications;
--   DROP FUNCTION IF EXISTS public.enforce_notification_preferences();
--   DROP FUNCTION IF EXISTS public.notification_should_deliver(UUID, TEXT);
--   DROP FUNCTION IF EXISTS public.notification_channel_mandatory(TEXT);
--   DROP FUNCTION IF EXISTS public.notification_channel_valid(TEXT);
--   DROP FUNCTION IF EXISTS public.notification_channel(TEXT);
--   DROP POLICY IF EXISTS "Notification recipients can delete their own notifications" ON public.notifications;
--   DROP TABLE IF EXISTS public.notification_preferences;
--
--   Note: the SELECT and UPDATE policies are intentionally left in place on
--   rollback — they are the correct policies and were re-asserted, not created,
--   by this file.
-- ============================================================================