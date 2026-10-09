-- DLXSTORE — Custom orders & quotations
--
-- Lets a customer describe a product DLXSTORE does not yet stock, attach
-- reference images, and receive a quotation from the DLX team. This is the
-- "tell us what you want" path beside the fixed catalogue: it never fabricates
-- a price, and a quotation is only ever written by an authorised reviewer
-- (admin/staff), never by the customer.
--
-- PRE-APPLICATION REQUIREMENTS
-- ----------------------------
-- 1. Read the remote migration ledger and obtain explicit operator approval.
--    This file is written but NOT applied by default.
-- 2. Depends only on objects that already ship: `public.profiles` (role, id),
--    `public.notifications`, and Supabase Storage. It creates no competing
--    product, order or quote table.
-- 3. Additive and idempotent (CREATE ... IF NOT EXISTS, CREATE OR REPLACE,
--    DROP POLICY IF EXISTS). No product, order, price or customer row is
--    rewritten, moved or deleted.
--
-- DESIGN NOTES
-- ------------
-- * Every write goes through a SECURITY DEFINER RPC. There is deliberately no
--   client INSERT/UPDATE policy on either table: a plain insert would let a
--   customer author their own quotation or set their own status to 'fulfilled'.
--   The RPCs are the single, validated write path, mirroring share_product()
--   and create_story().
-- * Reference images live in a PUBLIC `custom-order-media` bucket (like
--   chat-media): the customer uploads with their own JWT under their own folder,
--   and the DLX team reads them without a service-role key. Public read is
--   acceptable because these are the customer's own shared references, not
--   private media — the same trade-off chat-media already makes.
-- * Status is a small, explicit state machine. The customer may only cancel or
--   accept/decline a quote; advancing to quoted/declined/fulfilled is a reviewer
--   action. This is enforced in the RPC, not just the UI.
-- * A quotation is superseded when a reviewer sends a newer one, so the
--   "current" quote is unambiguous.
-- ============================================================================

-- ============================================================================
-- 1. Tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.custom_order_requests (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title                TEXT NOT NULL,
  details              TEXT NOT NULL,
  -- Optional. NULL means the customer has no figure in mind; never inferred.
  budget_cents         INTEGER CHECK (budget_cents IS NULL OR budget_cents >= 0),
  -- How the customer wants to be contacted about this request.
  contact_preference   TEXT NOT NULL DEFAULT 'chat'
                         CHECK (contact_preference IN ('chat', 'whatsapp')),
  -- Public URLs of reference images the customer uploaded. Bounded by the RPC.
  reference_image_urls TEXT[] NOT NULL DEFAULT '{}',
  status               TEXT NOT NULL DEFAULT 'open'
                         CHECK (status IN ('open', 'quoted', 'accepted', 'declined', 'cancelled', 'fulfilled')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS custom_order_requests_customer_idx
  ON public.custom_order_requests (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS custom_order_requests_status_idx
  ON public.custom_order_requests (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.custom_order_quotes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  UUID NOT NULL REFERENCES public.custom_order_requests(id) ON DELETE CASCADE,
  -- The reviewer (admin/staff) who authored the quote. Never the customer.
  author_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  message     TEXT,
  status      TEXT NOT NULL DEFAULT 'sent'
                CHECK (status IN ('sent', 'accepted', 'declined', 'superseded')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS custom_order_quotes_request_idx
  ON public.custom_order_quotes (request_id, created_at DESC);

ALTER TABLE public.custom_order_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_order_quotes ENABLE ROW LEVEL SECURITY;

-- A customer reads only their own requests; a reviewer reads all. No client
-- INSERT/UPDATE/DELETE policy exists on purpose — writes go through the RPCs.
DROP POLICY IF EXISTS "Customers read their own custom order requests" ON public.custom_order_requests;
CREATE POLICY "Customers read their own custom order requests"
  ON public.custom_order_requests FOR SELECT
  USING (customer_id = auth.uid());

DROP POLICY IF EXISTS "Reviewers read all custom order requests" ON public.custom_order_requests;
CREATE POLICY "Reviewers read all custom order requests"
  ON public.custom_order_requests FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles me WHERE me.id = auth.uid() AND me.role IN ('admin', 'staff')));

DROP POLICY IF EXISTS "Customers read quotes on their own requests" ON public.custom_order_quotes;
CREATE POLICY "Customers read quotes on their own requests"
  ON public.custom_order_quotes FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.custom_order_requests r
     WHERE r.id = custom_order_quotes.request_id AND r.customer_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Reviewers read all custom order quotes" ON public.custom_order_quotes;
CREATE POLICY "Reviewers read all custom order quotes"
  ON public.custom_order_quotes FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles me WHERE me.id = auth.uid() AND me.role IN ('admin', 'staff')));

-- ============================================================================
-- 2. Reference media bucket
-- ============================================================================
-- Public read (like chat-media): the team opens these without a service key.
-- Writes are scoped to the caller's own folder: `<profile_id>/<...>`.
INSERT INTO storage.buckets (id, name, public)
VALUES ('custom-order-media', 'custom-order-media', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "Public can read custom order media" ON storage.objects;
CREATE POLICY "Public can read custom order media"
  ON storage.objects FOR SELECT USING (bucket_id = 'custom-order-media');

DROP POLICY IF EXISTS "Authenticated users upload their own custom order media" ON storage.objects;
CREATE POLICY "Authenticated users upload their own custom order media"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'custom-order-media' AND split_part(name, '/', 1) = auth.uid()::TEXT);

DROP POLICY IF EXISTS "Custom order media owners replace own objects" ON storage.objects;
CREATE POLICY "Custom order media owners replace own objects"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'custom-order-media' AND split_part(name, '/', 1) = auth.uid()::TEXT)
  WITH CHECK (bucket_id = 'custom-order-media' AND split_part(name, '/', 1) = auth.uid()::TEXT);

