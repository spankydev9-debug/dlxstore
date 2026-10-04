# Phase 11 (P11) — Growth & Loyalty Checkpoint

**Status:** COMPLETE (built and verified against local Postgres 15)
**Roadmap phase:** 17 — Growth & loyalty
**Migration:** `supabase/migrations/20261014090000_growth_loyalty_core.sql`
**Applied to:** local scratch Postgres only. **Not** applied to Supabase development or production.

---

## What was built

### 1. Points, with an append-only ledger

`points_ledger` is the source of truth; `customer_points` is a cached balance kept correct
by `rebuild_points_balance()`, which recomputes from the ledger rather than doing
`balance = balance + delta`. That makes the cache self-healing — it cannot drift, and it
repairs itself if it ever did.

Every award goes through one function, `award_points()`, and every award is keyed on
`(profile_id, reason, reference_id)` by a partial unique index. A retried webhook, a
re-delivered order or a double-click therefore **cannot** mint points twice.

Economics live in `loyalty_settings`, not in code, so tuning never needs a migration:

| Setting | Default | Meaning |
|---|---|---|
| `points_per_usd` | 0.2 | 1 point per 5 USD of delivered spend |
| `referral_referrer_pts` | 500 | paid to the inviter once the invite qualifies |
| `referral_referee_pts` | 250 | paid to the invitee once their order qualifies |
| `referral_signed_up_pts` | 100 | paid immediately on applying a code |
| `referral_min_order` | 25 | USD order value that qualifies a referral |
| `streak_day_points` | 10 | reserved for the Phase 9 streak integration |
| `recovery_discount_pct` | 10 | abandoned-cart recovery incentive |
| `cart_recovery_window_hours` | 72 | how long a cart stays recoverable |

### 2. Loyalty tiers and VIP benefits

`loyalty_tiers` — bronze / silver / gold / vip, each with `discount_percent`,
`free_shipping`, `early_access`, `birthday_bonus_points` and `points_multiplier`.

Tier is a **pure function of lifetime earned points** (`tier_for_points()`), so it cannot
drift from the ledger. Points multipliers mean earning accelerates with loyalty: a gold
member earns 1.5× on the same order a bronze member does.

### 3. Referral system

`referral_codes` (one immutable code per customer, minted on signup) and `referrals`.

Both self-referral and re-referral are rejected **in the database** (`CHECK (referrer_id <>
referee_id)` plus `UNIQUE (referee_id)`), not only in the UI. A referral pays out when the
referee places a delivered order at or above `referral_min_order`, and pays both sides
exactly once, keyed on the referral id.

A customer's own referral code is private to them (RLS `profile_id = auth.uid()`); codes
are shared out of band, which is the intended behaviour.

### 4. Flash sales, bundles, campaigns, personalised promotions

- `flash_sales` + `flash_sale_products` — time-boxed discounts with optional per-product
  override, stock limit and sold counter.
- `product_bundles` + `bundle_items` — bundle price versus the summed component prices,
  with computed savings.
- `campaigns` — channel (`in_app`/`whatsapp`/`push`/`email`) and segment targeting.
- `personalized_promotions` — per-customer or per-segment offers, dismissible.

`get_personalized_promotions()` resolves segments from the caller's live tier, and gold
members see both `gold` and `all` segments while VIP members additionally see `gold`.

### 5. Abandoned-cart recovery

`abandoned_carts` keeps **one open cart per customer**, enforced by a partial unique index
(`WHERE status = 'open'`), so re-visiting the shop updates the existing row and resets the
recovery window instead of creating duplicates. Wired into `CartContext` with a 2.5 s
debounce, gated on sign-in, and `clearCart()` marks the cart recovered.

### 6. Service layer — `src/services/db/loyalty.ts`

Read-only with respect to money. The customer-facing surface is reads plus three scoped
writes (apply a code, dismiss a promo, record a cart). `award_points()` is **not granted to
`authenticated` at all** — points are minted only by the order/referral triggers or by an
explicit admin adjustment.

### 7. UI — `src/components/account/LoyaltyPanel.tsx`

Tier card with progress toward the next tier, benefits, points history, referral code with
copy, referral stats, code entry, targeted offers, flash sales, bundles and a cart-recovery
banner. Wired as a `loyalty` dashboard tab. Fully responsive with no breakpoint gating.

### 8. i18n

41 new keys across all six languages (fr, en, sw, ln, tl, kg). Also fixed a pre-existing
hardcoded English `"Privacy"` nav label, now `t.privacyTab`.

---

## Verification

### Gates

| Check | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| `eslint` (touched files) | 0 errors, 5 warnings — all the pre-existing `set-state-in-effect` pattern used across the app |
| `next build` | PASS, 25/25 pages |
| Migration applies | PASS |
| Migration re-applies (idempotency) | PASS, 0 errors |

### Behavioural tests against live Postgres

Run as `authenticated` with `request.jwt.claim.sub` set to real fixture users.

