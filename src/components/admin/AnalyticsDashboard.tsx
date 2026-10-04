"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Coins,
  DollarSign,
  PackageSearch,
  RefreshCw,
  Repeat,
  Search,
  ShoppingBag,
  Truck,
  Users,
} from "lucide-react";

import { useLanguage } from "../../context/LanguageContext";
import { formatMoney } from "../../lib/format";
import { getAnalyticsBundle, getBusinessFacts } from "../../services/db/analytics";
import type {
  AnalyticsBundle,
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
import { StatCard } from "./StatCard";

// ---------------------------------------------------------------------------
// P12 — admin business intelligence board.
//
// Reads exclusively from the P12 SECURITY DEFINER RPCs, so every figure here is
// computed in SQL from the transactional tables and re-checked against
// public.is_admin() on each call.
//
// One deliberate honesty rule runs through this file: a metric the shop has no
// data for renders as an explicit dash. Cost of goods is optional per product,
// so margin and profit are shown as unknown — with the coverage percentage
// beside them — rather than silently treating unrecorded cost as zero.
// ---------------------------------------------------------------------------

type RangeKey = "7" | "30" | "90";

const RANGES: { key: RangeKey; days: number; labelKey: "analyticsRange7" | "analyticsRange30" | "analyticsRange90" }[] = [
  { key: "7", days: 7, labelKey: "analyticsRange7" },
  { key: "30", days: 30, labelKey: "analyticsRange30" },
  { key: "90", days: 90, labelKey: "analyticsRange90" },
];

const unknown = "—";

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">
      <h3 className="flex items-center gap-2 font-bold text-base text-foreground">
        <Icon className="h-4 w-4 text-primary" />
        {title}
      </h3>
      {children}
    </div>
  );
}

