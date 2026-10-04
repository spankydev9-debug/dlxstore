-- ============================================================================
-- Phase 13 (P13) — Communication & marketing
-- Roadmap Phase 19. One customer action -> the right message, on the right
-- channel, in the customer's language, exactly once.
--
-- What already existed and is reused, not rebuilt:
--   * `notifications` + realtime + NotificationContext (Phase 9) for in-app.
--   * `notification_preferences` (Phase 9) for the customer's channel switches.
--   * `campaigns` (Phase 11) with its channel and segment columns, which had
--     no send path at all. P13 adds that path instead of a competing table.
--   * `src/lib/whatsapp.ts` for the client-side wa.me deep links.
--
-- What P13 adds is the missing delivery spine:
--   * per-event, per-channel, per-locale message templates;
--   * a durable outbox with dedupe, retry and a delivery log;
--   * order-lifecycle triggers that enqueue without blocking the order write;
--   * a campaign fan-out that respects consent;
--   * a single admin-gated claim/complete protocol for the dispatcher.
--
-- Two rules drive the design:
--
--   1. Transactional messages are not optional. A cash-on-delivery customer in
--      Goma who never hears their parcel is out for delivery has lost a real
--      trip, so order confirmations and status updates are queued regardless of
--      marketing consent. Marketing messages require an explicit opt-in and are
--      recorded as `skipped`, never silently dropped.
--
--   2. Nothing is ever marked sent by the database. The database claims work and
--      records what the transport reported. A message becomes `sent` only after
--      a real provider accepted it, which is what makes the delivery rate in
--      `admin_message_stats` mean something.
-- ============================================================================

-- ============================================================================
-- 1. Customer language, so a message can match the customer's own language
-- ============================================================================
-- Language previously lived only in localStorage, which is invisible to a
-- server-side dispatcher. Default 'fr' matches the DRC business language.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_locale TEXT NOT NULL DEFAULT 'fr'
  CHECK (preferred_locale IN ('fr', 'en', 'sw', 'ln', 'tl', 'kg'));