DROP POLICY IF EXISTS "Custom order media owners delete own objects" ON storage.objects;
CREATE POLICY "Custom order media owners delete own objects"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'custom-order-media' AND split_part(name, '/', 1) = auth.uid()::TEXT);

-- ============================================================================
-- 3. create_custom_order_request — the customer write path
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_custom_order_request(
  p_title                TEXT,
  p_details              TEXT,
  p_budget_cents         INTEGER DEFAULT NULL,
  p_contact_preference   TEXT DEFAULT 'chat',
  p_reference_image_urls TEXT[] DEFAULT '{}'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_title    TEXT := btrim(COALESCE(p_title, ''));
  v_details  TEXT := btrim(COALESCE(p_details, ''));
  v_contact  TEXT := lower(btrim(COALESCE(p_contact_preference, 'chat')));
  v_images   TEXT[] := COALESCE(p_reference_image_urls, '{}');
  v_request  UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF char_length(v_title) < 3 THEN
    RAISE EXCEPTION 'Please give your request a short title';
  END IF;
  IF char_length(v_details) < 10 THEN
    RAISE EXCEPTION 'Please describe what you are looking for';
  END IF;
  IF v_contact NOT IN ('chat', 'whatsapp') THEN
    RAISE EXCEPTION 'Choose how you would like to be contacted';
  END IF;
  IF array_length(v_images, 1) > 6 THEN
    RAISE EXCEPTION 'You can attach up to 6 reference images';
  END IF;

  INSERT INTO public.custom_order_requests (
    customer_id, title, details, budget_cents, contact_preference, reference_image_urls
  )
  VALUES (v_uid, v_title, v_details, p_budget_cents, v_contact, v_images)
  RETURNING id INTO v_request;

  -- Tell the DLX team. A failure to notify must not lose the request.
  BEGIN
    INSERT INTO public.notifications (user_id, entity_type, entity_id, title, message, type, data)
    SELECT me.id, 'custom_order', v_request,
           'Nouvelle demande sur mesure',
           'Un client a envoyé une demande : ' || v_title,
           'custom_order',
           jsonb_build_object('request_id', v_request, 'customer_id', v_uid)
      FROM public.profiles me
     WHERE me.role IN ('admin', 'staff');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN v_request;
END;
$$;

-- ============================================================================
-- 4. get_my_custom_order_requests — the customer's own list + their quotes
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_my_custom_order_requests(p_limit INTEGER DEFAULT 50)
RETURNS TABLE (
  id                   UUID,
  title                TEXT,
  details              TEXT,
  budget_cents         INTEGER,
  contact_preference   TEXT,
  reference_image_urls TEXT[],
  status               TEXT,
  created_at           TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ,
  quotes               JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  RETURN QUERY
  SELECT r.id, r.title, r.details, r.budget_cents, r.contact_preference,
         r.reference_image_urls, r.status, r.created_at, r.updated_at,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
                    'id', q.id, 'price_cents', q.price_cents, 'message', q.message,
                    'status', q.status, 'created_at', q.created_at
                  ) ORDER BY q.created_at DESC)
             FROM public.custom_order_quotes q WHERE q.request_id = r.id
         ), '[]'::JSONB)
  FROM public.custom_order_requests r
  WHERE r.customer_id = v_uid
  ORDER BY r.created_at DESC
  LIMIT GREATEST(p_limit, 1);
