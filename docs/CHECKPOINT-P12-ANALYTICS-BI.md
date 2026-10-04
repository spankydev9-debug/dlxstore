# Phase 12 (P12) — Analytics & Business Intelligence Checkpoint

Date: 2026-10-03
Roadmap phase: 18
Status: **complete, locally verified, unapplied to any remote database**

---

## What was built

### 1. Cost of goods, so profit is real

`supabase/migrations/20261015090000_analytics_bi_core.sql` adds
`products.cost_price NUMERIC CHECK (cost_price IS NULL OR cost_price >= 0)`.

The column is **nullable on purpose**. A product whose purchase cost nobody has
entered keeps `NULL`. Aggregates therefore exclude it and report
`cost_coverage_percent` alongside the margin, because the alternative — treating
unknown cost as zero — is exactly how an analytics layer invents profit.

### 2. Every metric is SQL, never client-side arithmetic

Twelve admin-gated `SECURITY DEFINER` functions compute all figures from the
transactional tables (`orders`, `order_items`, `products`, `deliveries`,
`profiles`, `inventory_history`):

| Function | Answers |
| --- | --- |
| `admin_revenue_summary` | revenue, orders, delivered, cancelled, units, customers, AOV, discounts, cancellation rate |
| `admin_profit_summary` | revenue, COGS, gross profit, margin %, cost coverage %, unpriced line count |
| `admin_top_sellers` | best sellers with units, revenue and per-product profit |
| `admin_slow_movers` | stocked products that did not sell, with stock value and idle days |
| `admin_category_performance` | revenue, units, orders and share per category |
| `admin_retention` | registered, ordering, repeat, new, repeat rate, activation rate, orders per customer, repeat revenue share |
| `admin_delivery_performance` | orders and average/max hours to complete per delivery status |
| `admin_inventory_turnover` | units sold, average stock, turnover ratio, days of supply |
| `admin_sales_timeseries` | bucketed revenue/orders/units (`day`/`week`/`month`/`quarter`/`year`) |
| `analytics_window` | shared date-range resolution, used by every report |
| `admin_business_facts` | the grounded fact set the assistant may quote |
| `admin_record_analytics_snapshot` / `admin_get_analytics_snapshots` | daily snapshots in `analytics_daily` |

Each one calls `public.is_admin()` in its body and raises
`Admin access required` otherwise. This mirrors the P10 finding that
`admin_get_reports` was readable by any customer: **the admin UI is not an
authorization boundary, the database is.** `REVOKE ... FROM PUBLIC, anon` is
followed by `GRANT ... TO authenticated` for each function, so the grant is a
usability decision and not the security boundary.

### 3. Honest reporting of missing data

- `gross_profit` and `margin_percent` are `NULL` when there is no covered
  revenue — not `0`.
- Per-product `profit` and `stock_value` are `NULL` when that product has no
  recorded cost.
- `days_of_supply` is `NULL` when nothing sold, rather than infinity.
- `admin_business_facts` returns the literal string `unknown` for any metric it
  cannot compute.
- The snapshot function records a **zero row for a day with no transactions**
  instead of skipping it, so a gap in the trend can never be ambiguous between
  "nothing sold" and "never computed".

### 4. Conversion is only reported where it is measured

DLXSTORE has no traffic or session tracking. `admin_retention` therefore reports
the funnel that genuinely exists — registered → ordered → repeat — and the UI
states this in `analyticsConversionNote`. No visitor-to-order rate is produced.

### 5. Service layer — `src/services/db/analytics.ts`

Typed pass-throughs for all twelve functions plus `getAnalyticsBundle`, which
issues the nine board reports with `Promise.all` so the dashboard renders in one
batch instead of serialising eleven round trips. Postgres `numeric`/`bigint`
arrive as strings over the wire, so `num()`/`numOrNull()` normalise them;
`numOrNull` is what preserves `NULL`. Demo mode returns **honest zeros**, not
illustrative figures — a demo showing invented revenue teaches an admin to
expect numbers that do not exist.

### 6. UI — `src/components/admin/AnalyticsDashboard.tsx`

Mounted inside the existing `analytics` tab of
`src/app/admin/dashboard/page.tsx`, below the pre-existing overview cards and
chart so nothing already working was replaced. Range selector (7/30/90 days),
bucket selector, refresh, and sections for: headline, profit with cost-coverage
warning, retention with the conversion caveat, sales trend bars, best sellers,
slow movers, category performance, delivery performance, inventory turnover.

Every metric that the shop has no data for renders as `—`, never `0`.

