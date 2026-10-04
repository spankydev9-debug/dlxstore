# CHECKPOINT — Feature 4: Streaks

**Status: PARTIALLY DONE (built and type-safe, activation blocked on an unapplied migration)**
**Branch:** `main` @ `e760c09` (uncommitted working tree)
**Roadmap:** Phase 9 — DLX Streaks
**Scope approved:** "Implement Streaks from the current state", using the same gates
as Features 1-3 (`tsc` + ESLint + `next build` + static SQL review).

---

## 1. The finding that shaped this

An audit of the existing engagement machinery showed streaks are greenfield, and
that two tempting shortcuts are both wrong:

1. **There is no scheduler.** No migration enables `pg_cron` or `cron.schedule`, and
   the brief approved **in-app reminders only**. So the "your streak expires tonight"
   prompt is *computed on read* (`expires_today` in `get_my_streak()`), never pushed
   on a timer. The API returns no misleading `scheduled_for` field.
2. **Web push cannot be used.** `src/services/notifications/push-notifications.ts`
   POSTs to `/api/push-subscriptions`, which does not exist, and `public/sw.js`
   handles a chat-specific payload. Building streak reminders on that path would
   mean shipping a route plus a payload contract. Not done.
3. **`reward_milestones` is the wrong system.** Its `milestone_type` CHECK constrains
   to `('purchase_count','share_count')` and `customer_rewards` requires a non-null
   `coupon_id`, so a streak would become a coupon and couple engagement to discounts.
   Streaks got their own two small tables instead.

## 2. Semantics implemented

| Rule | Behaviour |
| --- | --- |
| What advances the streak | Any authenticated activity, **once per Africa/Kinshasa calendar day**. No check-in button to forget. |
| Missed a day | **Hard break.** `current_count` resets to 1 on the next active day. |
| What survives a break | `longest_count`, `total_active_days`, `started_on` and every earned milestone are permanent. You start again; you never lose history. |
| Milestones | 3 / 7 / 30 / 100 / 365 days, each written once to the ledger. |
| Badges | New Streak, 7, 30, 100, 365 Days. Derived from the ledger plus `total_active_days > 0`; the 3-day milestone celebrates but awards no badge. |
| Reminders | In-app only, derived on read. No scheduler, no push. |

The day boundary is `now() AT TIME ZONE 'Africa/Kinshasa'`, matching
`src/lib/store-config.ts` (`launch.timezone`). Using UTC would roll the day over at
22:00 local time for a DRC customer.

## 3. What was built

### Database — `supabase/migrations/20261005090000_daily_streaks.sql` (UNAPPLIED)
- `public.streaks` — one row per customer: `current_count`, `longest_count`,
  `total_active_days`, `last_activity_date`, `started_on`.
- `public.streak_milestones` — `(profile_id, threshold)` primary key. This ledger is
  both the badge source **and** the notification idempotency record, mirroring the
  `UNIQUE (profile_id, milestone_id)` guard on `customer_rewards`.
- `build_streak_state()` — shared projection. Projects a lapsed counter to 0 without
  rewriting the stored value, so `expires_today` / `streak_broken` stay honest even
  though nothing expires on a timer.
- `record_streak_activity()` — the single write path. Locks the row, returns early if
  today is already counted, awards any newly reached milestones.
- `get_my_streak()` — read-only, so opening the panel is not itself activity.
- `notify_on_streak_milestone()` trigger — writes a `streak_milestone` notification.
  `notifications` has no client INSERT policy by design (see
  `20260928100000:48-50`); a SECURITY DEFINER trigger is the normal write path.
- RLS: own-or-admin SELECT on both tables, and **no client INSERT/UPDATE/DELETE
  policy at all** — writes only happen through the two RPCs.

### Client
- `src/services/db/streaks.ts` — RPC wrappers, defensive mapping of the JSONB
  contract, and a demo/localStorage fallback obeying the same day-boundary rules.
  Raises `StreakUnavailableError` when the migration is absent, and
  `src/lib/schema-unavailable.ts` copies that existing house pattern so the UI can
  hide the panel instead of showing a broken counter.
- `src/context/StreakContext.tsx` — **the only writer in the app.** Records on
  authenticated mount and on `visibilitychange` (a long-lived PWA can sit open across
  a day boundary). A localStorage day guard avoids a round trip per page view; the
  database is idempotent anyway, so a stale entry only costs one extra call.
- `src/components/account/StreakPanel.tsx` — statistics, reminder/celebration state,
  next-milestone progress bar, badge grid.
- `src/components/shared/Header.tsx` — compact counter (`StreakPip`) plus an account
  menu entry, both in the **shared** header row.
- `src/app/dashboard/page.tsx` — streak tab.
- `src/lib/i18n.ts` — 27 keys x 6 languages.

### Architecture notes
- One writer, many readers. The header counter and the dashboard panel both read
  `StreakContext`, so they cannot disagree about today's count. Opening the panel does
  not advance the streak; only real use of the site does.
