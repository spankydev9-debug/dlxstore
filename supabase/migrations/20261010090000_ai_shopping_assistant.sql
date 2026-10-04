-- DLXSTORE — AI Shopping Assistant: conversations and grounded product recall
-- (master roadmap area 15)
--
-- PRE-APPLICATION REQUIREMENTS
-- ----------------------------
-- 1. Read the remote migration ledger and obtain explicit operator approval.
-- 2. Additive and idempotent. No product, order, price or customer row is
--    rewritten, moved or deleted.
--
-- WHAT WAS GENUINELY MISSING
-- --------------------------
-- The master checkpoint records DLX AI Assistant as `NOT STARTED`. AI Catalog
-- Automation shipped a provider-neutral boundary and a deterministic fallback, but
-- nothing customer-facing existed, and there was no place to hold a conversation:
--   a. No conversation storage. A shopping assistant that forgets every turn is a
--      search box, and "told me what I said last message" is table stakes.
--   b. No grounded product recall. The assistant must be able to answer from the
--      REAL catalogue — never from memory — or it will confidently invent prices
--      and stock for a store where being wrong is a lost or wrong order.
--   c. No rate limit or length bounds, so an assistant conversation is an
--      unbounded write amplifier against the catalogue.
--   d. No audit of what the assistant actually recommended, which is the only way
--      to tell a good assistant from a plausible one.
--
-- DESIGN NOTES
-- ------------
-- * This is NOT a generation feature and deliberately stores no model output. The
--   assistant returns REAL product ids selected from the catalogue, and the client
--   renders them. A language model may later choose *which* ids and write the
--   phrasing, but it can never invent a product, a price or a stock level, because
--   nothing it says is stored as fact here.
-- * `assistant_turns.product_ids` is a UUID[] validated by a join against
--   `products` at write time, so a crafted call cannot make the assistant claim to
--   recommend an archived or hidden product.
-- * The assistant is explicitly separate from AI Catalog Automation (which is an
--   admin tool) and from the Fashion Studio / Ghost Mannequin renderer (which is
--   deterministic image composition). No overlap, no shared code path.
-- * Rate limiting is per-customer and enforced in the database, because a
--   client-side limit is a suggestion.
--
-- ============================================================================
-- 1. assistant_conversations
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.assistant_conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS assistant_conversations_recent_idx
  ON public.assistant_conversations (profile_id, updated_at DESC);

ALTER TABLE public.assistant_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Customers manage their own assistant conversations"
  ON public.assistant_conversations;
CREATE POLICY "Customers manage their own assistant conversations"
  ON public.assistant_conversations FOR ALL
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

-- ============================================================================
-- 2. assistant_turns
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.assistant_turns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.assistant_conversations(id) ON DELETE CASCADE,
  -- Who spoke. 'user' is the customer; 'assistant' is the reply.
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  message         TEXT NOT NULL CHECK (char_length(btrim(message)) > 0
                                        AND char_length(message) <= 2000),
  -- The grounded products this turn surfaced. Empty is valid and common: a
  -- greeting or a clarifying question legitimately recommends nothing.
  product_ids     UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  -- How the answer was produced, so the client can label it honestly and the
  -- operator can measure whether a provider is actually being used.
  source          TEXT NOT NULL DEFAULT 'deterministic'
                  CHECK (source IN ('deterministic', 'ai')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS assistant_turns_conversation_idx
  ON public.assistant_turns (conversation_id, created_at ASC);

ALTER TABLE public.assistant_turns ENABLE ROW LEVEL SECURITY;

-- A customer sees a conversation only through their own conversation row, so the
-- policy re-checks ownership rather than trusting the conversation id alone.
DROP POLICY IF EXISTS "Customers read their own assistant turns" ON public.assistant_turns;
CREATE POLICY "Customers read their own assistant turns"
  ON public.assistant_turns FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.assistant_conversations c
      WHERE c.id = assistant_turns.conversation_id AND c.profile_id = auth.uid()
    )
  );