function TableShell({
  head,
  empty,
  children,
}: {
  head: string[];
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      {head.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <table className="w-full min-w-[520px] text-left text-xs">
          <thead>
            <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
              {head.map((h) => (
                <th key={h} className="py-2 pr-3 font-bold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">{children}</tbody>
        </table>
      )}
    </div>
  );
}

function BarChart({ points }: { points: SalesTimeseriesPoint[] }) {
  if (points.length === 0) return null;
  const max = Math.max(...points.map((p) => Number(p.revenue) || 0), 1);
  return (
    <div className="flex h-40 items-end gap-1" role="img" aria-label="Sales trend">
      {points.slice(-60).map((p) => {
        const height = Math.max(((Number(p.revenue) || 0) / max) * 100, 1);
        return (
          <div
            key={p.bucket}
            className="group relative min-w-[3px] flex-1 rounded-t bg-primary/25 transition-colors hover:bg-primary"
            style={{ height: `${height}%` }}
          >
            <span className="pointer-events-none absolute -top-7 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 text-[10px] font-bold text-background group-hover:block">
              {formatMoney(Number(p.revenue) || 0)} · {p.bucket}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function BusinessFacts() {
  const { t } = useLanguage();
  const [question, setQuestion] = useState("");
  const [facts, setFacts] = useState<BusinessFact[]>([]);
  const [asked, setAsked] = useState(false);
  const [loading, setLoading] = useState(false);

  const ask = useCallback(async () => {
    setLoading(true);
    try {
      setFacts(await getBusinessFacts(question.trim() || undefined));
      setAsked(true);
    } catch {
      setFacts([]);
      setAsked(true);
    } finally {
      setLoading(false);
    }
  }, [question]);

  return (
    <Section title={t.analyticsAskTitle} icon={Search}>
      <div className="flex flex-wrap gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void ask();
          }}
          placeholder={t.analyticsAskPlaceholder}
          aria-label={t.analyticsAskTitle}
          className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => void ask()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          {loading ? t.analyticsLoading : t.analyticsAskBtn}
        </button>
      </div>

      {asked && (
        <div className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            {t.analyticsFactsTitle}
          </p>
          {facts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.analyticsFactsEmpty}</p>
          ) : (
            <dl className="grid gap-2 sm:grid-cols-2">
              {facts.map((fact) => (
                <div key={fact.fact_key} className="rounded-lg border border-border/60 p-3">
                  <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {fact.fact_key.replace(/_/g, " ")}
                  </dt>
                  <dd className="text-base font-extrabold text-foreground">
                    {fact.fact_value === "unknown" ? t.analyticsFactsUnknown : fact.fact_value}
                  </dd>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{fact.detail}</p>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </Section>
  );
}

export function AnalyticsDashboard() {
  const { t } = useLanguage();
  const [range, setRange] = useState<RangeKey>("30");
  const [bucket, setBucket] = useState<AnalyticsBucket>("day");
  const [data, setData] = useState<AnalyticsBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const days = RANGES.find((r) => r.key === range)?.days ?? 30;
      const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
      const to = new Date().toISOString().slice(0, 10);
      setData(await getAnalyticsBundle(from, to, bucket));
    } catch (err) {
      setError(err instanceof Error ? err.message : t.analyticsLoadError);
    } finally {
      setLoading(false);
    }
  }, [range, bucket, t.analyticsLoadError]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary: RevenueSummary | null = data?.summary ?? null;
  const profit: ProfitSummary | null = data?.profit ?? null;
  const retention: RetentionSummary | null = data?.retention ?? null;
  const pct = (v: number | null | undefined) => (v === null || v === undefined ? unknown : `${v}%`);
  const money = (v: number | null | undefined) => (v === null || v === undefined ? unknown : formatMoney(v));

  return (
    <div className="space-y-8">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-bold text-base text-foreground">
          <BarChart3 className="h-4 w-4 text-primary" />
          {t.analyticsBiTitle}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-border">
            {RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setRange(r.key)}
                aria-pressed={range === r.key}
                className={`px-3 py-1.5 text-xs font-bold transition-colors ${
                  range === r.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {t[r.labelKey]}
              </button>
            ))}
          </div>
          <select
            value={bucket}
            onChange={(e) => setBucket(e.target.value as AnalyticsBucket)}
            aria-label={t.analyticsTimeseriesTitle}
            className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs font-bold text-foreground"
          >
            <option value="day">{t.analyticsBucketDay}</option>
            <option value="week">{t.analyticsBucketWeek}</option>
            <option value="month">{t.analyticsBucketMonth}</option>
          </select>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-foreground hover:bg-muted"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            {t.analyticsRefresh}
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm font-semibold text-destructive">
          {error}
        </p>
      )}

      {/* Headline */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t.analyticsRevenue}
          value={summary ? formatMoney(summary.revenue) : unknown}
          icon={DollarSign}
          iconClassName="h-4 w-4 text-emerald-500"
        />
        <StatCard
          label={t.analyticsOrders}
          value={summary ? summary.orders : unknown}
          icon={ShoppingBag}
          iconClassName="h-4 w-4 text-primary"
          hint={summary ? `${summary.delivered_orders} ${t.analyticsDelivered.toLowerCase()} · ${summary.cancelled_orders} ${t.analyticsCancelled.toLowerCase()}` : undefined}
        />
        <StatCard
          label={t.analyticsAov}
          value={summary ? formatMoney(summary.aov) : unknown}
          icon={Coins}
          iconClassName="h-4 w-4 text-blue-500"
          hint={summary ? `${summary.units} ${t.analyticsUnitsSold.toLowerCase()}` : undefined}
        />
        <StatCard
          label={t.analyticsCustomers}
          value={summary ? summary.customers : unknown}
          icon={Users}
          iconClassName="h-4 w-4 text-violet-500"
          hint={summary ? `${pct(summary.cancellation_rate)} ${t.analyticsCancellationRate.toLowerCase()}` : undefined}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Profit — never fabricates a margin from missing cost */}
        <Section title={t.analyticsProfitTitle} icon={Coins}>
          {profit ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t.analyticsGrossProfit}</p>
                  <p className="text-lg font-extrabold text-foreground">{money(profit.gross_profit)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t.analyticsMargin}</p>
                  <p className="text-lg font-extrabold text-foreground">{pct(profit.margin_percent)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t.analyticsCostCoverage}</p>
                  <p
                    className={`text-lg font-extrabold ${
                      profit.cost_coverage_percent !== null && profit.cost_coverage_percent < 80
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-foreground"
                    }`}
                  >
                    {pct(profit.cost_coverage_percent)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t.analyticsRevenue}</p>
                  <p className="text-lg font-extrabold text-foreground">{formatMoney(profit.revenue)}</p>
                </div>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">{t.analyticsCostCoverageHint}</p>
              {profit.unpriced_product_count > 0 && (
                <p className="flex items-center gap-1.5 rounded-lg bg-amber-500/10 p-2.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {profit.unpriced_product_count} · {t.analyticsNoCostData}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t.analyticsNoData}</p>
          )}
        </Section>

        {/* Retention */}
        <Section title={t.analyticsRetentionTitle} icon={Repeat}>
          {retention ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t.analyticsRegistered}</p>
                <p className="text-lg font-extrabold text-foreground">{retention.registered_customers}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t.analyticsOrderingCustomers}</p>
                <p className="text-lg font-extrabold text-foreground">{retention.ordering_customers}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t.analyticsRepeatCustomers}</p>
                <p className="text-lg font-extrabold text-foreground">{retention.repeat_customers}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t.analyticsRepeatRate}</p>
                <p className="text-lg font-extrabold text-foreground">{pct(retention.repeat_rate)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t.analyticsActivationRate}</p>
                <p className="text-lg font-extrabold text-foreground">{pct(retention.activation_rate)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t.analyticsAvgOrders}</p>
                <p className="text-lg font-extrabold text-foreground">{retention.avg_orders_per_customer}</p>
              </div>
              <p className="col-span-full text-[11px] leading-relaxed text-muted-foreground">
                {t.analyticsConversionNote}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t.analyticsNoData}</p>
          )}
        </Section>
      </div>

      {/* Trend */}
      <Section title={t.analyticsTimeseriesTitle} icon={BarChart3}>
        {loading && !data ? (
          <p className="text-sm text-muted-foreground">{t.analyticsLoading}</p>
        ) : (data?.timeseries.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">{t.analyticsNoData}</p>
        ) : (
          <BarChart points={data!.timeseries} />
        )}
      </Section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Best sellers */}
        <Section title={t.analyticsTopSellersTitle} icon={ShoppingBag}>
          <TableShell
            head={[t.analyticsProducts, t.analyticsUnits, t.analyticsRevenue, t.analyticsGrossProfit]}
            empty={t.analyticsNoData}
          >
            {(data?.topSellers.length ?? 0) === 0 ? null : (
              data!.topSellers.map((row: TopSeller) => (
                <tr key={row.product_id}>
                  <td className="py-2 pr-3 font-semibold text-foreground">{row.product_name}</td>
                  <td className="py-2 pr-3">{row.units}</td>
                  <td className="py-2 pr-3 font-semibold">{formatMoney(row.revenue)}</td>
                  <td className="py-2 pr-3">{money(row.profit)}</td>
                </tr>
              ))
            )}
          </TableShell>
        </Section>

        {/* Slow movers */}
        <Section title={t.analyticsSlowMoversTitle} icon={PackageSearch}>
          <TableShell
            head={[t.analyticsProducts, t.analyticsStockValue, t.analyticsIdleDays]}
            empty={t.analyticsNoData}
          >
            {(data?.slowMovers.length ?? 0) === 0 ? null : (
              data!.slowMovers.map((row: SlowMover) => (
                <tr key={row.product_id}>
                  <td className="py-2 pr-3 font-semibold text-foreground">
                    {row.product_name}
                    <span className="block text-[10px] font-normal text-muted-foreground">
                      {row.stock_quantity} · {row.units_sold} {t.analyticsUnits.toLowerCase()}
                    </span>
                  </td>
                  <td className="py-2 pr-3">{money(row.stock_value)}</td>
                  <td className="py-2 pr-3">{row.idle_days}</td>
                </tr>
              ))
            )}
          </TableShell>
        </Section>

        {/* Categories */}
        <Section title={t.analyticsCategoryTitle} icon={BarChart3}>
          <TableShell
            head={[t.analyticsCategoryTitle, t.analyticsRevenue, t.analyticsShare, t.analyticsProducts]}
            empty={t.analyticsNoData}
          >
            {(data?.categories.length ?? 0) === 0 ? null : (
              data!.categories.map((row: CategoryPerformance) => (
                <tr key={row.category_id}>
                  <td className="py-2 pr-3 font-semibold text-foreground">{row.category_name}</td>
                  <td className="py-2 pr-3">{formatMoney(row.revenue)}</td>
                  <td className="py-2 pr-3">{pct(row.revenue_share)}</td>
                  <td className="py-2 pr-3">{row.product_count}</td>
                </tr>
              ))
            )}
          </TableShell>
        </Section>

        {/* Delivery */}
        <Section title={t.analyticsDeliveryTitle} icon={Truck}>
          <TableShell
            head={["Status", t.analyticsOrders, `${t.analyticsAverage} (h)`, `${t.analyticsMax} (h)`]}
            empty={t.analyticsNoData}
          >
            {(data?.delivery.length ?? 0) === 0 ? null : (
              data!.delivery.map((row: DeliveryPerformance) => (
                <tr key={row.delivery_status}>
                  <td className="py-2 pr-3 font-semibold text-foreground">
                    {row.delivery_status === "unassigned" ? t.analyticsUnassigned : row.delivery_status}
                  </td>
                  <td className="py-2 pr-3">{row.orders}</td>
                  <td className="py-2 pr-3">{row.avg_hours_to_complete}</td>
                  <td className="py-2 pr-3">{row.max_hours_to_complete}</td>
                </tr>
              ))
            )}
          </TableShell>
        </Section>
      </div>

      {/* Turnover */}
      <Section title={t.analyticsTurnoverTitle} icon={PackageSearch}>
        <TableShell
          head={[t.analyticsProducts, t.analyticsUnitsSold, t.analyticsAvgStock, t.analyticsTurnoverRatio, t.analyticsDaysOfSupply]}
          empty={t.analyticsNoData}
        >
          {(data?.turnover.length ?? 0) === 0 ? null : (
            data!.turnover.map((row: InventoryTurnover) => (
              <tr key={row.product_id}>
                <td className="py-2 pr-3 font-semibold text-foreground">{row.product_name}</td>
                <td className="py-2 pr-3">{row.units_sold}</td>
                <td className="py-2 pr-3">{row.avg_stock}</td>
                <td className="py-2 pr-3 font-semibold">{row.turnover_ratio}</td>
                <td className="py-2 pr-3">{row.days_of_supply ?? unknown}</td>
              </tr>
            ))
          )}
        </TableShell>
      </Section>

      {/* Grounded Q&A — the only numbers the assistant is allowed to quote. */}
      <BusinessFacts />
    </div>
  );
}

export default AnalyticsDashboard;