| # | Scenario | Expected | Result |
|---|----------|----------|--------|
| 1 | Profile insert fires trigger | balance row + referral code | ✅ |
| 2 | Points before delivery | 0 | ✅ 0 |
| 3 | `$100` order delivered (bronze) | 20 pts | ✅ 20 |
| 4 | Trigger re-fired 3× | no double award | ✅ 20, 1 ledger row |
| 5 | Lifetime 2000 | tier gold | ✅ gold |
| 6 | `$100` order delivered (gold, ×1.5) | 30 pts | ✅ 2030 |
| 7 | Order inserted directly as `delivered` | awards points | ✅ (bug found + fixed) |
| 8 | Apply another customer's code | ok | ✅ ok |
| 9 | Apply own code | rejected | ✅ |
| 10 | Apply bogus code | rejected | ✅ |
| 11 | Order below `referral_min_order` | not qualified | ✅ pending, referrer 0 |
| 12 | `$40` qualifying order | both sides paid once | ✅ referrer 500, referee 360 |
| 13 | Re-delivery | no double referral payout | ✅ referrer still 500, 1 ledger row |
| 14 | Cart tracked twice | one open row, subtotal updated | ✅ 1 row, 30.00 |
| 15 | Customer calls `admin_adjust_points` | raises | ✅ `ERROR: Admin access required` |
| 16 | Admin calls `admin_adjust_points` | allowed | ✅ |
| 17 | Over-redeem | balance clamps at 0 | ✅ 0 |
| 18 | `award_points` executable by `authenticated` | **false** | ✅ false |
| 19 | `get_loyalty_summary` by `anon` | **false** | ✅ false |
| 20 | Cart recovery readable by `anon` | **false** | ✅ false |
| 21 | Flash sales readable by `anon` | true (deliberate) | ✅ true |

Fixtures were deleted after the run.

---

## Defects found and fixed during verification

The first draft of the migration passed `tsc`/ESLint/`next build` and was still wrong in
five ways. None were visible to the toolchain.

1. **Points never awarded for orders inserted as `delivered`.** The triggers were
   `AFTER UPDATE` only, so an order created directly in a delivered state — admin entry, an
   import, a backfill — silently earned nothing. Changed to `AFTER INSERT OR UPDATE` with a
   `TG_OP` guard so the double-delivery case is still skipped.
2. **Admin RPCs were uncallable.** Every function was `REVOKE`d from `PUBLIC, anon` but
   never explicitly `GRANT`ed, so `admin_adjust_points` and `admin_loyalty_overview` were
   unreachable. Relying on Supabase's default ACL is exactly the fragility recorded in the
   Phase 4 Streaks and Phase 13 Discover findings; grants are now explicit, as are table
   grants.
3. **`ORDER BY savings_percent` did not compile.** In a `RETURNS TABLE` function the output
   column names are parameters, not columns, so the alias is out of scope for `ORDER BY`.
   The expression is repeated instead.
4. **Invalid `UNIQUE (profile_id) WHERE status = 'open'`** in `CREATE TABLE` — a conditional
   constraint is a partial *index*, which must be a separate statement.
5. **Ambiguous `code` reference** in `get_referrals()`, where `code` is also an output
   column name.

Two further errors were caught by the scratch database disagreeing with `supabase/schema.sql`:
`product_images.is_primary` and the baseline `products`/`orders` columns. Those were
**scratch-environment** defects, not migration defects — `discount_price` and the delivery
address columns are used by already-applied production migrations and throughout
`src/types`. The scratch tables were aligned to the authoritative schema rather than the
migration being weakened to match a stand-in.

---

## What was deliberately NOT done

- **No redemption checkout flow.** Points can be debited via `award_points(..., 'redemption',
  ...)` and the balance clamps at zero, but there is no "spend points" UI or order integration.
  That is a commerce-flow change, not a loyalty change, and is left for a follow-up.
- **No birthday reward automation.** `birthday_month` / `birthday_day` are stored (month and
  day only — see below) and `birthday_bonus_points` exists per tier, but no scheduled job
  awards the bonus. Requires a cron/pg_cron decision.
- **No WhatsApp or push delivery of campaigns.** The `campaigns` table models the channel but
  Phase 19 is where outbound messaging belongs.
- **No admin UI** for flash sales, bundles or campaigns. The schema, RLS and RPCs are ready;
  the admin screens are not built.

### Privacy decision: no birth year

`profiles.birthday_month` and `birthday_day` are stored **without a birth year**. Storing a
full date of birth for a customer base in Goma is a privacy liability, and the birthday bonus
and birthday message need neither the year nor the age.

---

## Operator actions required

1. Read the remote migration ledger from production Supabase.
2. Obtain explicit operator approval.
3. Apply `20261014090000_growth_loyalty_core.sql` to the Supabase **development**
   environment first and re-run the behavioural matrix above.
4. Apply to production only after development verification.
5. Optionally seed `flash_sales`, `product_bundles` and `personalized_promotions` rows —
   the tables ship empty, so the panels render their empty states until an admin creates
   content.

**Production Supabase ref:** `szhkesvvrgcxbxucodzz`
**Development Supabase ref:** `spohxxumrstslwyynufz`