CREATE OR REPLACE FUNCTION public.set_my_message_locale(p_locale TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_locale IS NULL OR p_locale NOT IN ('fr', 'en', 'sw', 'ln', 'tl', 'kg') THEN
    RAISE EXCEPTION 'Unsupported locale %', COALESCE(p_locale, 'null');
  END IF;

  UPDATE public.profiles
     SET preferred_locale = p_locale
   WHERE id = auth.uid();

  RETURN p_locale;
END;
$$;

-- ============================================================================
-- 2. Marketing consent, separate from transactional delivery
-- ============================================================================
-- `notification_preferences` (Phase 9) governs the in-app inbox and its channel
-- list is fixed. Outbound WhatsApp/email needs its own record because the
-- question is different: not "do you want to see this inbox" but "may we contact
-- you about offers". Marketing defaults to NOT granted.
CREATE TABLE IF NOT EXISTS public.message_opt_ins (
  profile_id        UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  whatsapp_marketing BOOLEAN NOT NULL DEFAULT FALSE,
  email_marketing   BOOLEAN NOT NULL DEFAULT FALSE,
  granted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.message_opt_ins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Customers read own marketing consent" ON public.message_opt_ins;
CREATE POLICY "Customers read own marketing consent"
  ON public.message_opt_ins FOR SELECT USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "Admins manage marketing consent" ON public.message_opt_ins;
CREATE POLICY "Admins manage marketing consent"
  ON public.message_opt_ins FOR ALL USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.get_my_message_opt_ins()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  RETURN jsonb_build_object(
    'locale', COALESCE(
      (SELECT preferred_locale FROM public.profiles WHERE id = v_uid), 'fr'),
    'whatsapp_marketing', COALESCE(
      (SELECT whatsapp_marketing FROM public.message_opt_ins WHERE profile_id = v_uid), FALSE),
    'email_marketing', COALESCE(
      (SELECT email_marketing FROM public.message_opt_ins WHERE profile_id = v_uid), FALSE)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_my_message_opt_in(
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
  v_channel TEXT := LOWER(COALESCE(p_channel, ''));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  IF v_channel NOT IN ('whatsapp', 'email') THEN
    RAISE EXCEPTION 'Unsupported marketing channel %', p_channel;
  END IF;

  INSERT INTO public.message_opt_ins AS o (profile_id, whatsapp_marketing, email_marketing, granted_at)
  VALUES (
    v_uid,
    CASE WHEN v_channel = 'whatsapp' THEN COALESCE(p_enabled, FALSE) ELSE FALSE END,
    CASE WHEN v_channel = 'email'    THEN COALESCE(p_enabled, FALSE) ELSE FALSE END,
    CASE WHEN COALESCE(p_enabled, FALSE) THEN timezone('utc', now()) ELSE NULL END
  )
  ON CONFLICT (profile_id) DO UPDATE SET
    whatsapp_marketing = CASE WHEN v_channel = 'whatsapp' THEN COALESCE(p_enabled, FALSE) ELSE o.whatsapp_marketing END,
    email_marketing    = CASE WHEN v_channel = 'email'    THEN COALESCE(p_enabled, FALSE) ELSE o.email_marketing    END,
    granted_at         = CASE WHEN COALESCE(p_enabled, FALSE) THEN timezone('utc', now()) ELSE NULL END,
    updated_at         = timezone('utc', now());

  RETURN public.get_my_message_opt_ins();
END;
$$;

-- ============================================================================
-- 3. Templates
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.message_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key  TEXT NOT NULL CHECK (template_key ~ '^[a-z0-9_]+\.[a-z0-9_]+$'),
  channel       TEXT NOT NULL CHECK (channel IN ('in_app', 'whatsapp', 'email')),
  locale        TEXT NOT NULL CHECK (locale IN ('fr', 'en', 'sw', 'ln', 'tl', 'kg')),
  subject       TEXT,
  body          TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (template_key, channel, locale)
);

ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;

-- Customers read templates only through the RPCs that render them; they get no
-- direct table access, and no insert path at all.
DROP POLICY IF EXISTS "Customers read active templates" ON public.message_templates;
CREATE POLICY "Customers read active templates"
  ON public.message_templates FOR SELECT USING (is_active = true);

DROP POLICY IF EXISTS "Admins manage templates" ON public.message_templates;
CREATE POLICY "Admins manage templates"
  ON public.message_templates FOR ALL USING (public.is_admin());

-- ============================================================================
-- 4. The outbox
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.message_outbox (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel            TEXT NOT NULL CHECK (channel IN ('in_app', 'whatsapp', 'email')),
  template_key       TEXT NOT NULL,
  locale             TEXT NOT NULL CHECK (locale IN ('fr', 'en', 'sw', 'ln', 'tl', 'kg')),
  recipient_id       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  recipient_address  TEXT,
  -- Transactional messages are part of the purchase contract and are sent
  -- regardless of marketing consent.
  is_transactional   BOOLEAN NOT NULL DEFAULT FALSE,
  payload            JSONB NOT NULL DEFAULT '{}'::JSONB,
  subject            TEXT,
  body               TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  skip_reason        TEXT,
  attempts           INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts       INTEGER NOT NULL DEFAULT 4 CHECK (max_attempts > 0),
  next_attempt_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  last_error         TEXT,
  provider           TEXT,
  provider_message_id TEXT,
  dedupe_key         TEXT NOT NULL UNIQUE,
  related_type       TEXT,
  related_id         UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  claimed_at         TIMESTAMPTZ,
  sent_at            TIMESTAMPTZ
);

ALTER TABLE public.message_outbox ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_message_outbox_pending
  ON public.message_outbox (next_attempt_at, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_message_outbox_recipient
  ON public.message_outbox (recipient_id, created_at DESC);

DROP POLICY IF EXISTS "Customers read own outbox rows" ON public.message_outbox;
CREATE POLICY "Customers read own outbox rows"
  ON public.message_outbox FOR SELECT USING (recipient_id = auth.uid());

DROP POLICY IF EXISTS "Admins read outbox" ON public.message_outbox;
CREATE POLICY "Admins read outbox"
  ON public.message_outbox FOR SELECT USING (public.is_admin());

-- No browser INSERT/UPDATE policy on the outbox at all: rows are written only by
-- the SECURITY DEFINER enqueue and claim functions, and only the admin claim
-- protocol changes `status`.

-- ============================================================================
-- 5. Template rendering
-- ============================================================================
-- Unknown tokens are left visible as {{token}} rather than blanked, so a
-- half-populated template is obvious in the outbox instead of quietly sending
-- an empty placeholder to a customer.
CREATE OR REPLACE FUNCTION public.render_message_body(
  p_body TEXT,
  p_payload JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_text TEXT := COALESCE(p_body, '');
  v_key  TEXT;
  v_val  TEXT;
BEGIN
  -- regexp_matches returns one array element per CAPTURE group (not the whole
  -- match), so element 1 is the token name. The previous draft split the body on
  -- '{{' before matching, which consumed the very delimiter it then searched for
  -- and silently substituted nothing.
  -- Conditional blocks {{#token}}...{{/token}} are resolved first. They let an
  -- optional clause (such as a coupon code) disappear entirely instead of
  -- leaking a raw placeholder to the customer. Single level only: no nesting.
  FOR v_key IN
    SELECT DISTINCT (regexp_matches(v_text, '\{\{#([a-z0-9_]+)\}\}', 'g'))[1]
  LOOP
    v_val := btrim(COALESCE(p_payload ->> v_key, ''));
    IF v_val = '' THEN
      v_text := regexp_replace(
        v_text, '\{\{#' || v_key || '\}\}[\s\S]*?\{\{/' || v_key || '\}\}', '', 'g');
    ELSE
      v_text := regexp_replace(
        v_text, '\{\{#' || v_key || '\}\}([\s\S]*?)\{\{/' || v_key || '\}\}', '\1', 'g');
    END IF;
  END LOOP;

  -- Then plain value substitution. An unresolved token is left verbatim rather
  -- than blanked, so a missing payload is visible instead of silently lossy.
  FOR v_key IN
    SELECT DISTINCT (regexp_matches(v_text, '\{\{([a-z0-9_]+)\}\}', 'g'))[1]
  LOOP
    v_val := p_payload ->> v_key;
    v_text := replace(v_text, '{{' || v_key || '}}', COALESCE(v_val, '{{' || v_key || '}}'));
  END LOOP;

  RETURN v_text;
END;
$$;

-- ============================================================================
-- 6. Enqueue
-- ============================================================================
-- Resolves the template for (key, channel, locale) with an explicit fallback
-- chain: requested locale -> fr -> any active row for that key/channel. Returns
-- NULL when no template exists, and the caller records a skip rather than
-- sending an empty message.
CREATE OR REPLACE FUNCTION public.resolve_message_template(
  p_template_key TEXT,
  p_channel      TEXT,
  p_locale       TEXT
)
RETURNS public.message_templates
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_locale   TEXT := COALESCE(p_locale, 'fr');
  v_template public.message_templates;
BEGIN
  -- Sequential resolution rather than `SELECT * ... OR ...`: OR does not compose
  -- multi-column rows, so that form raised "subquery must return only one column".
  SELECT * INTO v_template FROM public.message_templates
   WHERE template_key = p_template_key AND channel = p_channel
     AND locale = v_locale AND is_active;
  IF v_template.id IS NOT NULL THEN
    RETURN v_template;
  END IF;

  SELECT * INTO v_template FROM public.message_templates
   WHERE template_key = p_template_key AND channel = p_channel
     AND locale = 'fr' AND is_active;
  IF v_template.id IS NOT NULL THEN
    RETURN v_template;
  END IF;

  SELECT * INTO v_template FROM public.message_templates
   WHERE template_key = p_template_key AND channel = p_channel AND is_active
   ORDER BY locale LIMIT 1;
  IF v_template.id IS NOT NULL THEN
    RETURN v_template;
  END IF;

  RETURN NULL;
END;
$$;

-- The single write path into the outbox. `dedupe_key` is what makes "exactly
-- once" true: an order status that flaps between two values, or a trigger that
-- fires twice, collides on this key and inserts nothing.
-- Core enqueue. Deliberately performs NO caller-identity check: it is reached
-- only from SECURITY DEFINER triggers, where `auth.uid()` is the purchasing
-- customer or an admin and is not necessarily the message recipient.
CREATE OR REPLACE FUNCTION public.enqueue_message_core(
  p_template_key   TEXT,
  p_channel        TEXT,
  p_recipient_id   UUID DEFAULT NULL,
  p_recipient_address TEXT DEFAULT NULL,
  p_payload        JSONB DEFAULT '{}'::JSONB,
  p_locale         TEXT DEFAULT NULL,
  p_is_transactional BOOLEAN DEFAULT TRUE,
  p_dedupe_key     TEXT DEFAULT NULL,
  p_related_type   TEXT DEFAULT NULL,
  p_related_id     UUID DEFAULT NULL,
  p_max_attempts   INTEGER DEFAULT 4
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_template public.message_templates;
  v_locale   TEXT;
  v_body     TEXT;
  v_subject  TEXT;
  v_key      TEXT;
  v_marketing BOOLEAN;
  v_row_id   UUID;
  v_address  TEXT := p_recipient_address;
BEGIN
  v_locale := COALESCE(p_locale,
    (SELECT preferred_locale FROM public.profiles WHERE id = p_recipient_id), 'fr');

  -- Destination is resolved server side. queue_message deliberately blanks a
  -- non-admin caller's address, so without this step an authenticated customer
  -- asking for a message would queue a row that can never be delivered.
  IF v_address IS NULL AND p_recipient_id IS NOT NULL AND p_channel <> 'in_app' THEN
    SELECT phone INTO v_address FROM public.profiles WHERE id = p_recipient_id;
  END IF;

  -- An external channel with nowhere to send is recorded as skipped so the admin
  -- can see the gap, instead of sitting pending forever in the outbox.
  IF p_channel <> 'in_app' AND NULLIF(BTRIM(COALESCE(v_address, '')), '') IS NULL THEN
    INSERT INTO public.message_outbox (
      channel, template_key, locale, recipient_id, recipient_address,
      is_transactional, payload, body, status, skip_reason, dedupe_key,
      related_type, related_id
    ) VALUES (
      p_channel, p_template_key, v_locale, p_recipient_id, NULL,
      COALESCE(p_is_transactional, TRUE), COALESCE(p_payload, '{}'::JSONB),
      '(not rendered: no destination address)', 'skipped', 'no_destination_address',
      COALESCE(p_dedupe_key,
        p_template_key || '|' || p_channel || '|' || COALESCE(p_recipient_id::TEXT, 'none') || '|skipped'),
      p_related_type, p_related_id
    )
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id INTO v_row_id;
    RETURN v_row_id;
  END IF;

  v_template := public.resolve_message_template(p_template_key, p_channel, v_locale);
  IF v_template.id IS NULL THEN
    RAISE EXCEPTION 'No active template for % on % in %', p_template_key, p_channel, v_locale;
  END IF;

  -- Marketing consent. Absent consent is recorded as a skipped row, not dropped,
  -- so the admin can see the segment size they would actually have reached.
  IF NOT COALESCE(p_is_transactional, TRUE) THEN
    SELECT
      CASE WHEN p_channel = 'whatsapp' THEN o.whatsapp_marketing
           WHEN p_channel = 'email'    THEN o.email_marketing
           ELSE FALSE END
    INTO v_marketing
    FROM public.profiles p
    LEFT JOIN public.message_opt_ins o ON o.profile_id = p.id
    WHERE p.id = p_recipient_id;

    IF NOT COALESCE(v_marketing, FALSE) THEN
      INSERT INTO public.message_outbox (
        channel, template_key, locale, recipient_id, recipient_address,
        is_transactional, payload, body, status, skip_reason, dedupe_key,
        related_type, related_id
      ) VALUES (
        p_channel, p_template_key, v_locale, p_recipient_id, v_address,
        FALSE, COALESCE(p_payload, '{}'::JSONB), '(not rendered: no marketing consent)',
        'skipped', 'no_marketing_consent',
        COALESCE(p_dedupe_key,
          p_template_key || '|' || p_channel || '|' || COALESCE(p_recipient_id::TEXT, 'none') || '|skipped'),
        p_related_type, p_related_id
      )
      ON CONFLICT (dedupe_key) DO NOTHING
      RETURNING id INTO v_row_id;
      RETURN v_row_id;
    END IF;
  END IF;

  v_body := public.render_message_body(v_template.body, COALESCE(p_payload, '{}'::JSONB));
  v_subject := CASE
    WHEN v_template.subject IS NULL THEN NULL
    ELSE public.render_message_body(v_template.subject, COALESCE(p_payload, '{}'::JSONB))
  END;

  v_key := COALESCE(p_dedupe_key,
    p_template_key || '|' || p_channel || '|' || COALESCE(p_recipient_id::TEXT, 'none'));

  INSERT INTO public.message_outbox (
    channel, template_key, locale, recipient_id, recipient_address,
    is_transactional, payload, subject, body, dedupe_key,
    related_type, related_id, max_attempts
  ) VALUES (
    p_channel, p_template_key, v_locale, p_recipient_id, v_address,
    COALESCE(p_is_transactional, TRUE), COALESCE(p_payload, '{}'::JSONB), v_subject, v_body,
    v_key, p_related_type, p_related_id,
    LEAST(GREATEST(COALESCE(p_max_attempts, 4), 1), 10)
  )
  ON CONFLICT (dedupe_key) DO NOTHING
  RETURNING id INTO v_row_id;

  RETURN v_row_id;
END;
$$;

-- Public, caller-checked entry point. An admin may enqueue on someone's behalf;
-- nobody else may.
CREATE OR REPLACE FUNCTION public.queue_message(
  p_template_key   TEXT,
  p_channel        TEXT,
  p_recipient_id   UUID DEFAULT NULL,
  p_recipient_address TEXT DEFAULT NULL,
  p_payload        JSONB DEFAULT '{}'::JSONB,
  p_locale         TEXT DEFAULT NULL,
  p_is_transactional BOOLEAN DEFAULT TRUE,
  p_dedupe_key     TEXT DEFAULT NULL,
  p_related_type   TEXT DEFAULT NULL,
  p_related_id     UUID DEFAULT NULL,
  p_max_attempts   INTEGER DEFAULT 4
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipient UUID := COALESCE(p_recipient_id, auth.uid());
  v_address   TEXT := p_recipient_address;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF v_recipient IS DISTINCT FROM auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- A caller may only ever queue to their own record. Without this, any
  -- authenticated user could pass an arbitrary phone number or e-mail with
  -- recipient_id = their own id, satisfy the recipient check above, and have the
  -- dispatcher later deliver a message to that third party. For a non-admin the
  -- address is therefore resolved server side and never taken from the caller.
  IF NOT public.is_admin() AND p_channel <> 'in_app' THEN
    v_address := NULL;
  END IF;

  RETURN public.enqueue_message_core(
    p_template_key, p_channel, v_recipient, v_address, p_payload,
    p_locale, p_is_transactional, p_dedupe_key, p_related_type, p_related_id,
    p_max_attempts
  );
END;
$$;

-- Trigger-only wrapper. Not granted to any role: only the SECURITY DEFINER order
-- triggers call it, so a customer can never reach the enqueue path through a
-- guest checkout where auth.uid() is null.
CREATE OR REPLACE FUNCTION public.queue_message_from_trigger(
  p_template_key   TEXT,
  p_channel        TEXT,
  p_recipient_id   UUID DEFAULT NULL,
  p_recipient_address TEXT DEFAULT NULL,
  p_payload        JSONB DEFAULT '{}'::JSONB,
  p_locale         TEXT DEFAULT NULL,
  p_dedupe_key     TEXT DEFAULT NULL,
  p_related_type   TEXT DEFAULT NULL,
  p_related_id     UUID DEFAULT NULL,
  p_max_attempts   INTEGER DEFAULT 4
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.enqueue_message_core(
    p_template_key, p_channel, p_recipient_id, p_recipient_address, p_payload,
    p_locale, TRUE, p_dedupe_key, p_related_type, p_related_id, p_max_attempts
  );
END;
$$;

-- ============================================================================
-- 7. In-app delivery: the outbox row becomes a real notification
-- ============================================================================
-- The outbox is the transport-independent record; `notifications` is what the
-- customer actually sees. An in-app message is only promoted once the row has
-- been claimed, so a failed render never shows up in the inbox.
CREATE OR REPLACE FUNCTION public.deliver_in_app_message(p_outbox_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row    public.message_outbox;
  v_notif  UUID;
BEGIN
  -- Without this, any authenticated customer could point this at another
  -- customer's outbox row and write into their notification inbox.
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT * INTO v_row
    FROM public.message_outbox
   WHERE id = p_outbox_id AND channel = 'in_app'
   FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Outbox row % not found for in-app delivery', p_outbox_id;
  END IF;
  IF v_row.recipient_id IS NULL THEN
    RAISE EXCEPTION 'Outbox row % has no recipient', p_outbox_id;
  END IF;
  -- Only an unreached notification is ever created, so re-running a batch cannot
  -- duplicate an inbox entry.
  IF v_row.status = 'sent' THEN
    RETURN NULL;
  END IF;

  -- P9 already writes order notifications (trigger_notify_on_new_order and
  -- trigger_notify_on_order_status_change). Promoting the P13 order messages as
  -- well gave every customer two inbox entries per order event, so an existing
  -- notification for the same order is adopted instead of duplicated.
  IF v_row.template_key LIKE 'order.%' AND v_row.related_id IS NOT NULL THEN
    SELECT id INTO v_notif
      FROM public.notifications
     WHERE user_id = v_row.recipient_id
       AND entity_id = v_row.related_id
     ORDER BY created_at, id
     LIMIT 1;
  END IF;

  IF v_notif IS NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, actor_id, entity_type, entity_id, data)
    VALUES (
      v_row.recipient_id,
      COALESCE(v_row.subject, v_row.template_key),
      v_row.body,
      COALESCE(NULLIF(v_row.related_type, ''), 'system'),
      NULL,
      v_row.related_type,
      v_row.related_id,
      COALESCE(v_row.payload, '{}'::JSONB) || jsonb_build_object('template_key', v_row.template_key)
    )
    RETURNING id INTO v_notif;
  END IF;

  UPDATE public.message_outbox
     SET status = 'sent',
         sent_at = timezone('utc', now()),
         provider = 'notifications',
         provider_message_id = v_notif::TEXT
   WHERE id = v_row.id;

  RETURN v_notif;
END;
$$;

-- ============================================================================
-- 8. Order lifecycle -> messages
-- ============================================================================
-- Both triggers are AFTER triggers and never touch the order row, so a message
-- problem can never fail or roll back a customer's purchase.
CREATE OR REPLACE FUNCTION public.queue_order_confirmation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_locale TEXT;
  v_payload JSONB;
  v_ref    TEXT;
BEGIN
  SELECT COALESCE(preferred_locale, 'fr') INTO v_locale
    FROM public.profiles WHERE id = NEW.customer_id;

  v_ref := 'D-' || upper(left(NEW.id::TEXT, 8));

  v_payload := jsonb_build_object(
    'customer_name', NEW.customer_name,
    'order_ref', v_ref,
    'total', NEW.total_amount,
    'municipality', NEW.municipality,
    'status', NEW.status,
    'store_name', 'DLXSTORE'
  );

  -- in-app first: it is the channel DLXSTORE fully controls.
  IF NEW.customer_id IS NOT NULL THEN
    PERFORM public.queue_message_from_trigger(
      'order.confirmation', 'in_app', NEW.customer_id, NULL, v_payload,
      v_locale, 'order.confirmation|in_app|' || NEW.id::TEXT, 'order', NEW.id, 3
    );
  END IF;

  -- WhatsApp is queued with the customer's own phone number from the order.
  PERFORM public.queue_message_from_trigger(
    'order.confirmation', 'whatsapp', NEW.customer_id, NEW.phone_number, v_payload,
    v_locale, 'order.confirmation|whatsapp|' || NEW.id::TEXT, 'order', NEW.id, 4
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_confirmation_message ON public.orders;
CREATE TRIGGER trg_order_confirmation_message
  AFTER INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.queue_order_confirmation();

CREATE OR REPLACE FUNCTION public.queue_order_status_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_locale  TEXT;
  v_payload JSONB;
  v_ref     TEXT;
  v_key     TEXT;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(preferred_locale, 'fr') INTO v_locale
    FROM public.profiles WHERE id = NEW.customer_id;

  v_ref := 'D-' || upper(left(NEW.id::TEXT, 8));

  v_payload := jsonb_build_object(
    'customer_name', NEW.customer_name,
    'order_ref', v_ref,
    'total', NEW.total_amount,
    'municipality', NEW.municipality,
    'status', NEW.status,
    'previous_status', OLD.status,
    'store_name', 'DLXSTORE'
  );

  -- Keyed on the status value, so a customer who moves pending -> confirmed ->
  -- out_for_delivery gets one message per real change and none for a no-op
  -- re-save of the same status.
  v_key := 'order.status_update|' || NEW.id::TEXT || '|' || NEW.status;

  IF NEW.customer_id IS NOT NULL THEN
    PERFORM public.queue_message_from_trigger(
      'order.status_update', 'in_app', NEW.customer_id, NULL, v_payload,
      v_locale, v_key || '|in_app', 'order', NEW.id, 3
    );
  END IF;

  PERFORM public.queue_message_from_trigger(
    'order.status_update', 'whatsapp', NEW.customer_id, NEW.phone_number, v_payload,
    v_locale, v_key || '|whatsapp', 'order', NEW.id, 4
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_status_message ON public.orders;
CREATE TRIGGER trg_order_status_message
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.queue_order_status_update();

-- ============================================================================
-- 9. Dispatcher protocol
-- ============================================================================
-- Claim, send, record. The claim is atomic (`FOR UPDATE SKIP LOCKED`) so two
-- concurrent dispatchers can never take the same row, and a crashed dispatcher
-- releases its rows after `claimed_at` staleness rather than stranding them.
CREATE OR REPLACE FUNCTION public.admin_claim_outbox(
  p_limit INTEGER DEFAULT 25,
  p_channel TEXT DEFAULT NULL
)
RETURNS SETOF public.message_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 200);
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  WITH claimable AS (
    SELECT id
      FROM public.message_outbox
     WHERE status = 'pending'
       AND next_attempt_at <= timezone('utc', now())
       AND (p_channel IS NULL OR channel = p_channel)
     ORDER BY next_attempt_at, created_at
     LIMIT v_limit
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.message_outbox o
     SET status = 'sending',
         attempts = o.attempts + 1,
         claimed_at = timezone('utc', now())
    FROM claimable c
   WHERE o.id = c.id
  RETURNING o.*;
END;
$$;

-- The transport reports the outcome; the database records it. Exponential
-- backoff capped at 1 hour, and a row that exhausts its attempts is `failed`
-- rather than retried forever.
CREATE OR REPLACE FUNCTION public.admin_record_outbox_result(
  p_outbox_id UUID,
  p_success BOOLEAN,
  p_provider TEXT DEFAULT NULL,
  p_provider_message_id TEXT DEFAULT NULL,
  p_error TEXT DEFAULT NULL,
  p_permanent_failure BOOLEAN DEFAULT FALSE
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.message_outbox;
  v_status TEXT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT * INTO v_row
    FROM public.message_outbox
   WHERE id = p_outbox_id
   FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Outbox row % not found', p_outbox_id;
  END IF;

  IF COALESCE(p_success, FALSE) THEN
    UPDATE public.message_outbox
       SET status = 'sent',
           sent_at = timezone('utc', now()),
           provider = COALESCE(p_provider, provider),
           provider_message_id = COALESCE(p_provider_message_id, provider_message_id),
           last_error = NULL
     WHERE id = v_row.id;
    RETURN 'sent';
  END IF;

  IF COALESCE(p_permanent_failure, FALSE) OR v_row.attempts >= v_row.max_attempts THEN
    v_status := 'failed';
  ELSE
    v_status := 'pending';
  END IF;

  UPDATE public.message_outbox
     SET status = v_status,
         last_error = LEFT(COALESCE(p_error, 'unknown error'), 500),
         next_attempt_at = timezone('utc', now())
           + make_interval(secs => LEAST(3600, 30 * power(2, v_row.attempts)::INT)),
         claimed_at = NULL
   WHERE id = v_row.id;

  RETURN v_status;
END;
$$;

-- Recover rows abandoned by a dispatcher that died mid-batch.
CREATE OR REPLACE FUNCTION public.admin_release_stale_outbox(p_older_than_minutes INTEGER DEFAULT 15)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_released INTEGER;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  UPDATE public.message_outbox
     SET status = 'pending',
         claimed_at = NULL,
         last_error = COALESCE(last_error, 'released: dispatcher went away')
   WHERE status = 'sending'
     AND claimed_at < timezone('utc', now()) - make_interval(mins => LEAST(GREATEST(COALESCE(p_older_than_minutes, 15), 1), 1440));

  GET DIAGNOSTICS v_released = ROW_COUNT;
  RETURN v_released;
END;
$$;

-- ============================================================================
-- 10. Campaign fan-out
-- ============================================================================
-- P11 shipped `campaigns` with channel and segment columns but nothing could
-- send them. This is that missing path, and it reuses the P11 segments rather
-- than inventing a second segmentation vocabulary.
CREATE OR REPLACE FUNCTION public.admin_send_campaign(
  p_campaign_id UUID,
  p_dry_run BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign public.campaigns;
  v_template  TEXT;
  v_queued    INTEGER := 0;
  v_skipped   INTEGER := 0;
  v_target    UUID;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT * INTO v_campaign FROM public.campaigns WHERE id = p_campaign_id;
  IF v_campaign.id IS NULL THEN
    RAISE EXCEPTION 'Campaign % not found', p_campaign_id;
  END IF;
  IF NOT v_campaign.is_active THEN
    RAISE EXCEPTION 'Campaign % is not active', p_campaign_id;
  END IF;
  IF timezone('utc', now()) < v_campaign.starts_at OR timezone('utc', now()) > v_campaign.ends_at THEN
    RAISE EXCEPTION 'Campaign % is outside its scheduled window', p_campaign_id;
  END IF;

  v_template := 'campaign.' || v_campaign.channel;
  -- Locale stays NULL on purpose: enqueue_message_core then resolves the
  -- recipient's own preferred_locale (falling back fr, then any locale, inside
  -- resolve_message_template). Hardcoding 'fr' here sent every campaign in
  -- French regardless of the customer's language setting.

  FOR v_target IN
    SELECT p.id
      FROM public.profiles p
    LEFT JOIN public.customer_points cp ON cp.profile_id = p.id
     WHERE p.role = 'customer'
       AND p.created_at <= timezone('utc', now())
       AND (
         v_campaign.segment = 'all'
         -- Segment membership reuses the P11 tier and order history so a campaign
         -- can never disagree with what the loyalty engine calls a VIP.
         -- `customer_points.tier_code` is the P11 authority: it is written by
         -- rebuild_points_balance() from the ledger, so a campaign segment can
         -- never disagree with what the loyalty engine calls a VIP.
         OR (v_campaign.segment = 'vip'
             AND cp.tier_code IN ('gold', 'vip'))
         OR (v_campaign.segment = 'gold'
             AND cp.tier_code = 'gold')
         OR (v_campaign.segment = 'new'
             AND p.created_at > timezone('utc', now()) - INTERVAL '30 days')
         OR (v_campaign.segment = 'inactive'
             AND NOT EXISTS (
               SELECT 1 FROM public.orders o
                WHERE o.customer_id = p.id AND o.created_at > timezone('utc', now()) - INTERVAL '60 days'
             ))
         -- birthday_month/day are SMALLINTs (P11 deliberately stores no birth
         -- year), so they are compared numerically rather than with EXTRACT on
         -- a fake date.
         OR (v_campaign.segment = 'birthday'
             AND p.birthday_month = EXTRACT(MONTH FROM timezone('utc', now()))::SMALLINT
             AND p.birthday_day = EXTRACT(DAY FROM timezone('utc', now()))::SMALLINT)
       )
  LOOP
    BEGIN
      IF NOT COALESCE(p_dry_run, TRUE) THEN
        PERFORM public.queue_message(
          v_template,
          v_campaign.channel,
          v_target,
          NULL,
          jsonb_build_object(
            'campaign_name', v_campaign.name,
            'discount_percent', v_campaign.discount_percent,
            'coupon_code', v_campaign.coupon_code,
            'store_name', 'DLXSTORE'
          ),
          NULL,   -- resolve per recipient
          FALSE,  -- marketing: consent required
          'campaign|' || v_campaign.id::TEXT || '|' || v_target::TEXT,
          'campaign', v_campaign.id,
          3
        );
      END IF;
      v_queued := v_queued + 1;
    EXCEPTION WHEN OTHERS THEN
      -- One unsubscribable or unrenderable recipient must not abort the send.
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'campaign', v_campaign.name,
    'channel', v_campaign.channel,
    'segment', v_campaign.segment,
    'template', v_template,
    'matched', v_queued,
    'skipped', v_skipped,
    'dry_run', COALESCE(p_dry_run, TRUE)
  );
END;
$$;

-- ============================================================================
-- 11. Admin reporting
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_get_outbox(
  p_status TEXT DEFAULT NULL,
  p_channel TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 50
)
RETURNS SETOF public.message_outbox
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
    FROM public.message_outbox
   WHERE (p_status IS NULL OR status = p_status)
     AND (p_channel IS NULL OR channel = p_channel)
   ORDER BY created_at DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500);
$$;

CREATE OR REPLACE FUNCTION public.admin_message_stats()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_by_status JSONB;
  v_by_channel JSONB;
  v_total BIGINT;
  v_sent BIGINT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT count(*), count(*) FILTER (WHERE status = 'sent')
    INTO v_total, v_sent
    FROM public.message_outbox;

  SELECT COALESCE(jsonb_object_agg(status, n), '{}'::JSONB)
    INTO v_by_status
    FROM (SELECT status, count(*) AS n FROM public.message_outbox GROUP BY status) s;

  SELECT COALESCE(jsonb_object_agg(channel, n), '{}'::JSONB)
    INTO v_by_channel
    FROM (SELECT channel, count(*) AS n FROM public.message_outbox GROUP BY channel) c;

  -- A delivery rate over "everything ever queued" would be dominated by rows
  -- still pending, so it is reported over finished rows only.
  RETURN jsonb_build_object(
    'total', v_total,
    'sent', v_sent,
    'finished', COALESCE(
      (SELECT count(*) FROM public.message_outbox WHERE status IN ('sent', 'failed')), 0),
    'delivery_rate', CASE
      WHEN COALESCE((SELECT count(*) FROM public.message_outbox WHERE status IN ('sent', 'failed')), 0) > 0
      THEN ROUND(v_sent::NUMERIC * 100 / (SELECT count(*) FROM public.message_outbox WHERE status IN ('sent', 'failed')), 1)
      ELSE NULL END,
    'skipped_no_consent', COALESCE(
      (SELECT count(*) FROM public.message_outbox WHERE status = 'skipped'), 0),
    'by_status', v_by_status,
    'by_channel', v_by_channel
  );
END;
$$;

-- Marketing reach preview. Reports what consent actually allows, so an admin can
-- see "1,200 matched, 300 reachable" instead of assuming the segment size is the
-- audience.
CREATE OR REPLACE FUNCTION public.admin_marketing_audience(p_channel TEXT DEFAULT 'whatsapp')
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_channel TEXT := COALESCE(p_channel, 'whatsapp');
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  IF v_channel NOT IN ('whatsapp', 'email') THEN
    RAISE EXCEPTION 'Unsupported marketing channel %', p_channel;
  END IF;

  RETURN jsonb_build_object(
    'channel', v_channel,
    'customers', (SELECT count(*) FROM public.profiles WHERE role = 'customer'),
    'opted_in', (
      SELECT count(*) FROM public.profiles p
        JOIN public.message_opt_ins o ON o.profile_id = p.id
       WHERE p.role = 'customer'
         AND CASE WHEN v_channel = 'whatsapp' THEN o.whatsapp_marketing ELSE o.email_marketing END
    )
  );
END;
$$;

-- Test send for an operator who needs to prove the transport works before a
-- campaign. Never touches a real customer list.
CREATE OR REPLACE FUNCTION public.admin_enqueue_test_message(
  p_channel TEXT,
  p_address TEXT,
  p_template_key TEXT DEFAULT 'campaign.whatsapp'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN public.queue_message(
    p_template_key,
    p_channel,
    NULL,
    p_address,
    jsonb_build_object(
      'campaign_name', 'Test',
      'discount_percent', 10,
      'coupon_code', 'TEST10',
      'store_name', 'DLXSTORE'
    ),
    'fr',
    TRUE,  -- a test message is an operational check, not a promotion
    'test|' || p_channel || '|' || COALESCE(p_address, 'none') || '|' || timezone('utc', now())::TEXT,
    'test', NULL,
    1
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_message_template(
  p_template_key TEXT,
  p_channel TEXT,
  p_locale TEXT,
  p_subject TEXT,
  p_body TEXT,
  p_is_active BOOLEAN DEFAULT TRUE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  IF p_locale NOT IN ('fr', 'en', 'sw', 'ln', 'tl', 'kg') THEN
    RAISE EXCEPTION 'Unsupported locale %', p_locale;
  END IF;
  IF p_body IS NULL OR btrim(p_body) = '' THEN
    RAISE EXCEPTION 'Template body cannot be empty';
  END IF;

  INSERT INTO public.message_templates (template_key, channel, locale, subject, body, is_active)
  VALUES (p_template_key, p_channel, p_locale, p_subject, p_body, COALESCE(p_is_active, TRUE))
  ON CONFLICT (template_key, channel, locale) DO UPDATE SET
    subject = EXCLUDED.subject,
    body = EXCLUDED.body,
    is_active = EXCLUDED.is_active,
    updated_at = timezone('utc', now())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ============================================================================
-- 12. Seed templates: order lifecycle, both channels, all six locales
-- ============================================================================
-- French is the fallback locale, so it is inserted first and is the row that
-- resolves when a customer's language has no translation yet.
INSERT INTO public.message_templates (template_key, channel, locale, subject, body)
VALUES
  ('order.confirmation', 'in_app', 'fr', 'Commande {{order_ref}} confirmée',
   'Bonjour {{customer_name}}, votre commande {{order_ref}} de {{total}} $ est confirmée. Municipality: {{municipality}}. Merci de rester joignable pour la livraison.'),
  ('order.confirmation', 'in_app', 'en', 'Order {{order_ref}} confirmed',
   'Hi {{customer_name}}, your order {{order_ref}} for {{total}} $ is confirmed. Municipality: {{municipality}}. Please stay reachable for delivery.'),
  ('order.confirmation', 'in_app', 'sw', 'Amri {{order_ref}} imethibitishwa',
   'Habibi {{customer_name}}, amri yako {{order_ref}} ya {{total}} $ imethibitishwa. Mji: {{municipality}}. Tafadhali kaa Available kwa usambaza.'),
  ('order.confirmation', 'in_app', 'ln', 'Bobili {{order_ref}} ekosalamisi',
   'Mbote {{customer_name}}, bobili yo {{order_ref}} ya {{total}} $ ekosalamisi. Mofilingi: {{municipality}}. Sala kofika na bomoko pona kondima.'),
  ('order.confirmation', 'in_app', 'tl', 'Kinumpa ang order na {{order_ref}}',
   'Kumusta {{customer_name}}, kinumpa ang iyong order na {{order_ref}} na {{total}} $. Munisipyo: {{municipality}}. Pakikinig nang maaabot ang delivery.'),
  ('order.confirmation', 'in_app', 'kg', 'Bobili {{order_ref}} esalimisi',
   'Mbote {{customer_name}}, bobili yo {{order_ref}} ya {{total}} $ esalimisi. Mofilingi: {{municipality}}. Sala mawa koyoka na moboba pona koboya.'),

  ('order.status_update', 'in_app', 'fr', 'Commande {{order_ref}} : {{status}}',
   'Bonjour {{customer_name}}, votre commande {{order_ref}} est maintenant : {{status}}. Municipality: {{municipality}}.'),
  ('order.status_update', 'in_app', 'en', 'Order {{order_ref}}: {{status}}',
   'Hi {{customer_name}}, your order {{order_ref}} is now: {{status}}. Municipality: {{municipality}}.'),
  ('order.status_update', 'in_app', 'sw', 'Amri {{order_ref}}: {{status}}',
   'Habibi {{customer_name}}, amri yako {{order_ref}} sasa ni: {{status}}. Mji: {{municipality}}.'),
  ('order.status_update', 'in_app', 'ln', 'Bobili {{order_ref}}: {{status}}',
   'Mbote {{customer_name}}, bobili yo {{order_ref}} esala: {{status}}. Mofilingi: {{municipality}}.'),
  ('order.status_update', 'in_app', 'tl', 'Order {{order_ref}}: {{status}}',
   'Kumusta {{customer_name}}, ang order na {{order_ref}} ay: {{status}}. Munisipyo: {{municipality}}.'),
  ('order.status_update', 'in_app', 'kg', 'Bobili {{order_ref}}: {{status}}',
   'Mbote {{customer_name}}, bobili yo {{order_ref}} ekoko: {{status}}. Mofilingi: {{municipality}}.'),

  ('order.confirmation', 'whatsapp', 'fr', NULL,
   'Bonjour {{customer_name}} ! DLXSTORE a confirme votre commande {{order_ref}} ({{total}} $) pour {{municipality}}. Nous vous contactons pour la livraison.'),
  ('order.confirmation', 'whatsapp', 'en', NULL,
   'Hi {{customer_name}}! DLXSTORE has confirmed your order {{order_ref}} ({{total}} $) for {{municipality}}. We will contact you for delivery.'),
  ('order.confirmation', 'whatsapp', 'sw', NULL,
   'Habibi {{customer_name}}! DLXSTORE imethibitisha amri yako {{order_ref}} ({{total}} $) kwa {{municipality}}. Tutakupigia simu kwa usambaza.'),
  ('order.confirmation', 'whatsapp', 'ln', NULL,
   'Mbote {{customer_name}}! DLXSTORE ekosalamisi bobili yo {{order_ref}} ({{total}} $) pona {{municipality}}. Tokopesola yo pona kondima.'),
  ('order.confirmation', 'whatsapp', 'tl', NULL,
   'Kumusta {{customer_name}}! Kinumpa na ng DLXSTORE ang order na {{order_ref}} ({{total}} $) para sa {{municipality}}. Makikipag-ugnayan kami para sa delivery.'),
  ('order.confirmation', 'whatsapp', 'kg', NULL,
   'Mbote {{customer_name}}! DLXSTORE esalimisi bobili yo {{order_ref}} ({{total}} $) pona {{municipality}}. Tokopesekela yo pona koboya.'),

  ('order.status_update', 'whatsapp', 'fr', NULL,
   'Bonjour {{customer_name}} ! Votre commande {{order_ref}} est maintenant : {{status}}.'),
  ('order.status_update', 'whatsapp', 'en', NULL,
   'Hi {{customer_name}}! Your order {{order_ref}} is now: {{status}}.'),
  ('order.status_update', 'whatsapp', 'sw', NULL,
   'Habibi {{customer_name}}! Amri yako {{order_ref}} sasa ni: {{status}}.'),
  ('order.status_update', 'whatsapp', 'ln', NULL,
   'Mbote {{customer_name}}! Bobili yo {{order_ref}} esala: {{status}}.'),
  ('order.status_update', 'whatsapp', 'tl', NULL,
   'Kumusta {{customer_name}}! Ang order na {{order_ref}} ay: {{status}}.'),
  ('order.status_update', 'whatsapp', 'kg', NULL,
   'Mbote {{customer_name}}! Bobili yo {{order_ref}} ekoko: {{status}}.'),

  ('campaign.whatsapp', 'whatsapp', 'fr', NULL,
   'DLXSTORE : {{campaign_name}} - {{discount_percent}} % sur votre prochaine commande.{{#coupon_code}} Code : {{coupon_code}}.{{/coupon_code}}'),
  ('campaign.whatsapp', 'whatsapp', 'en', NULL,
   'DLXSTORE: {{campaign_name}} - {{discount_percent}}% off your next order.{{#coupon_code}} Code: {{coupon_code}}.{{/coupon_code}}'),
  ('campaign.whatsapp', 'whatsapp', 'sw', NULL,
   'DLXSTORE: {{campaign_name}} - punguzo ya {{discount_percent}}% kwa agizo lako lijalo.{{#coupon_code}} Msimbo: {{coupon_code}}.{{/coupon_code}}'),
  ('campaign.whatsapp', 'whatsapp', 'ln', NULL,
   'DLXSTORE: {{campaign_name}} - reduction de {{discount_percent}} % na bobili yo motoya.{{#coupon_code}} Code: {{coupon_code}}.{{/coupon_code}}'),
  ('campaign.whatsapp', 'whatsapp', 'tl', NULL,
   'DLXSTORE: {{campaign_name}} - {{discount_percent}}% discount sa susunod mong order.{{#coupon_code}} Code: {{coupon_code}}.{{/coupon_code}}'),
  ('campaign.whatsapp', 'whatsapp', 'kg', NULL,
   'DLXSTORE: {{campaign_name}} - mbembu ya {{discount_percent}}% na bobili yo elutatela.{{#coupon_code}} Code: {{coupon_code}}.{{/coupon_code}}'),

  ('campaign.in_app', 'in_app', 'fr', '{{campaign_name}}',
   '{{campaign_name}} : -{{discount_percent}} %{{#coupon_code}} avec le code {{coupon_code}}{{/coupon_code}}.'),
  ('campaign.in_app', 'in_app', 'en', '{{campaign_name}}',
   '{{campaign_name}}: {{discount_percent}}% off{{#coupon_code}} with code {{coupon_code}}{{/coupon_code}}.'),
  ('campaign.in_app', 'in_app', 'sw', '{{campaign_name}}',
   '{{campaign_name}}: punguzo ya {{discount_percent}}%{{#coupon_code}} kwa msimbo {{coupon_code}}{{/coupon_code}}.'),
  ('campaign.in_app', 'in_app', 'ln', '{{campaign_name}}',
   '{{campaign_name}} : reduction de {{discount_percent}} %{{#coupon_code}} na code {{coupon_code}}{{/coupon_code}}.'),
  ('campaign.in_app', 'in_app', 'tl', '{{campaign_name}}',
   '{{campaign_name}}: {{discount_percent}}% discount{{#coupon_code}} gamit ang code {{coupon_code}}{{/coupon_code}}.'),
  ('campaign.in_app', 'in_app', 'kg', '{{campaign_name}}',
   '{{campaign_name}}: mbembu ya {{discount_percent}}%{{#coupon_code}} na code {{coupon_code}}{{/coupon_code}}.')
ON CONFLICT (template_key, channel, locale) DO UPDATE
     SET subject = EXCLUDED.subject, body = EXCLUDED.body;

-- ============================================================================
-- 13. Grants
-- ============================================================================
-- PostgreSQL grants EXECUTE to PUBLIC on every new function by default. For this
-- migration that default is a vulnerability, not a convenience: `anon` must not
-- be able to reach the enqueue core, write into a customer's inbox, or drive the
-- dispatcher. So every function is revoked from PUBLIC first and then granted
-- back only where a role genuinely needs it.

-- Internal plumbing: no role may call these directly. They are reached only
-- from SECURITY DEFINER triggers and from other already-authorized functions.
REVOKE ALL ON FUNCTION public.enqueue_message_core(TEXT, TEXT, UUID, TEXT, JSONB, TEXT, BOOLEAN, TEXT, TEXT, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.queue_message_from_trigger(TEXT, TEXT, UUID, TEXT, JSONB, TEXT, TEXT, TEXT, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_message_template(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.render_message_body(TEXT, JSONB) FROM PUBLIC, anon;

-- Customer self-service. Each verifies auth.uid() in its body.
REVOKE ALL ON FUNCTION public.set_my_message_locale(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_message_opt_ins() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_my_message_opt_in(TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_message_locale(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_message_opt_ins() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_my_message_opt_in(TEXT, BOOLEAN) TO authenticated;

-- Enqueue on your own behalf, or on someone else's if you are an admin.
REVOKE ALL ON FUNCTION public.queue_message(TEXT, TEXT, UUID, TEXT, JSONB, TEXT, BOOLEAN, TEXT, TEXT, UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.queue_message(TEXT, TEXT, UUID, TEXT, JSONB, TEXT, BOOLEAN, TEXT, TEXT, UUID, INTEGER) TO authenticated;

-- Dispatcher and admin reporting. Granted to `authenticated` for usability; the
-- public.is_admin() check inside each function is the actual boundary.
REVOKE ALL ON FUNCTION public.admin_claim_outbox(INTEGER, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_record_outbox_result(UUID, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_release_stale_outbox(INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_send_campaign(UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_outbox(TEXT, TEXT, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_message_stats() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_marketing_audience(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_enqueue_test_message(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_upsert_message_template(TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.deliver_in_app_message(UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_claim_outbox(INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_record_outbox_result(UUID, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_release_stale_outbox(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_send_campaign(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_outbox(TEXT, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_message_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_marketing_audience(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_enqueue_test_message(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_message_template(TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deliver_in_app_message(UUID) TO authenticated;

-- Table access. No INSERT/UPDATE policy exists on message_outbox, so even an
-- admin writes to it only through the claim/record protocol above.
REVOKE ALL ON public.message_outbox FROM PUBLIC, anon;
REVOKE ALL ON public.message_templates FROM PUBLIC, anon;
REVOKE ALL ON public.message_opt_ins FROM PUBLIC, anon;
GRANT SELECT ON public.message_outbox TO authenticated;
GRANT SELECT ON public.message_templates TO authenticated;
GRANT SELECT ON public.message_opt_ins TO authenticated;
