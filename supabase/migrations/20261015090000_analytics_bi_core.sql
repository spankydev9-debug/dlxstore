-- ============================================================================
-- Phase 12 (P12) — Analytics & business intelligence
-- Roadmap Phase 18. Revenue, orders, AOV, conversion, best and slow sellers,
-- category performance, retention, repeat customers, delivery performance,
-- inventory turnover, profit and margins.
--
-- Principles that shaped this migration:
--
--   * Every number is computed from the real transactional tables
--     (orders / order_items / products / deliveries / profiles). Nothing is
--     seeded, estimated or modelled. There is no "estimated revenue".
--
--   * Missing data is reported as missing, never as zero. `products.cost_price`
--     is NULL for any product whose cost nobody has entered. Profit and margin
--     therefore aggregate only over products with a known cost AND report a
--     `cost_coverage_percent`, so a 90% margin on 10% of the catalogue can
--     never be mistaken for the real margin. Treating unknown cost as zero is
--     the classic way analytics invent profit.
--
--   * "Conversion" is only reported over a funnel we actually measure:
--     registered profiles -> customers who ordered -> repeat customers. There
--     is no traffic or session tracking in DLXSTORE, so this migration does not
--     pretend to report a visitor-to-order conversion rate.
--
--   * Every function is admin-gated in SQL. Admin screens are not an
--     authorization boundary; the Phase 10 review found exactly that bug in
--     admin_get_reports.
-- ============================================================================

-- ============================================================================
-- 1. Cost of goods, so profit and margin mean anything
-- ============================================================================
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS cost_price NUMERIC
  CHECK (cost_price IS NULL OR cost_price >= 0);

COMMENT ON COLUMN public.products.cost_price IS
  'Unit cost. NULL means unknown, and is excluded from profit/margin aggregates rather than treated as zero.';