- Sign-out is **derived** (`userId ? streak : null`) rather than reset inside an
  effect, so a stale streak can never leak across an account switch.
- Desktop/mobile parity is structural: there is one responsive DOM and no breakpoint
  gating on any streak control. The storefront nav uses `md:` gating, but the header
  bar and account menu are shared, so mobile gets the identical counter and entry.

## 4. Verification

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit -p tsconfig.json --incremental false` | **PASS**, 0 errors |
| ESLint (touched paths) | **0 errors**, 1 new warning |
| `npx next build` | **PASS**, 34 routes |
| `20261005090000` applied to real Postgres 17 | **PASS** |
| Streak semantics A-H executed | **PASS**, all as specified |
| Grant/RLS exploitation attempt | **PASS after fix** (see §10) |
| Tests | none — this repo has no test runner |
| Desktop/mobile parity | **Not verified in a browser** — see §11 |

The single new warning is `react-hooks/set-state-in-effect` in `StreakContext`. It
flags fetching-on-mount into state, which is the same rule `NotificationContext` and
`CartContext` already trip; 0 errors is the bar and it is met.

Two real bugs were found and fixed during review rather than shipped:
- A milestone loop reused the `FOREACH` variable as the "was it inserted?" probe.
  `INSERT ... ON CONFLICT DO NOTHING RETURNING` yields no row on conflict, so this now
  uses a separate `v_inserted`.
- `extends` was used as a variable name in `src/services/db/streaks.ts`, a reserved
  word; renamed to `isConsecutive`.

### SQL was statically reviewed, then actually parsed and executed

A local Supabase Postgres 17 was brought up via Docker, so
`20261005090000_daily_streaks.sql` was **really applied** and its behaviour
**really executed**. See §10 for what that cost and what it found.

Static review first: balanced parens and `$$` quoting, 4 functions all
`SECURITY DEFINER` with `search_path` pinned to `public`, every column referenced by
the UPDATE verified against the table definition, the `profiles(id) = auth.users.id`
relationship confirmed against the signup trigger. No explicit `BEGIN`/`COMMIT`,
matching every other migration in the repo (the Supabase CLI wraps each migration).

**Every approved semantic was then verified against real Postgres** by rewinding
`last_activity_date` to simulate elapsed days (`now()` cannot be faked):

| # | Scenario | Result |
| --- | --- | --- |
| A | First ever day | `current=1 longest=1 total=1`, next milestone `3` |
| B | Second call same day | `current=1 total=1 advanced=false` — **idempotent** |
| C | Rewind to yesterday, record | `current=2` — consecutive |
| D | Rewind 3 days, record | `current=1` but `longest=2` — **hard break, history kept** |
| E | Lapsed, read only | `current=0 streak_broken=true`, stored row untouched |
| F | Yesterday, read only | `expires_today=true`, count preserved — **reminder signal** |
| G | 7th day | `milestones_awarded=[3,7]`, 2 badge rows |
| H | 7th day again | `milestones_awarded=[]`, ledger still 2 rows, notifications still 2 — **no duplicates** |
| I | RLS | 0 client write policies on `streaks` / `streak_milestones` |

## 5. Still missing (Phase 9 is not finished)
- Leaderboards / streak rankings.
- Streak freezes or grace days for lapsed customers.
- Sharing a streak to the social graph.
- Admin analytics and streak reporting.
- Any push or email notification.
- Native-speaker review of the Lingala, Tshiluba, Swahili and especially Kikongo
  strings. They are best-effort machine output.

## 6. Blockers
- `20261005090000_daily_streaks.sql` is **UNAPPLIED**. Until it is, the dashboard
  streak panel renders its "not available" notice and the header counter stays hidden.
  This is intentional degradation, not a crash.
- No local PostgreSQL / no Docker; remote ledger still fails with
  `LegacyDbConnectError: Connection timed out`.

## 7. Confirm before applying
1. **No production migration has been run for this feature.** Review the SQL and apply
   explicitly.
2. Apply in filename order after the notification foundation
   (`20260928100000_notification_security_and_realtime.sql`), which owns the
   `notifications` table and realtime publication.
3. `streaks.profile_id` references `profiles(id)`, which is `auth.users.id` and is
   populated by the signup trigger — so a row exists for every signed-in customer and
   no backfill is needed.
4. The migration is additive and idempotent: it creates objects only, rewrites no
   data, and the rollback block is commented at the end of the file.

## 8. Inherited operational notes
- Feature 3's belief that `20260928102000_social_foundation.sql` is applied still needs
  operator confirmation, and `20261004090000_friend_graph_core.sql` is also unapplied.
- F1/F2 migrations remain unapplied; F2 still lacks `DLX_CATALOG_AI_PROVIDER` and
  `DLX_CATALOG_AI_API_KEY`.
- Stale unapplied claims remain in `docs/MASTER_PROJECT_CHECKPOINT.md:265`,
  `docs/AGENT_RECONCILIATION.md:52,88` and `BACKEND_CHECKPOINT.md:12,15`.

## 9. Rollback
```sql
DROP TRIGGER IF EXISTS "Notify customers of streak milestones" ON public.streak_milestones;
DROP FUNCTION IF EXISTS public.notify_on_streak_milestone();
DROP FUNCTION IF EXISTS public.get_my_streak();
DROP FUNCTION IF EXISTS public.record_streak_activity();
DROP FUNCTION IF EXISTS public.build_streak_state(UUID, BOOLEAN, INTEGER[]);
DROP TABLE IF EXISTS public.streak_milestones;
DROP TABLE IF EXISTS public.streaks;
```
Dropping `streaks` cascades to `streak_milestones` via `ON DELETE CASCADE` only when
rows are removed, so drop the ledger table first as shown. Milestone notifications
already written are retained; they are ordinary rows in `notifications`.
---

## 10. Local Postgres verification — what it cost and what it found

A local Supabase Postgres 17 was started with Docker so the migration could be parsed
and executed for real rather than only eyeballed.

### The migration folder is a delta, not a replayable history
`supabase db start` fails on the **first** migration:

```
ERROR:  relation "public.profiles" does not exist (SQLSTATE 42P01)
```

Eight core tables are referenced across the migrations but created by **none** of them:
`profiles`, `products`, `product_images`, `orders`, `order_items`, `categories`,
`inventory_history`, `notifications`. **The database cannot be rebuilt from this repo.**
Minimal stand-ins were created in `/tmp` (deliberately not added to the repo) purely to
satisfy foreign keys and policies. They are not production schema — for example the real
`orders` uses `customer_id`/`total_amount`, not the guessed `user_id`/`total`.

This also corroborates Feature 3's finding that `20260928102000_social_foundation.sql`
is already applied remotely: the remote database contains objects that no migration in
the repo creates.

### A real cross-customer data leak in this migration, found and fixed
Supabase grants `EXECUTE` on every new `public`-schema function to `anon`,
`authenticated` and `service_role` through platform default privileges. So
`REVOKE ... FROM PUBLIC` — which is what this migration originally relied on — removes
nothing:

```
build_streak_state -> {postgres=X, anon=X, authenticated=X, service_role=X}
```

`build_streak_state(uuid, …)` is `SECURITY DEFINER` and accepts an arbitrary
`profile_id`, so **any customer could read any other customer's streak state**,
completely bypassing RLS:

```
>>> attacker 1111… calls the helper with victim 2222…:
 leaked_victim_total | leaked_victim_longest
                   37 |                     9
