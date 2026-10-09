# CHECKPOINT — SEC-01: Confirmed Security Findings

**Status: 2 vulnerabilities FIXED AND VERIFIED · 1 confirmed already-fixed · 1 confirmed correct**

> **2026-10-09 UPDATE — these findings are LIVE IN PRODUCTION and the §8 checklist is obsolete.**
> Read-only SQL against `szhkesvvrgcxbxucodzz` confirms `20261011090000` and `20261011100000` are
> both in the remote ledger (production is 45/45, latest `20261017093000`) and both fixes are in
> effect: `get_shop_stats` and `quote_coupon` ACLs contain **no `anon`**. Coupon validation works for
> customers today — it is not broken. §6.2 is resolved: the live `is_admin()` body uses
> `role = 'admin'` (single quotes), so policies depending on it function. §5's count of 52 was a
> scratch-DB artefact; production holds 83 `anon=X` definers, of which only 18 lack an internal
> guard and 16 of those are `RETURNS trigger` (not callable via PostgREST). The remaining callable
> pair — `get_active_bundles`, `get_active_flash_sales` — is the intended public storefront read
> path and exposes only public retail prices. **No additional exposure found.** See
> `docs/CHECKPOINT-P4B-CART-SAFETY.md` §1.
**Branch:** `main` @ `e760c09` (uncommitted working tree)
**Scope:** ONLY the four already-documented findings. No broad audit was performed.
**Environment:** local scratch Supabase Postgres 17.6.1 (`supabase_db_dlxstore`,
port 54322). **No production database was touched.**

Every claim below was **tested by executing SQL as the `anon` / `authenticated`
roles**, not inferred from reading code. Transcripts are reproduced inline.

---

## 1. Finding 1 — `get_shop_stats` revenue exposure · ✅ FIXED AND VERIFIED

**Migration:** `supabase/migrations/20261011090000_partner_shop_stats_authorization.sql`

### Confirmed vulnerable (evidence)

`get_shop_stats(uuid)` is `SECURITY DEFINER`, has **no authorization check**, and
returns per-shop `total_revenue`. It was never granted or revoked, so Supabase's
platform default left `anon` with EXECUTE:

```
 proname     | prosecdef | proacl
 get_shop_stats | t     | {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
```

Exploit as `anon` with **no session and no JWT**:

```
BEGIN; SET LOCAL ROLE anon;
SELECT * FROM public.get_shop_stats('aaaaaaaa-...');
 product_count | total_orders | total_revenue
---------------+--------------+---------------
             1 |            1 |        999999
```

An anonymous caller read another shop's revenue. Because the function is SECURITY
DEFINER it runs with the definer's rights, so no table RLS policy can stop this.

### Why this was NOT a blanket revoke

The only browser caller is `src/services/db/partner-shops.ts:236`, used exclusively
by `PartnerControls.tsx`, rendered only from `/admin/dashboard`, which is gated on
`user.role === "admin"`. Revoking EXECUTE would break a legitimate operator screen
in order to hide a number from an admin already entitled to it. This is exactly why
`20261007090000_revoke_internal_helper_grants.sql` deferred it as an open decision.
**The fix scopes the data, not the function.**

- Admin → full numbers (**existing flow preserved exactly**)
- Shop owner (`vendors.profile_id = auth.uid()`) → their own numbers (new, intended)
- Anyone else, including anon → **no rows at all**

`auth.uid() IS NULL` is checked explicitly so anon cannot match a shop whose
`profile_id` is NULL — that column is nullable (`ON DELETE SET NULL`), so a deleted
owner leaves a NULL that must not be treated as a match.

The admin test is inline (`role = 'admin'`) rather than `public.is_admin()`, because
that helper is defined with `role = "admin"` (double quotes) in `20260816150230` and
`20260823132900`; using it here would make this fix silently non-functional.

### Verified after the fix

| Caller | Before | After |
|---|---|---|
| **anon** (no session) | `total_revenue = 999999` 🔴 | `ERROR: permission denied` ✅ |
| **authenticated, not owner** | `999999` 🔴 | **0 rows** ✅ |
| **owning vendor** | blocked | **999999** ✅ |
| **admin** (`PartnerControls`) | `999999` | **999999** ✅ **not broken** |

ACL after: `{postgres=X,authenticated=X,service_role=X}` — **no `anon`**.