END;
$$;

-- ============================================================================
-- 5. list_custom_order_requests — the reviewer inbox
-- ============================================================================
-- Admin/staff only. Optional status filter. Joins the customer's display name.
CREATE OR REPLACE FUNCTION public.list_custom_order_requests(
  p_status TEXT DEFAULT NULL,
  p_limit  INTEGER DEFAULT 100
)
RETURNS TABLE (
  id                   UUID,
  title                TEXT,
  details              TEXT,
  budget_cents         INTEGER,
  contact_preference   TEXT,
  reference_image_urls TEXT[],
  status               TEXT,
  created_at           TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ,
  customer_id          UUID,
  customer_name        TEXT,
  quote_count          INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_status TEXT := lower(btrim(COALESCE(p_status, '')));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles me WHERE me.id = v_uid AND me.role IN ('admin', 'staff')) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  RETURN QUERY
  SELECT r.id, r.title, r.details, r.budget_cents, r.contact_preference,
         r.reference_image_urls, r.status, r.created_at, r.updated_at,
         r.customer_id,
         COALESCE(p.full_name, 'Client'),
         (SELECT COUNT(*)::INTEGER FROM public.custom_order_quotes q WHERE q.request_id = r.id)
  FROM public.custom_order_requests r
  LEFT JOIN public.profiles p ON p.id = r.customer_id
  WHERE (v_status = '' OR r.status = v_status)
  ORDER BY r.created_at DESC
  LIMIT GREATEST(p_limit, 1);
END;
$$;