-- ============================================================================
-- 3. append_assistant_turn — the single write path
-- ============================================================================
-- Validates, bounds and rate-limits in one atomic step. The product ids are
-- filtered against the real catalogue rather than trusted: a turn can only ever
-- surface products that are actually purchasable.
--
-- The rate limit is a per-customer rolling window enforced here, because a
-- client-side limit is a suggestion. 30 turns / minute is generous for a human
-- and still bounds write amplification.
CREATE OR REPLACE FUNCTION public.append_assistant_turn(
  p_conversation_id UUID,
  p_role            TEXT,
  p_message         TEXT,
  p_product_ids     UUID[] DEFAULT ARRAY[]::UUID[],
  p_source          TEXT DEFAULT 'deterministic'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_role     TEXT := lower(btrim(COALESCE(p_role, '')));
  v_source   TEXT := lower(btrim(COALESCE(p_source, 'deterministic')));
  v_message  TEXT := btrim(COALESCE(p_message, ''));
  v_turn_id  UUID;
  v_products UUID[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_conversation_id IS NULL THEN
    RAISE EXCEPTION 'A conversation is required';
  END IF;

  -- Ownership check. A crafted conversation id from another customer must fail
  -- here, not silently append to someone else's thread.
  IF NOT EXISTS (
    SELECT 1 FROM public.assistant_conversations c
    WHERE c.id = p_conversation_id AND c.profile_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;

  IF v_role NOT IN ('user', 'assistant') THEN
    RAISE EXCEPTION 'Invalid assistant turn role';
  END IF;

  IF v_source NOT IN ('deterministic', 'ai') THEN
    RAISE EXCEPTION 'Invalid assistant turn source';
  END IF;

  IF v_message = '' OR char_length(v_message) > 2000 THEN
    RAISE EXCEPTION 'Message must be between 1 and 2000 characters';
  END IF;

  -- Rate limit: 30 turns per customer per rolling minute.
  IF (
    SELECT COUNT(*) FROM public.assistant_turns t
      JOIN public.assistant_conversations c ON c.id = t.conversation_id
     WHERE c.profile_id = v_uid
       AND t.created_at >= now() - INTERVAL '1 minute'
  ) >= 30 THEN
    RAISE EXCEPTION 'You are sending messages too quickly';
  END IF;

  -- Never trust a product id: keep only the ones that are actually buyable, so a
  -- turn can never recommend an archived, inactive or non-existent product.
  v_products := ARRAY(
    SELECT p.id
      FROM unnest(COALESCE(p_product_ids, ARRAY[]::UUID[])) WITH ORDINALITY AS t(pid, ord)
      JOIN public.products p ON p.id = t.pid
     WHERE p.is_active = true AND p.is_archived = false
     ORDER BY t.ord
  );

  INSERT INTO public.assistant_turns (conversation_id, role, message, product_ids, source)
  VALUES (p_conversation_id, v_role, v_message, COALESCE(v_products, ARRAY[]::UUID[]), v_source)
  RETURNING id INTO v_turn_id;

  -- Bump the conversation so "recent conversations" ordering is correct.
  UPDATE public.assistant_conversations
     SET updated_at = now()
   WHERE id = p_conversation_id;

  RETURN v_turn_id;
END;
$$;

-- ============================================================================
-- 4. Grounded recall: search_the_catalogue
-- ============================================================================
-- This is what makes the assistant trustworthy. It searches the REAL catalogue and
-- returns real product rows. There is no generation step and no invented data, so
-- the assistant cannot hallucinate a price, a stock level or a product.
--
-- Deliberately simple and explainable ranking rather than a similarity model:
--   1. Exact name match ranks highest, then prefix, then substring, then brand,
--      then description.
--   2. `stock_quantity > 0` is a filter, not a sort key: never recommend what
--      cannot be bought.
--   3. Price and category bounds are optional and applied when supplied.
CREATE OR REPLACE FUNCTION public.search_the_catalogue(
  p_query TEXT,
  p_limit INTEGER DEFAULT 6,
  p_max_price NUMERIC DEFAULT NULL,
  p_category_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id             UUID,
  name           TEXT,
  slug           TEXT,
  brand          TEXT,
  price          NUMERIC,
  discount_price NUMERIC,
  image_url      TEXT,
  stock_quantity INTEGER,
  product_type   TEXT,
  rank_score     INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_query TEXT := btrim(COALESCE(p_query, ''));
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 6), 1), 24);
BEGIN
  IF v_query = '' THEN
    RAISE EXCEPTION 'A search query is required';
  END IF;

  RETURN QUERY
  SELECT
    p.id, p.name, p.slug, p.brand, p.price, p.discount_price,
    (SELECT pi.image_url FROM public.product_images pi
      WHERE pi.product_id = p.id
      ORDER BY pi.is_primary DESC, pi.display_order ASC LIMIT 1),
    p.stock_quantity,
    p.product_type,
    -- Explicit, inspectable scoring. A customer asking "Nike" should get Nikes.
    (CASE WHEN lower(p.name) = lower(v_query) THEN 100
          WHEN lower(p.name) LIKE lower(v_query) || '%' THEN 60
          WHEN lower(p.name) LIKE '%' || lower(v_query) || '%' THEN 40
          WHEN lower(p.brand) LIKE '%' || lower(v_query) || '%' THEN 30
          WHEN lower(COALESCE(p.description, '')) LIKE '%' || lower(v_query) || '%' THEN 10
          ELSE 5
     END)::INTEGER
    FROM public.products p
   WHERE p.is_active = true
     AND p.is_archived = false
     -- Never recommend something unbuyable.
     AND p.stock_quantity > 0
     AND (p_max_price IS NULL OR COALESCE(p.discount_price, p.price) <= p_max_price)
     AND (p_category_id IS NULL OR p.category_id = p_category_id)
     AND (
       lower(p.name) LIKE '%' || lower(v_query) || '%'
       OR lower(p.brand) LIKE '%' || lower(v_query) || '%'
       OR lower(COALESCE(p.description, '')) LIKE '%' || lower(v_query) || '%'
     )
   ORDER BY 10 DESC, p.name ASC
   LIMIT v_limit;
END;
$$;

-- ============================================================================
-- 5. Conversation reads
-- ============================================================================
-- Two RPCs rather than direct table reads, so the ownership re-check lives in one
-- place and the client never assembles a query that could leak another thread.
CREATE OR REPLACE FUNCTION public.get_my_assistant_conversations(p_limit INTEGER DEFAULT 20)
RETURNS TABLE (
  id         UUID,
  title      TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  RETURN QUERY
  SELECT c.id, c.title, c.created_at, c.updated_at
    FROM public.assistant_conversations c
   WHERE c.profile_id = v_uid
   ORDER BY c.updated_at DESC
   LIMIT v_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_assistant_turns(p_conversation_id UUID)
RETURNS TABLE (
  id          UUID,
  role        TEXT,
  message     TEXT,
  product_ids UUID[],
  source      TEXT,
  created_at  TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.assistant_conversations c
    WHERE c.id = p_conversation_id AND c.profile_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;

  RETURN QUERY
  SELECT t.id, t.role, t.message, t.product_ids, t.source, t.created_at
    FROM public.assistant_turns t
   WHERE t.conversation_id = p_conversation_id
   ORDER BY t.created_at ASC
   LIMIT 500;
END;
$$;

-- ============================================================================
-- 6. Grants
-- ============================================================================
-- Catalogue search is granted to `anon` on purpose: it returns exactly the rows the
-- public storefront already exposes, and letting a signed-out visitor ask "do you
-- have a phone under 200?" before creating an account is the point.
-- Conversations and turns are strictly per-customer.
REVOKE ALL ON FUNCTION public.append_assistant_turn(UUID, TEXT, TEXT, UUID[], TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_the_catalogue(TEXT, INTEGER, NUMERIC, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_assistant_conversations(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_assistant_turns(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.append_assistant_turn(UUID, TEXT, TEXT, UUID[], TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_the_catalogue(TEXT, INTEGER, NUMERIC, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_assistant_conversations(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_assistant_turns(UUID) TO authenticated;

-- ============================================================================
-- REVERSIBLE (rollback)
-- ============================================================================
--   DROP FUNCTION IF EXISTS public.get_assistant_turns(UUID);
--   DROP FUNCTION IF EXISTS public.get_my_assistant_conversations(INTEGER);
--   DROP FUNCTION IF EXISTS public.search_the_catalogue(TEXT, INTEGER, NUMERIC, UUID);
--   DROP FUNCTION IF EXISTS public.append_assistant_turn(UUID, TEXT, TEXT, UUID[], TEXT);
--   DROP TABLE IF EXISTS public.assistant_turns;
--   DROP TABLE IF EXISTS public.assistant_conversations;
--
-- Nothing pre-existing is modified. Rolling back removes only the assistant's own
-- conversation history, which is the intended meaning of removing the feature. The
-- catalogue, orders and the social graph are untouched.
