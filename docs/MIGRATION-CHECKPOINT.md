# Production Migration Checkpoint

**Project:** `szhkesvvrgcxbxucodzz`
**Date:** 2026-10-04
**Status:** COMPLETE — 45 of 45 applied and verified. No pending migrations.

## Final migration state

| | Count | Latest |
|---|---|---|
| Applied on remote | 45 | `20261017093000` |
| Pending | 0 | — |
| Total in repo | 45 | `20261017093000` |

Ledger `supabase_migrations.schema_migrations` contains 45 rows, 45 distinct versions, earliest `20260816142900`, latest `20261017093000`. Gapless chronological prefix, no duplicate or repaired rows.

All 45 migrations are now applied. Schema: 86 tables, 161 policies, 85 RLS-enabled tables, 203 functions, 223 indexes, 28 application triggers.

## Pre-push backup (rollback baseline for the 40/45 state)

Taken after confirming production was at 40/45 and before applying migrations 14–18, so the baseline reflects the true pre-push state rather than the original pre-migration dump.

| File | Bytes | SHA-256 |
|---|---|---|
| `/tmp/dlxsupa/pre45/schema.sql` | 338,867 | `901205edbbda9809015d974b70e507e531cfc3ef3ffa95fac7ed39df1959149b` |
| `/tmp/dlxsupa/pre45/data.sql` | 192,384 | `9d9cb181386dae6aec6f84d54a37177cf03a2282c9bf562f3b104b76f1d22271` |

Independently verified by restoring both into a clean PostgreSQL 17.6 container: **0 errors** on each file, and every object count matched live production exactly — 61 tables, 123 policies, 61 RLS-enabled tables, 128 functions, 153 indexes, 20 application triggers. Row-for-row comparison across **all 61 tables: 734/734 rows, 0 mismatches**, including the key tables (orders 63, order_items 86, products 52, profiles 17, notifications 155, categories 15, product_images 114, inventory_history 93, messages 28, customer_avatars 2, deliveries 13).

The dump is a genuine pre-migration-14 baseline: it contains none of `loyalty_tiers`, `points_ledger`, `flash_sales`, `bundles`, `campaigns`, `message_outbox`, `message_templates`, `referrals`, and it holds 28 of the 37 tracked RPCs — the same 28 production had at 40/45, missing the same 9.

Note the earlier pre-migration backup in `/tmp/dlxsupa/prod_backup/` is retained but is **not** the current rollback baseline; it predates all 18 October migrations. The verification container was removed after use.

## Applying migrations 14–18

A gate confirmed `applied=40 pending=5`, gapless, with exactly the expected pending set before pushing. `supabase db push --yes --linked` then reported exit 0 and applied all five in chronological order with no `ERROR`, `FATAL`, or failure line anywhere in the output:

```
Applying migration 20261014090000_growth_loyalty_core.sql...
Applying migration 20261015090000_analytics_bi_core.sql...
Applying migration 20261016090000_communication_hub_core.sql...
Applying migration 20261017090000_marketplace_core.sql...
Applying migration 20261017093000_marketplace_supply.sql...
```

Nothing was skipped, reordered, forced, or repaired; `db repair` was never used.

### Post-push verification

| Check | Result |
|---|---|
| `supabase migration list --linked` | 45/45 applied, 0 pending, gapless, local == remote for all 45 |
| 37 previously-missing RPCs | **37/37 present**, none outstanding |
| The 9 outstanding after migration 13 | all present (loyalty summary, points history, referral code, referrals, active bundles, active flash sales, cart recovery offer, personalized promotions, message opt-ins) |
| `loyalty_tiers.id` default | `gen_random_uuid()` — the fix is live |
| `message_templates.id` default | `gen_random_uuid()` — the fix is live |
| `brands.id` default | still `uuid_generate_v4()`, untouched as intended |
| `profiles.is_active` | still absent; the `20260903000000` decision remains intact |
| Seed data | loyalty tiers `bronze,silver,gold,vip`; message templates across 6 locales / 4 keys |

Row-count integrity against the 40/45 baseline — no regressions:

| Table | at 40/45 | at 45/45 | |
|---|---|---|---|
| orders | 63 | 63 | OK |
| order_items | 86 | 86 | OK |
| products | 52 | 52 | OK |
| profiles | 17 | 17 | OK |
| notifications | 155 | 155 | OK |
| categories | 15 | 15 | OK |
| product_images | 114 | 114 | OK |
| inventory_history | 93 | 93 | OK |
| messages | 28 | 28 | OK |
| customer_avatars | 2 | 2 | OK |
| deliveries | 13 | 13 | OK |
| vendors | 1 | 1 | OK |
| reviews | 4 | 4 | OK |
| wishlist | 2 | 2 | OK |
| sessions | 5 | 5 | OK |

Total rows 734 → 782. The increase is entirely migrations 14–18 seeding new tables: `loyalty_tiers` 4 rows, `message_templates` 36 rows, `loyalty_settings` 8 rows. Migrations 14–18 created 25 new tables, all empty except those three seeded ones.

## Not done

## Fix applied to `20261013090000` — now live in production

The two offending predicates were removed from `20261013090000_safety_privacy_ui.sql` — 2 lines deleted, explanatory comments added, nothing else touched:

```
-    AND p.is_active = true     (search_profiles,        was line 479)
-    AND p.is_active = true     (get_friend_suggestions, was line 533)
```

This mirrors `20260903000000` exactly and loses no behaviour: the predicate was never load-bearing, because the column has never existed in any environment where these functions ran. Every other guard is intact — `search_profiles` keeps self-exclusion, name/username matching and the block check; `get_friend_suggestions` keeps self-exclusion plus existing-friend, pending-request and block exclusion.

Rejected alternatives:

- **Re-add `profiles.is_active`** — contradicts the explicit decision in `20260903000000`, makes that corrective migration false, and adds a column nothing ever writes (permanently `true`/`NULL`), i.e. a no-op filter plus a trap for whoever later assumes it means deactivation.
- **`supabase db repair` to skip the migration** — that is forcing, and would leave `search_profiles` and `get_friend_suggestions` absent, shipping the privacy feature broken.

`20261013090000` had no ledger row on any instance when it was edited, so the edit caused no history divergence; it has since been applied to production as migration 40 of 45. Regression suites re-run after applying it in the local Supabase harness: `p13_communication` **64 PASS / 0 FAIL**, `p14_marketplace` **97 PASS / 0 FAIL** (matching the documented baselines). `npx tsc --noEmit` exit 0; `npm run build` exit 0.