-- ============================================================================
-- 6. submit_custom_order_quote — the reviewer write path
-- ============================================================================
-- Admin/staff only. Sends a quotation, supersedes any earlier quote on the same
-- request, moves the request to 'quoted', and notifies the customer. The price
-- is the reviewer's real number; nothing here invents or discounts it.
CREATE OR REPLACE FUNCTION public.submit_custom_order_quote(
  p_request_id  UUID,
  p_price_cents INTEGER,
  p_message     TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_customer  UUID;
  v_title     TEXT;
  v_status    TEXT;
  v_quote     UUID;
  v_message   TEXT := NULLIF(btrim(COALESCE(p_message, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles me WHERE me.id = v_uid AND me.role IN ('admin', 'staff')) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF p_price_cents IS NULL OR p_price_cents < 0 THEN
    RAISE EXCEPTION 'Enter a valid price';
  END IF;

  SELECT r.customer_id, r.title, r.status INTO v_customer, v_title, v_status
    FROM public.custom_order_requests r WHERE r.id = p_request_id;
  IF v_customer IS NULL THEN
    RAISE EXCEPTION 'Request not found';
  END IF;
  IF v_status IN ('cancelled', 'fulfilled') THEN
    RAISE EXCEPTION 'This request is closed';
  END IF;

  UPDATE public.custom_order_quotes
     SET status = 'superseded'
   WHERE request_id = p_request_id AND status IN ('sent', 'accepted');

  INSERT INTO public.custom_order_quotes (request_id, author_id, price_cents, message)
  VALUES (p_request_id, v_uid, p_price_cents, v_message)
  RETURNING id INTO v_quote;

  UPDATE public.custom_order_requests
     SET status = 'quoted', updated_at = now()
   WHERE id = p_request_id;

  BEGIN
    INSERT INTO public.notifications (user_id, actor_id, entity_type, entity_id, title, message, type, data)
    VALUES (
      v_customer, v_uid, 'custom_order', p_request_id,
      'Votre devis est prêt',
      'Nous avons préparé un devis pour : ' || v_title,
      'custom_order_quote',
      jsonb_build_object('request_id', p_request_id, 'quote_id', v_quote)
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN v_quote;
END;
$$;

-- ============================================================================
-- 7. respond_custom_order_quote — the customer accepts or declines a quote
-- ============================================================================
CREATE OR REPLACE FUNCTION public.respond_custom_order_quote(
  p_quote_id UUID,
  p_accept   BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_request   UUID;
  v_customer  UUID;
  v_status    TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  SELECT r.id, r.customer_id, q.status
    INTO v_request, v_customer, v_status
    FROM public.custom_order_quotes q
    JOIN public.custom_order_requests r ON r.id = q.request_id
   WHERE q.id = p_quote_id;
  IF v_customer IS NULL THEN
    RAISE EXCEPTION 'Quote not found';
  END IF;
  IF v_customer <> v_uid THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF v_status <> 'sent' THEN
    RAISE EXCEPTION 'This quote is no longer open for a response';
  END IF;
  UPDATE public.custom_order_quotes
     SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END
   WHERE id = p_quote_id;
  UPDATE public.custom_order_requests
     SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'open' END,
         updated_at = now()
   WHERE id = v_request;
END;
$$;

-- ============================================================================
-- 8. set_custom_order_request_status — reviewer advances or customer cancels
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_custom_order_request_status(
  p_request_id UUID,
  p_status     TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_customer     UUID;
  v_current      TEXT;
  v_new          TEXT := lower(btrim(COALESCE(p_status, '')));
  v_is_reviewer  BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  SELECT r.customer_id, r.status INTO v_customer, v_current
    FROM public.custom_order_requests r WHERE r.id = p_request_id;
  IF v_customer IS NULL THEN
    RAISE EXCEPTION 'Request not found';
  END IF;
  v_is_reviewer := EXISTS (
    SELECT 1 FROM public.profiles me WHERE me.id = v_uid AND me.role IN ('admin', 'staff')
  );
  IF v_is_reviewer THEN
    IF v_new NOT IN ('quoted', 'declined', 'fulfilled', 'cancelled') THEN
      RAISE EXCEPTION 'Invalid status';
    END IF;
  ELSE
    IF v_customer <> v_uid THEN
      RAISE EXCEPTION 'Access denied';
    END IF;
    IF v_new <> 'cancelled' THEN
      RAISE EXCEPTION 'You can only cancel this request';
    END IF;
    IF v_current IN ('fulfilled', 'cancelled') THEN
      RAISE EXCEPTION 'This request is already closed';
    END IF;
  END IF;
  UPDATE public.custom_order_requests
     SET status = v_new, updated_at = now()
   WHERE id = p_request_id;
END;
$$;

-- ============================================================================
-- 9. Grants
-- ============================================================================
-- Revoke from PUBLIC first, then grant to `authenticated` only. Reviewer-only
-- RPCs are still granted to `authenticated` because the role check lives inside
-- the function; there is no `staff` database role to grant to.
REVOKE ALL ON FUNCTION public.create_custom_order_request(TEXT, TEXT, INTEGER, TEXT, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_custom_order_requests(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_custom_order_requests(TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_custom_order_quote(UUID, INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.respond_custom_order_quote(UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_custom_order_request_status(UUID, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_custom_order_request(TEXT, TEXT, INTEGER, TEXT, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_custom_order_requests(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_custom_order_requests(TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_custom_order_quote(UUID, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_custom_order_quote(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_custom_order_request_status(UUID, TEXT) TO authenticated;

-- REVERSIBLE (rollback)
--   DROP FUNCTION IF EXISTS public.set_custom_order_request_status(UUID, TEXT);
--   DROP FUNCTION IF EXISTS public.respond_custom_order_quote(UUID, BOOLEAN);
--   DROP FUNCTION IF EXISTS public.submit_custom_order_quote(UUID, INTEGER, TEXT);
--   DROP FUNCTION IF EXISTS public.list_custom_order_requests(TEXT, INTEGER);
--   DROP FUNCTION IF EXISTS public.get_my_custom_order_requests(INTEGER);
--   DROP FUNCTION IF EXISTS public.create_custom_order_request(TEXT, TEXT, INTEGER, TEXT, TEXT[]);
--   DROP POLICY IF EXISTS "Custom order media owners delete own objects" ON storage.objects;
--   DROP POLICY IF EXISTS "Custom order media owners replace own objects" ON storage.objects;
--   DROP POLICY IF EXISTS "Authenticated users upload their own custom order media" ON storage.objects;
--   DROP POLICY IF EXISTS "Public can read custom order media" ON storage.objects;
--   DELETE FROM storage.buckets WHERE id = 'custom-order-media';
--   DROP TABLE IF EXISTS public.custom_order_quotes;
--   DROP TABLE IF EXISTS public.custom_order_requests;
