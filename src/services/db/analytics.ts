import type {
  AnalyticsBundle,
  AnalyticsDailySnapshot,
  AnalyticsBucket,
  BusinessFact,
  CategoryPerformance,
  DeliveryPerformance,
  InventoryTurnover,
  ProfitSummary,
  RetentionSummary,
  RevenueSummary,
  SalesTimeseriesPoint,
  SlowMover,
  TopSeller,
} from "../../types";
import { isDemoMode, isSupabaseConfigured, supabase } from "./index";

// ---------------------------------------------------------------------------
// P12 — Analytics & business intelligence data layer
//
// Every function here is a thin, typed pass-through to a `SECURITY DEFINER`
// RPC that enforces `public.is_admin()` in SQL. The admin dashboard is not an
// authorization boundary, so the guard lives in the database, not in this file
// and not in the component.
//
// Demo mode returns zeroed, honest numbers rather than illustrative ones. A
// demo that shows $12,480 of revenue teaches an admin to expect numbers that
// do not exist; empty is the truthful state for a shop with no transactions.
// ---------------------------------------------------------------------------

const notConfigured = () => {
  throw new Error("DLXSTORE is not configured.");
};

const noAnalytics = () => {
  if (!isDemoMode) notConfigured();
};

/** Postgres numeric/bigint columns arrive as strings over the wire. */
const num = (value: unknown): number => {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Nullable numeric: unknown stays unknown. */
const numOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const str = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T[]> {
  const { data, error } = await supabase!.rpc(name, args ?? {});
  if (error) throw new Error(error.message || `Unable to load ${name}.`);
  return (Array.isArray(data) ? data : data ? [data] : []) as T[];
}

const EMPTY_SUMMARY: RevenueSummary = {
  revenue: 0,
  orders: 0,
  delivered_orders: 0,
  cancelled_orders: 0,
  units: 0,
  customers: 0,
  aov: 0,
  discounts: 0,
  cancellation_rate: 0,
  avg_order_value: 0,
};

const EMPTY_PROFIT: ProfitSummary = {
  revenue: 0,
  cost_of_goods: 0,
  gross_profit: null,
  margin_percent: null,
  cost_coverage_percent: null,
  unpriced_product_count: 0,
};

const EMPTY_RETENTION: RetentionSummary = {
  registered_customers: 0,
  ordering_customers: 0,
  repeat_customers: 0,
  new_customers: 0,
  repeat_rate: 0,
  activation_rate: 0,
  avg_orders_per_customer: 0,
  repeat_revenue_share: 0,
};

export async function getRevenueSummary(
  from?: string,
  to?: string,
): Promise<RevenueSummary | null> {
  if (!isSupabaseConfigured || !supabase) {
    noAnalytics();
    return { ...EMPTY_SUMMARY };
  }
  const rows = await rpc<Record<string, unknown>>("admin_revenue_summary", {
    p_from: from ?? null,
    p_to: to ?? null,
  });
  const row = rows[0];
  if (!row) return null;
  return {
    revenue: num(row.revenue),
    orders: num(row.orders),
    delivered_orders: num(row.delivered_orders),
    cancelled_orders: num(row.cancelled_orders),
    units: num(row.units),
    customers: num(row.customers),
    aov: num(row.aov),
    discounts: num(row.discounts),
    cancellation_rate: num(row.cancellation_rate),
    avg_order_value: num(row.avg_order_value),
  };
}

export async function getProfitSummary(
  from?: string,
  to?: string,
): Promise<ProfitSummary | null> {
  if (!isSupabaseConfigured || !supabase) {
    noAnalytics();
    return { ...EMPTY_PROFIT };
  }
  const rows = await rpc<Record<string, unknown>>("admin_profit_summary", {
    p_from: from ?? null,
    p_to: to ?? null,
  });
  const row = rows[0];
  if (!row) return null;
  return {
    revenue: num(row.revenue),
    cost_of_goods: num(row.cost_of_goods),
    gross_profit: numOrNull(row.gross_profit),
    margin_percent: numOrNull(row.margin_percent),
    cost_coverage_percent: numOrNull(row.cost_coverage_percent),
    unpriced_product_count: num(row.unpriced_product_count),
  };
}

export async function getRetentionSummary(
  from?: string,
  to?: string,
): Promise<RetentionSummary | null> {
  if (!isSupabaseConfigured || !supabase) {
    noAnalytics();
    return { ...EMPTY_RETENTION };
  }
  const rows = await rpc<Record<string, unknown>>("admin_retention", {
    p_from: from ?? null,
    p_to: to ?? null,
  });
  const row = rows[0];
  if (!row) return null;
  return {
    registered_customers: num(row.registered_customers),
    ordering_customers: num(row.ordering_customers),
    repeat_customers: num(row.repeat_customers),
    new_customers: num(row.new_customers),
    repeat_rate: num(row.repeat_rate),
    activation_rate: num(row.activation_rate),
    avg_orders_per_customer: num(row.avg_orders_per_customer),
    repeat_revenue_share: num(row.repeat_revenue_share),
  };
}

export async function getSalesTimeseries(
  from?: string,
  to?: string,
  bucket: AnalyticsBucket = "day",
): Promise<SalesTimeseriesPoint[]> {
  if (!isSupabaseConfigured || !supabase) {
    noAnalytics();
    return [];
  }
  const rows = await rpc<Record<string, unknown>>("admin_sales_timeseries", {
    p_from: from ?? null,
    p_to: to ?? null,
    p_bucket: bucket,
  });
  return rows.map((row) => ({
    bucket: str(row.bucket),
    revenue: num(row.revenue),
    orders: num(row.orders),
    units: num(row.units),
  }));
}

export async function getCategoryPerformance(
  from?: string,
  to?: string,
): Promise<CategoryPerformance[]> {
  if (!isSupabaseConfigured || !supabase) {
    noAnalytics();
    return [];
  }
  const rows = await rpc<Record<string, unknown>>("admin_category_performance", {
    p_from: from ?? null,
    p_to: to ?? null,
  });
  return rows.map((row) => ({
    category_id: str(row.category_id),
    category_name: str(row.category_name),
    units: num(row.units),
    revenue: num(row.revenue),
    orders: num(row.orders),
    revenue_share: num(row.revenue_share),
    product_count: num(row.product_count),
  }));
}

export async function getTopSellers(
  from?: string,
  to?: string,
  limit = 10,
): Promise<TopSeller[]> {
  if (!isSupabaseConfigured || !supabase) {
    noAnalytics();
    return [];
  }
  const rows = await rpc<Record<string, unknown>>("admin_top_sellers", {
    p_from: from ?? null,
    p_to: to ?? null,
    p_limit: limit,
  });
  return rows.map((row) => ({
    product_id: str(row.product_id),
    product_name: str(row.product_name),
    sku: str(row.sku),
    units: num(row.units),
    revenue: num(row.revenue),
    profit: numOrNull(row.profit),
    in_stock: num(row.in_stock),
  }));
}

export async function getSlowMovers(
  days = 90,
  minUnits = 1,
  limit = 10,
): Promise<SlowMover[]> {
  if (!isSupabaseConfigured || !supabase) {
    noAnalytics();
    return [];
  }
  const rows = await rpc<Record<string, unknown>>("admin_slow_movers", {
    p_days: days,
    p_min_units: minUnits,
    p_limit: limit,
  });
  return rows.map((row) => ({
    product_id: str(row.product_id),
    product_name: str(row.product_name),
    sku: str(row.sku),
    stock_quantity: num(row.stock_quantity),
    units_sold: num(row.units_sold),
    stock_value: numOrNull(row.stock_value),
    idle_days: num(row.idle_days),
  }));
}

export async function getDeliveryPerformance(
  from?: string,
  to?: string,
): Promise<DeliveryPerformance[]> {
  if (!isSupabaseConfigured || !supabase) {
    noAnalytics();
    return [];
  }
  const rows = await rpc<Record<string, unknown>>("admin_delivery_performance", {
    p_from: from ?? null,
    p_to: to ?? null,
  });
  return rows.map((row) => ({
    delivery_status: str(row.delivery_status, "unassigned"),
    orders: num(row.orders),
    avg_hours_to_complete: num(row.avg_hours_to_complete),
    max_hours_to_complete: num(row.max_hours_to_complete),
  }));
}

export async function getInventoryTurnover(
  from?: string,
  to?: string,
): Promise<InventoryTurnover[]> {
  if (!isSupabaseConfigured || !supabase) {
    noAnalytics();
    return [];
  }
  const rows = await rpc<Record<string, unknown>>("admin_inventory_turnover", {
    p_from: from ?? null,
    p_to: to ?? null,
  });
  return rows.map((row) => ({
    product_id: str(row.product_id),
    product_name: str(row.product_name),
    units_sold: num(row.units_sold),
    avg_stock: num(row.avg_stock),
    turnover_ratio: num(row.turnover_ratio),
    days_of_supply: numOrNull(row.days_of_supply),
    stock_on_hand: num(row.stock_on_hand),
  }));
}

/**
 * One round of the eleven reports. They are issued together rather than
 * sequentially so the whole board renders in a single batch instead of
 * serialising eleven round trips.
 */
export async function getAnalyticsBundle(
  from?: string,
  to?: string,
  bucket: AnalyticsBucket = "day",
): Promise<AnalyticsBundle> {
  const [summary, profit, retention, timeseries, categories, topSellers, slowMovers, delivery, turnover] =
    await Promise.all([
      getRevenueSummary(from, to),
      getProfitSummary(from, to),
      getRetentionSummary(from, to),
      getSalesTimeseries(from, to, bucket),
      getCategoryPerformance(from, to),
      getTopSellers(from, to, 10),
      getSlowMovers(90, 1, 10),
      getDeliveryPerformance(from, to),
      getInventoryTurnover(from, to),
    ]);

  return {
    summary,
    profit,
    retention,
    timeseries,
    categories,
    topSellers,
    slowMovers,
    delivery,
    turnover,
  };
}

export async function getAnalyticsSnapshots(
  days = 90,
): Promise<AnalyticsDailySnapshot[]> {
  if (!isSupabaseConfigured || !supabase) {
    noAnalytics();
    return [];
  }
  const rows = await rpc<Record<string, unknown>>("admin_get_analytics_snapshots", {
    p_days: days,
  });
  return rows.map((row) => ({
    snapshot_date: str(row.snapshot_date),
    revenue: num(row.revenue),
    orders: num(row.orders),
    units: num(row.units),
    customers: num(row.customers),
    new_customers: num(row.new_customers),
    repeat_customers: num(row.repeat_customers),
    delivered_orders: num(row.delivered_orders),
    cancelled_orders: num(row.cancelled_orders),
    discounts: num(row.discounts),
    gross_profit: numOrNull(row.gross_profit),
    cost_coverage_percent: numOrNull(row.cost_coverage_percent),
    avg_delivery_hours: numOrNull(row.avg_delivery_hours),
  }));
}

/**
 * Facts the AI assistant is allowed to quote. The assistant must answer from
 * this payload; anything not in it is an answer the assistant has to admit it
 * does not know.
 */
export async function getBusinessFacts(question?: string): Promise<BusinessFact[]> {
  if (!isSupabaseConfigured || !supabase) {
    noAnalytics();
    return [];
  }
  const rows = await rpc<Record<string, unknown>>("admin_business_facts", {
    p_question: question ?? null,
  });
  return rows.map((row) => ({
    fact_key: str(row.fact_key),
    fact_value: str(row.fact_value, "unknown"),
    detail: str(row.detail),
  }));
}