The **Business facts** panel calls `admin_business_facts` and renders the
returned facts with their explanatory `detail` text. It is deliberately not a
free-form LLM call: it can only display numbers the database computed, which is
the mechanical guarantee behind "answers must come from actual DLX data".

### 7. i18n

58 new keys across all six languages (`fr`, `en`, `sw`, `ln`, `tl`, `kg`). The
slash groups below are shorthand for separate keys, so the list reads as 54
entries but is 58 keys:
`analyticsBiTitle`, `analyticsRange7`/`analyticsRange30`/`analyticsRange90`,
`analyticsBucketDay`/`analyticsBucketWeek`/`analyticsBucketMonth`,
`analyticsLoading`, `analyticsLoadError`, `analyticsRefresh`, `analyticsRevenue`,
`analyticsOrders`, `analyticsDelivered`, `analyticsCancelled`,
`analyticsUnitsSold`, `analyticsCustomers`, `analyticsAov`,
`analyticsCancellationRate`, `analyticsProfitTitle`, `analyticsGrossProfit`,
`analyticsMargin`, `analyticsCostCoverage`, `analyticsCostCoverageHint`,
`analyticsNoCostData`, `analyticsRetentionTitle`, `analyticsRegistered`,
`analyticsOrderingCustomers`, `analyticsRepeatCustomers`,
`analyticsRepeatRate`, `analyticsActivationRate`, `analyticsAvgOrders`,
`analyticsRepeatRevenueShare`, `analyticsTopSellersTitle`,
`analyticsSlowMoversTitle`, `analyticsCategoryTitle`,
`analyticsDeliveryTitle`, `analyticsTurnoverTitle`,
`analyticsTimeseriesTitle`, `analyticsUnassigned`, `analyticsStockValue`,
`analyticsIdleDays`, `analyticsDaysOfSupply`, `analyticsTurnoverRatio`,
`analyticsAvgStock`, `analyticsNoData`, `analyticsUnits`, `analyticsShare`,
`analyticsProducts`, `analyticsAverage`, `analyticsMax`, `analyticsSalesVolume`,
`analyticsConversionNote`, `analyticsAskTitle`, `analyticsFactsTitle`,
`analyticsAskPlaceholder`, `analyticsAskBtn`, `analyticsFactsEmpty`,
`analyticsFactsUnknown`.

### 8. Types

P12 interfaces appended to `src/types/index.ts`. Nullable fields are typed
`number | null` with a comment stating why, so a future change cannot quietly
coerce unknown cost into zero.

---

## Verification

### Gates

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit -p tsconfig.json --incremental false` | pass, no output |
| `npx eslint` on all touched TS files | **0 errors**, 1 warning |
| `npx next build` | pass, 25/25 static pages |

The single warning is `react-hooks/set-state-in-effect` on the analytics fetch.
It is the same pattern already carried by the existing admin dashboard and is not
new to this codebase.

### Numeric correctness against live Postgres

Fixtures with independently checkable arithmetic: product **A** at 100 with cost
60, product **B** at 50 with **no** cost, and four orders (delivered 100,
delivered 50, cancelled 100, confirmed 100). All assertions pass:

```
PASS revenue=150        PASS orders=4        PASS delivered=2      PASS cancelled=1
PASS units=2            PASS customers=3    PASS aov=75           PASS cancel_rate=25.0
PASS cogs=60            PASS profit=40      PASS margin=40.0      PASS coverage=66.7
PASS unpriced_lines=1   PASS B profit NULL  PASS cat products=2
PASS ordering=1         PASS repeat=1       PASS repeat_rate=100.0
PASS avg_orders=2.0     PASS ts revenue=150 PASS ts orders=2      PASS ts units=2
PASS facts count=16     PASS snapshot rev=150
PASS snapshot single row                 PASS bad bucket rejected
```

`PASS B profit NULL` is the load-bearing one: product B sold real revenue and its
profit is `NULL`, proving unrecorded cost is excluded rather than zeroed.
`PASS coverage=66.7` shows the honest denominator — A's 100 of 150 revenue.

### Authorization and constraint checks

```
PASS admin reads 1 snapshot row
PASS customer sees 0 snapshots (RLS)
PASS anon blocked from analytics_daily
PASS anon blocked from admin_business_facts
PASS anon blocked from admin_get_analytics_snapshots
PASS negative cost_price rejected
PASS NULL cost_price allowed (unknown stays unknown)
PASS Admin access required  (customer -> admin_revenue_summary)
PASS Admin access required  (customer -> admin_business_facts)
PASS Admin access required  (customer -> admin_record_analytics_snapshot)
PASS permission denied for function admin_revenue_summary  (anon)
```

### Idempotency

The migration was applied to the local scratch database **three times with zero
errors**, including its own `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`,
`CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION` and
`DROP POLICY IF EXISTS`.

All fixtures were deleted afterwards; the cleanup query returned
`0|0|0|0|0`.

---

## Defects found and fixed during verification

1. **`%ROWTYPE` against a `RETURNS TABLE` function failed to compile.**
   `public.analytics_window%ROWTYPE` raised
   `relation "public.analytics_window" does not exist` because `%ROWTYPE`
   resolves against tables, views and named composite types — not against a
   function returning an anonymous record type. Replaced with explicitly typed
   variables, and `admin_business_facts` was switched to `to_jsonb(r)` extraction
   instead of declaring fifteen scalars.

2. **`inventory_history.quantity_changed` was wrong in three functions.**
   The first draft used `ih.quantity_change`. The authoritative column in
   `supabase/schema.sql` is `quantity_changed`. plpgsql does not resolve object
   references at creation time, so this would have failed only when an admin
   opened the page — a latent runtime error, now fixed and covered by execution
   tests.

3. **`admin_sales_timeseries` had an invalid correlated aggregate:**
   `subquery uses ungrouped column "o.id" from outer query`. Rewritten to resolve
   units per order in a `per_order` CTE before bucketing.

4. **`date_trunc` bucket was unvalidated.** An unexpected `p_bucket` reached
   function-name resolution. Now validated against
   `day|week|month|quarter|year`, verified by `PASS bad bucket rejected`.

5. **plpgsql name-capture broke four aggregates.**
   `column reference "revenue" is ambiguous` — `revenue` and `units` are
   `RETURNS TABLE` output parameters *and* column aliases inside the CTEs, so
   plpgsql resolved them to the variable. Fixed with
   `#variable_conflict use_column` on all twelve functions, documented inline.