---

## 2. Finding 2 — anonymous coupon readability · ✅ FIXED (and a worse bug found)

**Migration:** `supabase/migrations/20261011100000_coupon_validation_fix.sql`

### What the record said vs. what testing showed

Direct reads of `coupons` are **already protected**: the `Admins manage coupons`
policy gates on `is_admin()`, and testing confirmed anon and a signed-in non-admin
both read **0 rows**. So the *enumeration* half of this finding was already handled.

Testing the RPC, however, exposed **two defects worse than the documented one**.

### Defect A — `quote_coupon` was completely non-functional 🔴

`quote_coupon()` declares `RETURNS TABLE (id, code, type, value, min_order,
expires_at, discount)`. In PL/pgSQL every RETURNS TABLE column becomes an implicit
output variable, so bare column references in the body collide. There are **three**
collisions, each an independent hard error:

```
ERROR:  column reference "code" is ambiguous
DETAIL: It could refer to either a PL/pgSQL variable or a table column.
```

Reproduced as a **legitimate signed-in customer** applying a valid public coupon:

```
SELECT * FROM public.quote_coupon('WELCOME10', 100);
-> ERROR   (every call, every customer, every coupon)
```

This is worse than a leak: **coupon validation did not work at all**, and
`validateCoupon()` throws on any non-PGRST202 error, so every checkout applying a
coupon failed outright.

Fix: table-alias and qualify **every** column (`c.`, `o.`, `cr.`). The RPC's return
shape is unchanged, so the TypeScript client is unaffected — **no API change**.

Verified after the fix:

| Case | Result |
|---|---|
| Legit customer, valid `WELCOME10`, subtotal 100 | `WELCOME10 \| 10 \| 10.00` ✅ (correct 10%) |
| Legit customer, nonexistent code | 0 rows, no error ✅ |
| Attacker guessing `SUMMER-SECRET` (campaign) | 0 rows ✅ |
| anon | `ERROR: permission denied` ✅ |

### Defect B — the `REVOKE ... FROM PUBLIC` never worked 🔴

```
quote_coupon -> {postgres=X,anon=X,authenticated=X,service_role=X}
```

`REVOKE ALL ... FROM PUBLIC` removes nothing under Supabase's platform default
privileges — exactly the mechanism `20261007090000` documents. Anon reached the
function body and was stopped only by the `auth.uid() IS NULL` guard *inside* it.
That is defence-in-depth working by accident of code order, not an authorization
boundary: any future edit reordering that guard re-exposes it.

Fixed with an explicit `REVOKE ... FROM anon`, keeping `authenticated` (legit
checkout caller) and `service_role` (server routes). ACL after:
`{postgres=X,authenticated=X,service_role=X}`.

---

## 3. Finding 3 — unsafe `main` INSERT policy · ✅ CONFIRMED ALREADY FIXED

No code change was needed. `20260928100000_notification_security_and_realtime.sql`
drops `"Authenticated users can insert notifications"` and creates only SELECT and
UPDATE policies. Verified by attack, not by reading the migration:

| Attack | Result |
|---|---|
| Authenticated attacker inserts into the admin's notifications | `ERROR: new row violates row-level security policy` ✅ |
| anon inserts | `ERROR: new row violates row-level security policy` ✅ |
| Attacker marks someone else's notification read | `UPDATE 0` ✅ |

Notification creation remains database-owned via SECURITY DEFINER triggers.

---

## 4. Finding 4 — streak / internal helper grant hardening · ✅ CONFIRMED CORRECT

No change made; verified still correct as installed.

| Function | ACL | Verdict |
|---|---|---|
| `generate_reward_coupon_code` | `{postgres, service_role}` | ✅ internal |
| `social_profiles_are_blocked` | `{postgres, service_role}` | ✅ internal |
| `award_milestone_if_not_awarded` | `{postgres, service_role}` | ✅ internal |
| `check_purchase_milestones` | `{postgres, service_role}` | ✅ internal |
| `adjust_stock_on_order` | `{postgres, service_role}` | ✅ internal |
| `build_streak_state` | `{postgres, service_role}` | ✅ internal |
| `notify_on_streak_milestone` | `{postgres, service_role}` | ✅ trigger fn |
| `record_streak_activity` | `{postgres, authenticated, service_role}` | ✅ legit browser |
| `get_my_streak` | `{postgres, authenticated, service_role}` | ✅ legit browser |