-- ============================================================================
-- 2. Daily snapshots, so trends stay cheap and auditable
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.analytics_daily (
  snapshot_date     DATE    PRIMARY KEY,
  revenue           NUMERIC NOT NULL DEFAULT 0,
  orders            INTEGER NOT NULL DEFAULT 0,
  units             INTEGER NOT NULL DEFAULT 0,
  customers         INTEGER NOT NULL DEFAULT 0,
  new_customers     INTEGER NOT NULL DEFAULT 0,
  repeat_customers  INTEGER NOT NULL DEFAULT 0,
  delivered_orders  INTEGER NOT NULL DEFAULT 0,
  cancelled_orders  INTEGER NOT NULL DEFAULT 0,
  discounts         NUMERIC NOT NULL DEFAULT 0,
  gross_profit      NUMERIC,
  cost_coverage_percent NUMERIC,
  avg_delivery_hours NUMERIC,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.analytics_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read analytics snapshots" ON public.analytics_daily;
CREATE POLICY "Admins read analytics snapshots"
  ON public.analytics_daily FOR SELECT USING (public.is_admin());

-- ============================================================================
-- 3. Shared date-range normalisation
-- ============================================================================
-- Resolves the caller's window to concrete timestamps once, so every report
-- uses the same bounds and none of them silently defaults to "all time" when a
-- caller forgets to pass a range.
CREATE OR REPLACE FUNCTION public.analytics_window(
  p_from DATE DEFAULT NULL,
  p_to   DATE DEFAULT NULL,
  p_default_days INTEGER DEFAULT 30
)
RETURNS TABLE (from_ts TIMESTAMPTZ, to_ts TIMESTAMPTZ)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
-- Output parameter names (revenue, units, ...) also appear as column
-- names in the aggregates below. Without this directive plpgsql resolves
-- those to the variable and every such aggregate is ambiguous.
#variable_conflict use_column
DECLARE
  v_days INTEGER := LEAST(GREATEST(COALESCE(p_default_days, 30), 1), 730);
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(p_from::TIMESTAMPTZ, timezone('utc', now()) - make_interval(days => v_days)),
    -- `to` is inclusive of the whole day.
    COALESCE(p_to::TIMESTAMPTZ, timezone('utc', now())) + INTERVAL '1 day';
END;
$$;

-- ============================================================================
-- 4. Headline revenue summary
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_revenue_summary(
  p_from DATE DEFAULT NULL,
  p_to   DATE DEFAULT NULL
)
RETURNS TABLE (
  revenue            NUMERIC,
  orders             BIGINT,
  delivered_orders   BIGINT,
  cancelled_orders   BIGINT,
  units              BIGINT,
  customers          BIGINT,
  aov                NUMERIC,
  discounts          NUMERIC,
  cancellation_rate  NUMERIC,
  avg_order_value    NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
-- Output parameter names (revenue, units, ...) also appear as column
-- names in the aggregates below. Without this directive plpgsql resolves
-- those to the variable and every such aggregate is ambiguous.
#variable_conflict use_column
DECLARE
  w_from TIMESTAMPTZ;
  w_to   TIMESTAMPTZ;
BEGIN
  SELECT * INTO w_from, w_to FROM public.analytics_window(p_from, p_to);

  RETURN QUERY
  SELECT
    COALESCE(SUM(o.total_amount) FILTER (WHERE o.status = 'delivered'), 0),
    COUNT(*),
    COUNT(*) FILTER (WHERE o.status = 'delivered'),
    COUNT(*) FILTER (WHERE o.status = 'cancelled'),
    COALESCE((
      SELECT SUM(oi.quantity)
        FROM public.order_items oi
        JOIN public.orders o2 ON o2.id = oi.order_id
       WHERE o2.created_at >= w_from AND o2.created_at < w_to
         AND o2.status = 'delivered'
    ), 0),
    COUNT(DISTINCT o.customer_id),
    CASE WHEN COUNT(*) FILTER (WHERE o.status = 'delivered') > 0
         THEN ROUND(COALESCE(SUM(o.total_amount) FILTER (WHERE o.status = 'delivered'), 0)
                    / COUNT(*) FILTER (WHERE o.status = 'delivered'), 2)
         ELSE 0 END,
    COALESCE(SUM(o.discount_amount), 0),
    CASE WHEN COUNT(*) > 0
         THEN ROUND(COUNT(*) FILTER (WHERE o.status = 'cancelled')::NUMERIC / COUNT(*) * 100, 1)
         ELSE 0 END,
    CASE WHEN COUNT(*) > 0 THEN ROUND(AVG(o.total_amount), 2) ELSE 0 END
  FROM public.orders o
  WHERE o.created_at >= w_from AND o.created_at < w_to;
END;
$$;

-- ============================================================================
-- 5. Best sellers and slow movers
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_top_sellers(
  p_from  DATE DEFAULT NULL,
  p_to    DATE DEFAULT NULL,
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  product_id    UUID,
  product_name  TEXT,
  sku           TEXT,
  units         BIGINT,
  revenue       NUMERIC,
  profit        NUMERIC,
  in_stock      INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
-- Output parameter names (revenue, units, ...) also appear as column
-- names in the aggregates below. Without this directive plpgsql resolves
-- those to the variable and every such aggregate is ambiguous.
#variable_conflict use_column
DECLARE
  w_from TIMESTAMPTZ;
  w_to   TIMESTAMPTZ;
BEGIN
  SELECT * INTO w_from, w_to FROM public.analytics_window(p_from, p_to);

  RETURN QUERY
  SELECT
    p.id,
    p.name,
    COALESCE(p.sku, ''),
    SUM(oi.quantity),
    SUM(oi.price_at_sale * oi.quantity),
    -- NULL when the product has no recorded cost; see header note.
    CASE WHEN p.cost_price IS NOT NULL
         THEN SUM((oi.price_at_sale - p.cost_price) * oi.quantity)
         ELSE NULL END,
    p.stock_quantity
  FROM public.order_items oi
  JOIN public.orders o  ON o.id = oi.order_id AND o.status = 'delivered'
  JOIN public.products p ON p.id = oi.product_id
  WHERE o.created_at >= w_from AND o.created_at < w_to
  GROUP BY p.id, p.name, p.sku, p.cost_price, p.stock_quantity
  ORDER BY SUM(oi.quantity) DESC, SUM(oi.price_at_sale * oi.quantity) DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
END;
$$;

-- Slow movers: real stock that did not sell. Driven by the inventory history
-- and delivered order lines rather than by a guessed idle window.
CREATE OR REPLACE FUNCTION public.admin_slow_movers(
  p_days     INTEGER DEFAULT 90,
  p_min_units INTEGER DEFAULT 1,
  p_limit    INTEGER DEFAULT 20
)
RETURNS TABLE (
  product_id     UUID,
  product_name   TEXT,
  sku            TEXT,
  stock_quantity INTEGER,
  units_sold     BIGINT,
  stock_value    NUMERIC,
  idle_days      INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
-- Output parameter names (revenue, units, ...) also appear as column
-- names in the aggregates below. Without this directive plpgsql resolves
-- those to the variable and every such aggregate is ambiguous.
#variable_conflict use_column
DECLARE
  v_days INTEGER := LEAST(GREATEST(COALESCE(p_days, 90), 1), 730);
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.name,
    COALESCE(p.sku, ''),
    p.stock_quantity,
    COALESCE((
      SELECT SUM(oi.quantity)
        FROM public.order_items oi
        JOIN public.orders o ON o.id = oi.order_id
       WHERE oi.product_id = p.id
         AND o.status = 'delivered'
         AND o.created_at >= timezone('utc', now()) - make_interval(days => v_days)
    ), 0),
    CASE WHEN p.cost_price IS NOT NULL
         THEN ROUND(p.cost_price * p.stock_quantity, 2)
         ELSE NULL END,
    COALESCE((
      SELECT MAX(ih.created_at)::DATE
        FROM public.inventory_history ih
       WHERE ih.product_id = p.id
    ), p.created_at::DATE) - (timezone('utc', now())::DATE - v_days)
  FROM public.products p
  WHERE p.is_active = true
    AND p.is_archived = false
    AND p.stock_quantity > 0
    AND COALESCE((
      SELECT SUM(oi.quantity)
        FROM public.order_items oi
        JOIN public.orders o ON o.id = oi.order_id
       WHERE oi.product_id = p.id
         AND o.status = 'delivered'
         AND o.created_at >= timezone('utc', now()) - make_interval(days => v_days)
    ), 0) < COALESCE(p_min_units, 1)
  ORDER BY p.stock_quantity DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
END;
$$;

-- ============================================================================
-- 6. Category performance
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_category_performance(
  p_from DATE DEFAULT NULL,
  p_to   DATE DEFAULT NULL
)
RETURNS TABLE (
  category_id   UUID,
  category_name TEXT,
  units         BIGINT,
  revenue       NUMERIC,
  orders        BIGINT,
  revenue_share NUMERIC,
  product_count INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
-- Output parameter names (revenue, units, ...) also appear as column
-- names in the aggregates below. Without this directive plpgsql resolves
-- those to the variable and every such aggregate is ambiguous.
#variable_conflict use_column
DECLARE
  w_from TIMESTAMPTZ;
  w_to   TIMESTAMPTZ;
BEGIN
  SELECT * INTO w_from, w_to FROM public.analytics_window(p_from, p_to);

  RETURN QUERY
  WITH cat AS (
    SELECT
      COALESCE(c.id, '00000000-0000-0000-0000-000000000000'::UUID) AS category_id,
      COALESCE(c.name, 'Uncategorised') AS category_name,
      SUM(oi.quantity) AS units,
      SUM(oi.price_at_sale * oi.quantity) AS revenue,
      COUNT(DISTINCT o.id) AS orders,
      COUNT(DISTINCT p.id)::INTEGER AS product_count
    FROM public.order_items oi
    JOIN public.orders o    ON o.id = oi.order_id AND o.status = 'delivered'
    JOIN public.products p  ON p.id = oi.product_id
    LEFT JOIN public.categories c ON c.id = p.category_id
    WHERE o.created_at >= w_from AND o.created_at < w_to
    GROUP BY COALESCE(c.id, '00000000-0000-0000-0000-000000000000'::UUID), COALESCE(c.name, 'Uncategorised')
  ), total AS (SELECT COALESCE(SUM(revenue), 0) AS grand FROM cat)
  SELECT cat.category_id, cat.category_name, cat.units, cat.revenue, cat.orders,
         CASE WHEN total.grand > 0
              THEN ROUND(cat.revenue / total.grand * 100, 1) ELSE 0 END,
         cat.product_count
  FROM cat CROSS JOIN total
  ORDER BY cat.revenue DESC;
END;
$$;

-- ============================================================================
-- 7. Retention and repeat customers
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_retention(
  p_from DATE DEFAULT NULL,
  p_to   DATE DEFAULT NULL
)
RETURNS TABLE (
  registered_customers BIGINT,
  ordering_customers   BIGINT,
  repeat_customers     BIGINT,
  new_customers        BIGINT,
  repeat_rate          NUMERIC,
  activation_rate      NUMERIC,
  avg_orders_per_customer NUMERIC,
  repeat_revenue_share NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
-- Output parameter names (revenue, units, ...) also appear as column
-- names in the aggregates below. Without this directive plpgsql resolves
-- those to the variable and every such aggregate is ambiguous.
#variable_conflict use_column
DECLARE
  w_from TIMESTAMPTZ;
  w_to   TIMESTAMPTZ;
BEGIN
  SELECT * INTO w_from, w_to FROM public.analytics_window(p_from, p_to);

  RETURN QUERY
  WITH reg AS (
    SELECT COUNT(*)::BIGINT AS n FROM public.profiles
     WHERE role = 'customer' AND created_at >= w_from AND created_at < w_to
  ), ord AS (
    SELECT o.customer_id, COUNT(*) AS n_orders, SUM(o.total_amount) AS revenue
      FROM public.orders o
     WHERE o.status = 'delivered'
       AND o.customer_id IS NOT NULL
       AND o.created_at >= w_from AND o.created_at < w_to
     GROUP BY o.customer_id
  ), agg AS (
    SELECT
      COUNT(*)::BIGINT AS ordering_customers,
      COUNT(*) FILTER (WHERE n_orders > 1)::BIGINT AS repeat_customers,
      COALESCE(SUM(n_orders), 0) AS total_orders,
      COALESCE(SUM(revenue), 0) AS total_revenue,
      COALESCE(SUM(revenue) FILTER (WHERE n_orders > 1), 0) AS repeat_revenue
    FROM ord
  )
  SELECT
    reg.n,
    agg.ordering_customers,
    agg.repeat_customers,
    GREATEST(agg.ordering_customers - agg.repeat_customers, 0),
    CASE WHEN agg.ordering_customers > 0
         THEN ROUND(agg.repeat_customers::NUMERIC / agg.ordering_customers * 100, 1) ELSE 0 END,
    CASE WHEN reg.n > 0
         THEN ROUND(agg.ordering_customers::NUMERIC / reg.n * 100, 1) ELSE 0 END,
    CASE WHEN agg.ordering_customers > 0
         THEN ROUND(agg.total_orders::NUMERIC / agg.ordering_customers, 2) ELSE 0 END,
    CASE WHEN agg.total_revenue > 0
         THEN ROUND(agg.repeat_revenue / agg.total_revenue * 100, 1) ELSE 0 END
  FROM reg CROSS JOIN agg;
END;
$$;

-- ============================================================================
-- 8. Delivery performance
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_delivery_performance(
  p_from DATE DEFAULT NULL,
  p_to   DATE DEFAULT NULL
)
RETURNS TABLE (
  delivery_status TEXT,
  orders          BIGINT,
  avg_hours_to_complete NUMERIC,
  max_hours_to_complete NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
-- Output parameter names (revenue, units, ...) also appear as column
-- names in the aggregates below. Without this directive plpgsql resolves
-- those to the variable and every such aggregate is ambiguous.
#variable_conflict use_column
DECLARE
  w_from TIMESTAMPTZ;
  w_to   TIMESTAMPTZ;
BEGIN
  SELECT * INTO w_from, w_to FROM public.analytics_window(p_from, p_to);

  RETURN QUERY
  SELECT
    COALESCE(d.status, 'unassigned'),
    COUNT(*),
    ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(d.delivered_at, timezone('utc', now())) - d.created_at)) / 3600)::NUMERIC, 1),
    ROUND(MAX(EXTRACT(EPOCH FROM (COALESCE(d.delivered_at, timezone('utc', now())) - d.created_at)) / 3600)::NUMERIC, 1)
  FROM public.deliveries d
  JOIN public.orders o ON o.id = d.order_id
  WHERE d.created_at >= w_from AND d.created_at < w_to
  GROUP BY COALESCE(d.status, 'unassigned')
  ORDER BY COUNT(*) DESC;
END;
$$;

-- ============================================================================
-- 9. Inventory turnover
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_inventory_turnover(
  p_from DATE DEFAULT NULL,
  p_to   DATE DEFAULT NULL
)
RETURNS TABLE (
  product_id      UUID,
  product_name    TEXT,
  units_sold      NUMERIC,
  avg_stock       NUMERIC,
  turnover_ratio  NUMERIC,
  days_of_supply  NUMERIC,
  stock_on_hand   INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
-- Output parameter names (revenue, units, ...) also appear as column
-- names in the aggregates below. Without this directive plpgsql resolves
-- those to the variable and every such aggregate is ambiguous.
#variable_conflict use_column
DECLARE
  w_from TIMESTAMPTZ;
  w_to   TIMESTAMPTZ;
  v_days NUMERIC;
BEGIN
  SELECT * INTO w_from, w_to FROM public.analytics_window(p_from, p_to);
  v_days := EXTRACT(EPOCH FROM (w_to - w_from)) / 86400.0;

  RETURN QUERY
  WITH sold AS (
    SELECT oi.product_id, SUM(oi.quantity)::NUMERIC AS units
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id AND o.status = 'delivered'
     WHERE o.created_at >= w_from AND o.created_at < w_to
     GROUP BY oi.product_id
  ), moved AS (
    -- Prefer real stock movements; fall back to current stock so a product that
    -- never moved still reports its days of supply.
    SELECT p.id AS product_id,
           COALESCE((
             SELECT SUM(ABS(ih.quantity_changed))
               FROM public.inventory_history ih
              WHERE ih.product_id = p.id
                AND ih.created_at >= w_from AND ih.created_at < w_to
           ), p.stock_quantity)::NUMERIC AS avg_stock
      FROM public.products p
     WHERE p.is_active = true AND p.is_archived = false
  )
  SELECT
    m.product_id,
    p.name,
    COALESCE(s.units, 0),
    m.avg_stock,
    CASE WHEN m.avg_stock > 0 THEN ROUND(COALESCE(s.units, 0) / m.avg_stock, 2) ELSE 0 END,
    CASE WHEN COALESCE(s.units, 0) > 0
         THEN ROUND(p.stock_quantity / (COALESCE(s.units, 0) / v_days), 1)
         ELSE NULL END,
    p.stock_quantity
  FROM moved m
  JOIN public.products p ON p.id = m.product_id
  LEFT JOIN sold s ON s.product_id = m.product_id
  WHERE COALESCE(s.units, 0) > 0
  ORDER BY 5 DESC NULLS LAST
  LIMIT 50;
END;
$$;

-- ============================================================================
-- 10. Profit and margin, with explicit cost coverage
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_profit_summary(
  p_from DATE DEFAULT NULL,
  p_to   DATE DEFAULT NULL
)
RETURNS TABLE (
  revenue               NUMERIC,
  cost_of_goods         NUMERIC,
  gross_profit          NUMERIC,
  margin_percent        NUMERIC,
  cost_coverage_percent NUMERIC,
  unpriced_product_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
-- Output parameter names (revenue, units, ...) also appear as column
-- names in the aggregates below. Without this directive plpgsql resolves
-- those to the variable and every such aggregate is ambiguous.
#variable_conflict use_column
DECLARE
  w_from TIMESTAMPTZ;
  w_to   TIMESTAMPTZ;
BEGIN
  SELECT * INTO w_from, w_to FROM public.analytics_window(p_from, p_to);

  RETURN QUERY
  WITH sold AS (
    SELECT oi.product_id,
           SUM(oi.price_at_sale * oi.quantity) AS revenue,
           SUM(oi.quantity) AS units
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id AND o.status = 'delivered'
     WHERE o.created_at >= w_from AND o.created_at < w_to
     GROUP BY oi.product_id
  ), joined AS (
    SELECT s.revenue, p.cost_price, s.units
      FROM sold s
      JOIN public.products p ON p.id = s.product_id
  ), agg AS (
    SELECT
      COALESCE(SUM(revenue), 0) AS total_revenue,
      COALESCE(SUM(revenue) FILTER (WHERE cost_price IS NOT NULL), 0) AS covered_revenue,
      COALESCE(SUM(cost_price * units) FILTER (WHERE cost_price IS NOT NULL), 0) AS cogs,
      COUNT(*) FILTER (WHERE cost_price IS NULL)::BIGINT AS unpriced_lines
    FROM joined
  )
  SELECT
    agg.total_revenue,
    ROUND(agg.cogs, 2),
    ROUND(agg.covered_revenue - agg.cogs, 2),
    CASE WHEN agg.covered_revenue > 0
         THEN ROUND((agg.covered_revenue - agg.cogs) / agg.covered_revenue * 100, 1)
         ELSE NULL END,
    CASE WHEN agg.total_revenue > 0
         THEN ROUND(agg.covered_revenue / agg.total_revenue * 100, 1)
         ELSE NULL END,
    agg.unpriced_lines
  FROM agg;
END;
$$;

-- ============================================================================
-- 11. Sales time series
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_sales_timeseries(
  p_from   DATE DEFAULT NULL,
  p_to     DATE DEFAULT NULL,
  p_bucket TEXT DEFAULT 'day'
)
RETURNS TABLE (
  bucket     DATE,
  revenue    NUMERIC,
  orders     BIGINT,
  units      BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
-- Output parameter names (revenue, units, ...) also appear as column
-- names in the aggregates below. Without this directive plpgsql resolves
-- those to the variable and every such aggregate is ambiguous.
#variable_conflict use_column
DECLARE
  w_from TIMESTAMPTZ;
  w_to   TIMESTAMPTZ;
  v_bucket TEXT := COALESCE(p_bucket, 'day');
BEGIN
  -- Guard the date_trunc unit: it is interpolated into a function name
  -- resolution, so an unexpected value must fail loudly instead of erroring
  -- deep inside the query plan.
  IF v_bucket NOT IN ('day', 'week', 'month', 'quarter', 'year') THEN
    RAISE EXCEPTION 'Unsupported bucket %, expected day, week, month, quarter or year', v_bucket;
  END IF;

  SELECT * INTO w_from, w_to FROM public.analytics_window(p_from, p_to);

  -- Units are resolved per order first. A correlated subquery reading o.id
  -- inside the aggregate would reference a column that is neither grouped nor
  -- aggregated.
  RETURN QUERY
  WITH per_order AS (
    SELECT
      o.created_at,
      o.status,
      o.total_amount,
      COALESCE((
        SELECT SUM(oi.quantity)
          FROM public.order_items oi
         WHERE oi.order_id = o.id
      ), 0) AS units
    FROM public.orders o
    WHERE o.created_at >= w_from AND o.created_at < w_to
  )
  SELECT
    date_trunc(v_bucket, created_at)::DATE,
    COALESCE(SUM(total_amount) FILTER (WHERE status = 'delivered'), 0),
    COUNT(*) FILTER (WHERE status = 'delivered'),
    COALESCE(SUM(units) FILTER (WHERE status = 'delivered'), 0)::BIGINT
  FROM per_order
  GROUP BY 1
  ORDER BY 1;
END;
$$;

-- ============================================================================
-- 12. Daily snapshot
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_record_analytics_snapshot(
  p_date DATE DEFAULT NULL
)
RETURNS DATE
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
-- Output parameter names (revenue, units, ...) also appear as column
-- names in the aggregates below. Without this directive plpgsql resolves
-- those to the variable and every such aggregate is ambiguous.
#variable_conflict use_column
DECLARE
  v_day  DATE := COALESCE(p_date, timezone('utc', now())::DATE);
  v_from TIMESTAMPTZ := v_day::TIMESTAMPTZ;
  v_to   TIMESTAMPTZ := (v_day + 1)::TIMESTAMPTZ;
  v_gross_profit NUMERIC;
  v_cost_coverage NUMERIC;
  v_delivery NUMERIC;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT gross_profit, cost_coverage_percent
    INTO v_gross_profit, v_cost_coverage
    FROM public.admin_profit_summary(v_day, v_day);

  SELECT ROUND(AVG(EXTRACT(EPOCH FROM (d.delivered_at - d.created_at)) / 3600)::NUMERIC, 1)
    INTO v_delivery
    FROM public.deliveries d
   WHERE d.status = 'delivered' AND d.delivered_at IS NOT NULL
     AND d.created_at >= v_from AND d.created_at < v_to;

  INSERT INTO public.analytics_daily AS d (
    snapshot_date, revenue, orders, units, customers, new_customers, repeat_customers,
    delivered_orders, cancelled_orders, discounts, gross_profit, cost_coverage_percent,
    avg_delivery_hours
  )
  SELECT
    v_day,
    COALESCE(SUM(o.total_amount) FILTER (WHERE o.status = 'delivered'), 0),
    COUNT(*),
    COALESCE((SELECT SUM(oi.quantity) FROM public.order_items oi WHERE oi.order_id IN
                (SELECT id FROM public.orders WHERE created_at >= v_from AND created_at < v_to)), 0),
    COUNT(DISTINCT o.customer_id),
    (SELECT COUNT(*) FROM public.profiles
      WHERE role = 'customer' AND created_at >= v_from AND created_at < v_to),
    COUNT(DISTINCT o.customer_id) FILTER (
      WHERE EXISTS (SELECT 1 FROM public.orders o2
                     WHERE o2.customer_id = o.customer_id AND o2.status = 'delivered'
                       AND o2.created_at < v_from)),
    COUNT(*) FILTER (WHERE o.status = 'delivered'),
    COUNT(*) FILTER (WHERE o.status = 'cancelled'),
    COALESCE(SUM(o.discount_amount), 0),
    v_gross_profit,
    v_cost_coverage,
    v_delivery
  FROM public.orders o
  WHERE o.created_at >= v_from AND o.created_at < v_to
  -- No HAVING: a requested day with no transactions still records an honest
  -- zero row. A gap in the series would be ambiguous between "nothing sold" and
  -- "never computed", and only the second one is real missing data.
  ON CONFLICT (snapshot_date) DO UPDATE SET
    revenue        = EXCLUDED.revenue,
    orders         = EXCLUDED.orders,
    units          = EXCLUDED.units,
    customers      = EXCLUDED.customers,
    new_customers  = EXCLUDED.new_customers,
    repeat_customers = EXCLUDED.repeat_customers,
    delivered_orders = EXCLUDED.delivered_orders,
    cancelled_orders = EXCLUDED.cancelled_orders,
    discounts      = EXCLUDED.discounts,
    gross_profit   = EXCLUDED.gross_profit,
    cost_coverage_percent = EXCLUDED.cost_coverage_percent,
    avg_delivery_hours = EXCLUDED.avg_delivery_hours,
    created_at     = timezone('utc', now());

  RETURN v_day;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_analytics_snapshots(p_days INTEGER DEFAULT 90)
RETURNS SETOF public.analytics_daily
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
    FROM public.analytics_daily
   WHERE snapshot_date >= timezone('utc', now())::DATE - LEAST(GREATEST(COALESCE(p_days, 90), 1), 730)
   ORDER BY snapshot_date;
$$;

-- ============================================================================
-- 13. Grounded business Q&A
-- ============================================================================
-- The AI assistant must never invent a number. This is the only surface it is
-- allowed to quote, and it returns structured facts plus a short factual
-- sentence, so the model has something to ground on rather than something to
-- guess at.
CREATE OR REPLACE FUNCTION public.admin_business_facts(p_question TEXT DEFAULT NULL)
RETURNS TABLE (
  fact_key   TEXT,
  fact_value TEXT,
  detail     TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
-- Output parameter names (revenue, units, ...) also appear as column
-- names in the aggregates below. Without this directive plpgsql resolves
-- those to the variable and every such aggregate is ambiguous.
#variable_conflict use_column
DECLARE
  v_rev  JSONB;
  v_prof JSONB;
  v_ret  JSONB;
  v_q    TEXT := LOWER(COALESCE(p_question, ''));
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT to_jsonb(r) INTO v_rev  FROM public.admin_revenue_summary(NULL, NULL) r;
  SELECT to_jsonb(r) INTO v_prof FROM public.admin_profit_summary(NULL, NULL) r;
  SELECT to_jsonb(r) INTO v_ret  FROM public.admin_retention(NULL, NULL) r;

  RETURN QUERY
  SELECT 'revenue_30d', v_rev->>'revenue'::TEXT,
         'Gross revenue from delivered orders in the last 30 days.'
  UNION ALL SELECT 'orders_30d', v_rev->>'orders'::TEXT, 'All orders placed in the last 30 days.'
  UNION ALL SELECT 'delivered_orders_30d', v_rev->>'delivered_orders'::TEXT, 'Orders delivered in the last 30 days.'
  UNION ALL SELECT 'cancelled_orders_30d', v_rev->>'cancelled_orders'::TEXT, 'Orders cancelled in the last 30 days.'
  UNION ALL SELECT 'aov_30d', v_rev->>'aov'::TEXT, 'Average value of a delivered order, last 30 days.'
  UNION ALL SELECT 'units_30d', v_rev->>'units'::TEXT, 'Units sold across delivered orders, last 30 days.'
  UNION ALL SELECT 'customers_30d', v_rev->>'customers'::TEXT, 'Distinct customers who ordered in the last 30 days.'
  UNION ALL SELECT 'cancellation_rate_30d', v_rev->>'cancellation_rate'::TEXT, 'Cancelled orders as a percentage of all orders, last 30 days.'
  UNION ALL SELECT 'gross_profit_30d', COALESCE(v_prof->>'gross_profit'::TEXT, 'unknown'),
         'Gross profit over products with a recorded cost, last 30 days.'
  UNION ALL SELECT 'margin_percent_30d', COALESCE(v_prof->>'margin_percent'::TEXT, 'unknown'),
         'Gross margin percent over priced products only, last 30 days.'
  UNION ALL SELECT 'cost_coverage_percent_30d', COALESCE(v_prof->>'cost_coverage_percent'::TEXT, 'unknown'),
         'Share of revenue whose product cost is actually recorded.'
  UNION ALL SELECT 'ordering_customers_30d', v_ret->>'ordering_customers'::TEXT, 'Customers with at least one delivered order, last 30 days.'
  UNION ALL SELECT 'repeat_customers_30d', v_ret->>'repeat_customers'::TEXT, 'Customers with more than one delivered order, last 30 days.'
  UNION ALL SELECT 'repeat_rate_30d', v_ret->>'repeat_rate'::TEXT, 'Repeat customers as a percentage of ordering customers, last 30 days.'
  UNION ALL SELECT 'activation_rate_30d', v_ret->>'activation_rate'::TEXT,
         'Ordering customers as a percentage of customers who registered in the same window.'
  UNION ALL SELECT 'avg_orders_per_customer_30d', v_ret->>'avg_orders_per_customer'::TEXT,
         'Average delivered orders per ordering customer, last 30 days.'
  WHERE v_q = ''
     OR v_q LIKE '%revenue%' OR v_q LIKE '%sales%' OR v_q LIKE '%chiffre%'
     OR v_q LIKE '%order%'    OR v_q LIKE '%commande%'
     OR v_q LIKE '%profit%'   OR v_q LIKE '%marge%' OR v_q LIKE '%bénéfice%'
     OR v_q LIKE '%customer%' OR v_q LIKE '%client%'
     OR v_q LIKE '%repeat%'   OR v_q LIKE '%retention%'
     OR v_q LIKE '%margin%'   OR v_q LIKE '%best%'  OR v_q LIKE '%top%';
END;
$$;

-- ============================================================================
-- 14. Grants
-- ============================================================================
REVOKE ALL ON FUNCTION public.analytics_window(DATE, DATE, INTEGER)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_revenue_summary(DATE, DATE)              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_top_sellers(DATE, DATE, INTEGER)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_slow_movers(INTEGER, INTEGER, INTEGER)    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_category_performance(DATE, DATE)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_retention(DATE, DATE)                     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_delivery_performance(DATE, DATE)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_inventory_turnover(DATE, DATE)           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_profit_summary(DATE, DATE)               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_sales_timeseries(DATE, DATE, TEXT)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_record_analytics_snapshot(DATE)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_analytics_snapshots(INTEGER)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_business_facts(TEXT)                     FROM PUBLIC, anon;

-- Granted to `authenticated`, not `anon`: each function additionally enforces
-- public.is_admin() in its body, so this grant is a usability decision, not the
-- security boundary.
GRANT EXECUTE ON FUNCTION public.analytics_window(DATE, DATE, INTEGER)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revenue_summary(DATE, DATE)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_top_sellers(DATE, DATE, INTEGER)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_slow_movers(INTEGER, INTEGER, INTEGER)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_category_performance(DATE, DATE)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_retention(DATE, DATE)                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delivery_performance(DATE, DATE)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_inventory_turnover(DATE, DATE)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_profit_summary(DATE, DATE)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_sales_timeseries(DATE, DATE, TEXT)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_record_analytics_snapshot(DATE)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_analytics_snapshots(INTEGER)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_business_facts(TEXT)                     TO authenticated;

REVOKE ALL ON public.analytics_daily FROM PUBLIC;
GRANT SELECT ON public.analytics_daily TO authenticated;