6. **Two return-type mismatches.** `COUNT(DISTINCT p.id)` is `bigint` where the
   contract declares `INTEGER`, and `SUM()` over a `bigint` widens to `numeric`
   where `BIGINT` was promised. Both now cast explicitly.

7. **Stray non-Latin characters in an i18n value.** The Lingala
   `analyticsConversionNote` was written containing CJK characters
   (`Conversion e测量 nzembo…`). Corrected before the build.

8. **Bucket selector was mislabelled** — it reused the 7/30/90 range labels for
   day/week/month. Added `analyticsBucketDay/Week/Month` across all six
   languages.

---

## Scratch-database alignment (local only, not repository migrations)

The local scratch DB has drifted from the authoritative `supabase/schema.sql`.
To execute the delivery and turnover functions the following were patched in the
container **only**; none of these are repo changes and none weaken a migration:

- `order_items.price_at_sale` added (authoritative column, missing in scratch)
- `categories.description` added
- `inventory_history.quantity_changed` / `type` / `notes` added
- `deliveries` table created

The migration's column references were checked against `supabase/schema.sql`
first and are correct; the failures above were scratch divergence, not defects.

---

## What was deliberately NOT done

- **No visitor/session tracking, therefore no traffic conversion rate.** Adding a
  traffic source would be a P16 instrumentation decision, not an analytics guess.
- **No scheduled snapshot job.** `admin_record_analytics_snapshot` is callable
  but nothing invokes it on a timer, so `analytics_daily` stays empty until an
  operator or cron calls it. The UI reads live RPCs, not snapshots, so the board
  is correct today; only the historical snapshot table needs a scheduler.
- **No per-product cost editing UI.** `cost_price` must be set in SQL or the
  admin catalogue form; until then margin correctly reports low coverage.
- **No forecast or projection.** Analytics reports what happened.
- **The customer shopping assistant was not modified.** It answers product
  questions server-side; business grounding belongs to the admin board, and
  mixing an admin-only fact set into a shopper-facing endpoint would widen its
  blast radius.

---

## Operator actions required

1. **Apply `20261015090000_analytics_bi_core.sql` to production** after review.
   Remote application requires explicit approval; it has **not** been applied.
2. **Backfill `products.cost_price`.** Until a cost is recorded for a product,
   its profit is `NULL` and the shop-level margin covers only the priced share.
   The board shows `cost_coverage_percent` so this gap is visible rather than
   silent.
3. **Optional: schedule the snapshot.** Call
   `admin_record_analytics_snapshot()` daily from cron/pg_cron to populate
   `analytics_daily` history.
4. **Optional: review the `cost_price` grant** so catalogue editors can set cost
   without direct SQL access.
