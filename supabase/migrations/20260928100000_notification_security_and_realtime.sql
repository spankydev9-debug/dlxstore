-- DLXSTORE — notification security and Realtime compatibility hardening
--
-- PRE-APPLICATION REQUIREMENT
-- ---------------------------
-- Do not apply this migration until the remote migration history has been read
-- from the target database. `20260823154800_realtime_notifications.sql` exists
-- only on main and may or may not already be recorded remotely. This migration
-- intentionally supersedes its unsafe authenticated INSERT policy either way.
--
-- This migration is additive/restrictive: it preserves notification rows and
-- existing trigger names while making notification creation database-owned.

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

-- Remove both the production policy names and the main-only migration policy
-- names. An authenticated browser must never be able to create a notification
-- for an arbitrary target account.
DROP POLICY IF EXISTS "Users can view and edit their own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Admins can create notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can read their own or admin notifications" ON public.notifications;
DROP POLICY IF EXISTS "Authenticated users can insert notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can update their own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can delete their own notifications" ON public.notifications;

CREATE POLICY "Notification recipients and admins can read"
  ON public.notifications FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "Notification recipients can mark their own notifications read"
  ON public.notifications FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Database triggers run as SECURITY DEFINER and remain the only normal write
-- path. Admin campaigns should use a server-side service-role workflow, not a
-- browser insert policy.

CREATE OR REPLACE FUNCTION public.notify_on_new_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin RECORD;
BEGIN
  IF NEW.customer_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, actor_id, entity_type, entity_id, title, message, type, data)
    VALUES (
      NEW.customer_id,
      NULL,
      'order',
      NEW.id,
      'Commande enregistrée',
      'Votre commande a été reçue et attend confirmation.',
      'order_status',
      jsonb_build_object('order_id', NEW.id, 'status', NEW.status)
    );
  END IF;

  FOR v_admin IN SELECT id FROM public.profiles WHERE role = 'admin'
  LOOP
    INSERT INTO public.notifications (user_id, actor_id, entity_type, entity_id, title, message, type, data)
    VALUES (
      v_admin.id,
      NEW.customer_id,
      'order',
      NEW.id,
      'Nouvelle commande',
      'Une nouvelle commande nécessite une vérification.',
      'new_order',
      jsonb_build_object('order_id', NEW.id, 'status', NEW.status)
    );
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_on_order_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title TEXT;
  v_message TEXT;
BEGIN
  IF NEW.customer_id IS NULL OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  v_title := 'Mise à jour de commande';
  v_message := CASE NEW.status
    WHEN 'confirmed' THEN 'Votre commande a été confirmée.'
    WHEN 'preparing' THEN 'Votre commande est en préparation.'
    WHEN 'ready' THEN 'Votre commande est prête.'
    WHEN 'out_for_delivery' THEN 'Votre commande est en livraison.'
    WHEN 'delivered' THEN 'Votre commande a été livrée.'
    WHEN 'cancelled' THEN 'Votre commande a été annulée. Contactez le support si nécessaire.'
    ELSE 'Le statut de votre commande a été mis à jour.'
  END;

  INSERT INTO public.notifications (user_id, actor_id, entity_type, entity_id, title, message, type, data)
  VALUES (
    NEW.customer_id,
    NULL,
    'order',
    NEW.id,
    v_title,
    v_message,
    'order_status',
    jsonb_build_object('order_id', NEW.id, 'status', NEW.status)
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_notification_read_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.is_read AND NOT OLD.is_read THEN
    NEW.read_at := COALESCE(NEW.read_at, now());
  ELSIF NOT NEW.is_read THEN
    NEW.read_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_on_new_order ON public.orders;
CREATE TRIGGER trigger_notify_on_new_order
  AFTER INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_new_order();

DROP TRIGGER IF EXISTS trigger_notify_on_order_status_change ON public.orders;
CREATE TRIGGER trigger_notify_on_order_status_change
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_order_status_change();

DROP TRIGGER IF EXISTS trg_set_notification_read_at ON public.notifications;
CREATE TRIGGER trg_set_notification_read_at
  BEFORE UPDATE OF is_read ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.set_notification_read_at();

-- Keep Realtime idempotent and tolerant of projects where the publication was
-- not created yet. Realtime filters still enforce table RLS for each subscriber.
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