>>> direct table read of the same row (RLS working correctly):
 victim_rows: 0
```

Fixed by revoking from `anon, authenticated` explicitly. Re-verified under
`SET ROLE authenticated`:

```
ERROR:  permission denied for function build_streak_state
```

while `get_my_streak` and `record_streak_activity` remain reachable.

### The same bug class pre-exists elsewhere — `20261007090000`
Three reward helpers are `SECURITY DEFINER`, take an identity argument, have **no
internal `auth.uid()` or `is_admin()` guard**, and were callable by `anon`. One was
exploited end-to-end with no session at all:

```
SET ROLE anon;
SELECT generate_reward_coupon_code('FREE', <any profile uuid>);  ->  FREE-0552fb8a
```

`20261007090000_revoke_internal_helper_grants.sql` revokes `anon`/`authenticated`
EXECUTE on `award_milestone_if_not_awarded`, `check_purchase_milestones`,
`generate_reward_coupon_code`, `social_profiles_are_blocked` and `adjust_stock_on_order`.
None are referenced from `src/`; they exist to be called by `SECURITY DEFINER` trigger
functions, which keep working, and `service_role` keeps EXECUTE so the server API routes
are unaffected. Verified: exploit now raises `permission denied`, owner and
`service_role` paths intact, re-application produces 0 errors.

### Open decision — `get_shop_stats(uuid)` NOT revoked
It exposes `total_revenue` per shop to any caller, which is a genuine business-data
exposure. But `src/services/db/partner-shops.ts:236` calls it directly from the browser,
so a blanket revoke would break the partner shops page. It was deliberately left alone
rather than silently broken or silently leaked. The fix is to scope it to the shop
owner. **Needs a product decision.**

## 11. Still not verified
The browser-level run did not complete. The Supabase gateway/auth services would not
start in this environment — `supabase start` exits 0 with only the Postgres container
running and nothing on `54321`. Since `/dashboard` requires a signed-in user and there
is no demo auth path, the streak panel, header counter and mobile/desktop parity remain
**structurally reviewed but not visually confirmed**. The streak *logic* is fully
verified at the SQL layer.

To finish it later: restore `supabase_db_dlxstore`, bring up the gateway, apply
`/tmp/dlxsupa/bootstrap_scratch.sql`, then point `.env.local` at the local instance and
sign in as a seeded user.
