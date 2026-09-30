-- DLXSTORE Real-Time Notification System Migration
-- Unique Timestamp: 20260823154800

-- 1. Enable Supabase Realtime publication on public.notifications table idempotently
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
      AND schemaname = 'public' 
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
EXCEPTION
  WHEN undefined_object THEN NULL;
  WHEN duplicate_object THEN NULL;
END $$;

-- 2. Ensure notifications table RLS policies are up-to-date and idempotent
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view and edit their own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Admins can create notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can read their own or admin notifications" ON public.notifications;
DROP POLICY IF EXISTS "Authenticated users can insert notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can update their own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can delete their own notifications" ON public.notifications;

-- Policy 1: Users can read their own notifications, or admins can read all
CREATE POLICY "Users can read their own or admin notifications" ON public.notifications
  FOR SELECT USING (
    auth.uid() = user_id OR public.is_admin()
  );

-- Policy 2: Authenticated users can insert notifications (for system actions)
CREATE POLICY "Authenticated users can insert notifications" ON public.notifications
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated'
  );

-- Policy 3: Users can update their own notifications (e.g. mark as read)
CREATE POLICY "Users can update their own notifications" ON public.notifications
  FOR UPDATE USING (
    auth.uid() = user_id OR public.is_admin()
  ) WITH CHECK (
    auth.uid() = user_id OR public.is_admin()
  );

-- Policy 4: Users can delete their own notifications
CREATE POLICY "Users can delete their own notifications" ON public.notifications
  FOR DELETE USING (
    auth.uid() = user_id OR public.is_admin()
  );

-- ============================================================================
-- 3. AUTOMATIC DATABASE NOTIFICATION TRIGGERS
-- ============================================================================

-- Trigger Function 1: Notify on New Order
CREATE OR REPLACE FUNCTION public.notify_on_new_order()
RETURNS TRIGGER AS $$
DECLARE
  admin_rec RECORD;
BEGIN
  -- Notify customer
  INSERT INTO public.notifications (user_id, title, message, type, is_read)
  VALUES (
    NEW.customer_id,
    'Commande Enregistrée ! 📦',
    'Votre commande #' || NEW.id || ' d''un montant de ' || NEW.total_amount || ' $ a été reçue et est en attente de confirmation.',
    'order_status',
    false
  );

  -- Notify all admin profiles
  FOR admin_rec IN SELECT id FROM public.profiles WHERE role = 'admin' LOOP
    INSERT INTO public.notifications (user_id, title, message, type, is_read)
    VALUES (
      admin_rec.id,
      'Nouvelle Commande Reçue ! 🛒',
      'Nouvelle commande #' || NEW.id || ' de ' || NEW.customer_name || ' (' || NEW.total_amount || ' $).',
      'new_order',
      false
    );
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trigger_notify_on_new_order ON public.orders;
CREATE TRIGGER trigger_notify_on_new_order
  AFTER INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_new_order();

-- Trigger Function 2: Notify Customer on Order Status Change
CREATE OR REPLACE FUNCTION public.notify_on_order_status_change()
RETURNS TRIGGER AS $$
DECLARE
  title_text TEXT;
  msg_text TEXT;
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'confirmed' THEN
      title_text := 'Commande Confirmée ! ✔️';
      msg_text := 'Votre commande #' || NEW.id || ' a été confirmée et est en cours de préparation.';
    ELSIF NEW.status = 'out_for_delivery' THEN
      title_text := 'Commande en Livraison ! 🚚';
      msg_text := 'Votre commande #' || NEW.id || ' est en route. Préparez ' || NEW.total_amount || ' $ en espèces (COD).';
    ELSIF NEW.status = 'delivered' THEN
      title_text := 'Commande Livrée ! 🎉';
      msg_text := 'Votre commande #' || NEW.id || ' a été livrée avec succès. Merci d''avoir choisi DLXSTORE !';
    ELSIF NEW.status = 'cancelled' THEN
      title_text := 'Commande Annulée ❌';
      msg_text := 'Votre commande #' || NEW.id || ' a été annulée. Contactez le support si vous avez des questions.';
    ELSE
      title_text := 'Statut de Commande Mis à Jour 📋';
      msg_text := 'Le statut de votre commande #' || NEW.id || ' est maintenant : ' || NEW.status || '.';
    END IF;

    INSERT INTO public.notifications (user_id, title, message, type, is_read)
    VALUES (NEW.customer_id, title_text, msg_text, 'order_status', false);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trigger_notify_on_order_status_change ON public.orders;
CREATE TRIGGER trigger_notify_on_order_status_change
  AFTER UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_order_status_change();

-- Trigger Function 3: Notify on Partner Applications
CREATE OR REPLACE FUNCTION public.notify_on_partner_application()
RETURNS TRIGGER AS $$
DECLARE
  admin_rec RECORD;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Notify admins
    FOR admin_rec IN SELECT id FROM public.profiles WHERE role = 'admin' LOOP
      INSERT INTO public.notifications (user_id, title, message, type, is_read)
      VALUES (
        admin_rec.id,
        'Nouvelle Candidature Partenaire ! 🤝',
        'Candidature reçue pour ' || NEW.business_name || ' (' || NEW.owner_name || ').',
        'partner_application',
        false
      );
    END LOOP;
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status AND NEW.applicant_id IS NOT NULL THEN
    -- Notify applicant if status changed
    IF NEW.status = 'approved' THEN
      INSERT INTO public.notifications (user_id, title, message, type, is_read)
      VALUES (
        NEW.applicant_id,
        'Candidature Approuvée ! 🎉',
        'Félicitations ! Votre candidature pour ' || NEW.business_name || ' a été approuvée par DLXSTORE.',
        'partner_application',
        false
      );
    ELSIF NEW.status = 'declined' THEN
      INSERT INTO public.notifications (user_id, title, message, type, is_read)
      VALUES (
        NEW.applicant_id,
        'Mise à Jour Candidature Partenaire 📋',
        'Votre candidature pour ' || NEW.business_name || ' a été examinée. Merci pour votre intérêt.',
        'partner_application',
        false
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trigger_notify_on_partner_application_insert ON public.partner_applications;
CREATE TRIGGER trigger_notify_on_partner_application_insert
  AFTER INSERT ON public.partner_applications
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_partner_application();

DROP TRIGGER IF EXISTS trigger_notify_on_partner_application_update ON public.partner_applications;
CREATE TRIGGER trigger_notify_on_partner_application_update
  AFTER UPDATE ON public.partner_applications
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_partner_application();