The originally proven exploit no longer works, and legitimate browser access was
**not** broken by over-revoking:

```
anon:  SELECT generate_reward_coupon_code('FREE', <uuid>);
       -> ERROR: permission denied for function generate_reward_coupon_code
anon:  SELECT social_profiles_are_blocked(<a>, <b>);
       -> ERROR: permission denied
customer: SELECT count(*) FROM public.get_my_streak();
       -> 1   (works, no error)
```

---

## 5. Newly discovered — NOT fixed, out of scope, documented

While confirming the above, a regression sweep over the same database showed:

```
SELECT count(*) FROM pg_proc ... WHERE prosecdef AND proacl LIKE '%anon=X%';
 -> 52
```

**52 SECURITY DEFINER functions in `public` still hold `anon=X`.** Most come from
migrations that are **unapplied** in this environment (chat conversation functions,
AI catalog, visual studio) plus older foundations. This is the same class as the
`quote_coupon` grant defect and **will matter once those migrations are applied**.

Deliberately **not** fixed here: the brief scoped this task to four confirmed
findings and forbade a broad audit. Each of these needs its own review — several are
genuinely reachable by an authenticated browser caller, and revoking them blindly
would break legitimate features. Tracked for the Safety/Privacy phase (roadmap
position 10).

---

## 6. Limitations of the local scratch environment

These are environment facts, **not** code defects and **not** security findings:

1. **Schema drift.** The scratch DB is at an earlier migration state: `orders` uses
   `user_id`/`total`, and `order_items` uses `price`, where the migrations expect
   `customer_id`/`total_amount` and `price_at_sale`. `get_shop_stats` therefore
   errored on `o.total_amount` until I added the columns locally to reproduce the
   leak. Production may differ; **verify on a database restored from production
   state before concluding anything about column names.**
2. **`is_admin()` differs.** The scratch copy uses `role = 'admin'` (single quotes,
   correct). The repo migrations define it with `role = "admin"` (double quotes).
   Which form is live in production is unresolved, and it directly affects whether
   several RLS policies grant admin access at all. **Flagged for the Safety/Privacy
   phase.**
3. **Empty dataset.** The DB had no products, orders, vendors or coupons. I seeded
   three synthetic profiles (victim / attacker / admin), one vendor, one product,
   one order worth `999999`, and two coupons. **All test rows are local only.**
4. **No PostgREST.** Authorization was verified at the SQL role layer, which is the
   stronger primitive: PostgREST only ever executes as `anon` or `authenticated`
   with the caller's JWT claims, exactly as simulated via `SET LOCAL ROLE` plus
   `request.jwt.claims`.

---

## 7. Verification actually run

| Check | Result |
| --- | --- |
| Finding 1 exploit, pre-fix | Confirmed: anon read `total_revenue = 999999` |
| Finding 1 post-fix, 4 roles | All pass; admin flow unbroken |
| Finding 2 `quote_coupon`, pre-fix | Confirmed: `ERROR` for every customer |
| Finding 2 post-fix, 4 cases | All pass; 10% discount computed correctly |
| Finding 2 ACL | `anon` removed |
| Finding 3, 3 attacks | All blocked |
| Finding 4, 9 functions + exploit | Correct; no over-revocation |
| `npx tsc --noEmit` | **0 errors** |
| Project source changes | **None** — both fixes are SQL-only |
| Production migrations applied | **None** |

No `src/` file was modified: both vulnerabilities were database-layer, and the
existing TypeScript clients work unchanged once the RPCs are corrected.

## 8. Activation checklist

1. Audit the remote migration ledger; obtain explicit operator approval.
2. Restore a production-shaped database locally and **re-run both exploits** — the
   scratch schema drift (§6.1) means the column names must be confirmed there.
3. Apply `20261011100000_coupon_validation_fix.sql` **first**. It restores coupon
   validation, which is currently broken for every customer.
4. Apply `20261011090000_partner_shop_stats_authorization.sql`.
5. Verify the `is_admin()` body actually live (§6.2) before relying on any policy
   that depends on it.
6. Track the 52-function `anon=X` sweep (§5) into the Safety/Privacy phase.
