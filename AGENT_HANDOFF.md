# AGENT_HANDOFF.md

Canonical handoff contract for every agent working on DLXSTORE.
Last updated: 2026-10-09 (P5 campaigns, storefront banner, admin editor). Owner: Lead / Architect agent.

---

> ## ⚠️ Current state — supersedes the git/region tables below
>
> Read this first. The rest of this file predates 2026-09-30 and its branch figures are stale.
>
> | | |
> |---|---|
> | Branch / HEAD | `main` @ `a17b96b` (P5 code `48085a5`) — ahead of `origin/main` (`276e759`); nothing pushed, pushing needs owner approval. **Any fixed count in this file goes stale one commit later: run `git rev-list --count origin/main..HEAD` instead of trusting the number.** `scripts/` is untracked. The `e760c09` / `mobile-ux-hardening` / `bb81f9d` figures below are historical |
> | Newest work | P0 `18f250b` (chat media) · P1 `73e47bf` (purchase continuation) · P2 `98f3e68` (category rail) · P3 `46ccaa3` (product cards, Story sharing, custom orders) · P4 `c61132f` (availability + cart) · P4b `8a2fd56` (cart/checkout safety against the live catalogue) · **P5 `48085a5` (campaign data layer, storefront banner, admin campaign editor, coupon-honesty guard).** See `docs/CHECKPOINT-P5-CAMPAIGNS.md` |
> | **Campaign data** | `campaigns` and `personalized_promotions` are **empty in production** — the P5 banner therefore renders nothing today. `coupons` has 3 rows and **none can redeem**: `DLX2001` (20%) expired 2026-08-30, `2073` (35%) expired 2026-08-29, and the only unexpired code is `active = false`. Because `campaigns.coupon_code` has an FK to `coupons(code)` and P5's guard refuses a campaign whose coupon cannot deliver, **the "We are now open" launch is two ordered production writes (BACKLOG DEP-3), not one** |
> | P9–P16 status | complete and locally verified — see `docs/CHECKPOINT-P14-MARKETPLACE.md`, `-P15-MOBILE-PWA.md`, `-P16-PERFORMANCE.md` |
> | **Production deploy state** | **Deployed, but behind local `main`.** Re-checked 2026-10-09: the production alias `https://dlxstore-flax.vercel.app` serves deployment `dpl_H4941MTDJrpFVGQy861mpXRrhwHa`, created 2026-10-08 22:39 CAT from **`main` @ `276e759`** (= `origin/main`). `/discover`, `/studio`, `/partner/dashboard` return **200** — the earlier "not deployed / 404" note is obsolete. Everything from `fa4d510` onward (P0–P5) is **not** on production. **Verify a deploy in a browser with the Service Worker caches cleared** — `/sw.js` (`dlxstore-shell-v4`, `dlxstore-static-v4`) re-registers on every load and was observed serving an outdated bundle, so an alias can look unchanged for reasons that have nothing to do with the deploy. Build functions report region `iad1` on this deployment, which conflicts with the `cpt1` cold-start measurement in `docs/CHECKPOINT-P16-PERFORMANCE.md` — re-measure before quoting either |
> | **Production DB state** | **45/45 migrations applied, latest `20261017093000`; 4 pending** (`20261018090000`, `20261019090000`, `20261020090000`, `20261021090000`). The "missing 37 of 40 RPCs" figure below is obsolete. Live defects re-probed 2026-10-09 **against the deployed bundle** — i.e. these are user-facing on production right now: `get_trending_products` → HTTP 400 `42P10 "ORDER BY position 9 is not in select list"` (silently kills the `/discover` trending shelf), `get_product_social_proof` → HTTP 400 `42804 "Returned type bigint … column 2"` (product social proof never renders), and `get_or_create_direct_conversation` **does not exist** in `pg_proc` (starting a DM throws "Unable to start the conversation."). The first two are repaired by `20261018090000`; applying it fixes live traffic without any deploy. `20261019090000` gates DMs. `20261020090000` / `20261021090000` belong to code that is not deployed yet, so they are not live defects |
> | Deploy region | Unresolved: the current production build reports `iad1`, the P16 audit measured `cpt1` cold starts. Re-measure rather than trusting either |
> | Latest audit | `docs/CHECKPOINT-PRODUCTION-READINESS.md` — go-live checklist, live browser defects, accepted risks |
> | Latest work | `docs/CHECKPOINT-P5-CAMPAIGNS.md` — what P5 built, the production campaign/coupon facts, the 20 validator and coupon-guard cases, and exactly what stays unverified |
>
> Shipping what is already built needs **three** owner decisions: apply the pending migrations
> (DEP-1a first — its absence breaks RPCs that are live for customers right now, and needs no
> deploy), push + deploy local `main` (DEP-2), and seed a redeemable coupon **before** the campaign
> that advertises it (DEP-3). Production currently runs `276e759`.

---

## 1. What DLXSTORE is

A Next.js 16 commerce platform for Goma, DRC, evolving from a single storefront into
a commerce + messaging + social + AI ecosystem. See `ROADMAP.md`.

| | |
|---|---|
| Framework | Next.js `16.2.10` (App Router), React `19.2.4` |
| Styling | Tailwind CSS v4 |
| Backend | Supabase (Postgres + Auth + Storage + Realtime) |
| Deployment | Vercel, project `dlx2/dlxstore` |
| Supabase project ref | `szhkesvvrgcxbxucodzz` (project name "spankydev9-debug's Project") |
| Deploy region | `iad1` (US East) — audience is Goma, DRC. See `docs/PRODUCTION_STATE.md` |

---

## 2. Current Git state (verified 2026-09-30)

| | |
|---|---|
| Working branch | `mobile-ux-hardening` @ `5ebd513` (2026-09-30 Devin continuation) |
| `main` | `bb81f9d` (2026-08-23) — **commits behind, not an ancestor** |
| Merge base | `d409409` (2026-08-23) "chore: finalize verified DLXSTORE production release" |
| Working tree | Clean (backup SQL files tracked in .gitignore) |
| Production deploy | `dpl_GnugoNYDwBzefawAkQjhy8r5vrrF`, built from **`mobile-ux-hardening`** |
| Production alias | `https://dlxstore-flax.vercel.app` |
| Stashes | 3 exist and **must be preserved** — see section 6 |
| Devin packages | 6 commits (6d8c0be, 5e3e600, b67743f, e86f570, 481c8bb, 5ebd513) |

**There is no canonical branch.** Production ships from a feature branch.
Full analysis: `docs/BRANCH_STRATEGY.md`.

---

## 3. Hard safety rules (non-negotiable)

1. **No DB writes** without explicit approval. Read-only queries are fine.
2. **No migrations** without explicit approval. `supabase db push` is forbidden by default.
3. **No production changes** without explicit approval.
4. **No deploy, no push** without explicit approval.
5. **Never modify or delete** `dlxstore_data_backup.sql`, `dlxstore_remote_backup.sql`. These are
   tracked in `.gitignore` to prevent accidental commits. Documented offsite backup location
   should be maintained in AGENT_HANDOFF.md §5 (backup section).
6. **Never delete, drop, or reorder** the 3 Git stashes (section 6).
7. **No destructive Git operations**: no `reset --hard`, no `clean`, no force-push,
   no branch deletion, no rebase/merge until explicitly reviewed and approved.
8. **Never overwrite another agent's work.** Read before writing; if in doubt, stop.
9. **Keep changes isolated and reviewable**: one concern per commit, scoped diff.
10. **Preserve production data** at all times. When unsure whether an operation is
    destructive, it is destructive.

**All Postgres access from the development machine is blocked by local network egress
filtering on port 5432** — verified 2026-09-28. Not a Supabase IP allowlist: a neutral
Postgres host (`echo.postgresql.org:5432`) is equally blocked while 443 is open. All of
`db.<ref>.supabase.co:5432`, `:6543`, and the pooler
`aws-1-eu-west-1.pooler.supabase.com:5432` time out. **A pooler connection string will
not help.** PostgREST (443) and Storage (443) are reachable, but PostgREST does not
expose `schema_migrations`, so applied-migration state cannot be read from here.
Unblocking options are in `docs/PRODUCTION_STATE.md` §3.

---

## 4. Multi-agent working rules

### Before starting
- Receive an explicit scope and an explicit list of files/directories you may touch.
- Read `AGENT_HANDOFF.md`, `ROADMAP.md`, `BACKLOG.md`, and the relevant `docs/` file.
- Verify the branch you are on. Do not switch branches without approval.

### While working
- Stay inside your assigned file scope. If the fix requires a file outside it, **stop
  and ask** — do not widen your own scope.
- Prefer additive, isolated changes. Match existing code style and conventions.
- Do not "helpfully" refactor unrelated code.
- No comments unless explicitly requested.
- Never commit secrets. `.env.local` must never be committed.

### Required handoff report (every agent, every task)
1. **Completed** — what was done.
2. **Remaining** — what was not done and why.
3. **Files changed** — exact paths.
4. **Files not touched** — explicitly, so the next agent knows the boundary.
5. **DB changes** — none, or exact detail.
6. **Tests performed** — exact commands and results.
7. **Known issues** — anything suspicious found but not fixed.
8. **Exact next step** — the single most useful next action.

### Agent roles
| Role | Scope |
|---|---|
| Lead / Architect | Integration, review, coordination, roadmap, branch strategy |
| UX Agent | Navigation, onboarding, familiarity, screen-by-screen UX |
| Commerce Agent | Discovery, product pages, cart, checkout, orders |
| AI Product Agent | Phase 4–5: Ghost Mannequin, Model Studio, catalog automation |
| Chat Agent | Phase 7 messaging, realtime, chat UI |
| Social Agent | Phases 8–13: friends, streaks, stories, social commerce, profiles, discover |
| Backend / Supabase Agent | Schema, migrations, RLS, RPCs, storage, performance |
| Admin / Operations Agent | Inventory, suppliers, business numbers, delivery ops |
| QA Agent | Phase 1 storefront + technical QA |
| Performance / SEO Agent | Phase 22: Core Web Vitals, image perf, caching, accessibility, SEO |

Agents may hand work to each other. A handoff must always carry the 8-point report above.

---

## 5. Verified Phase 1 status

| Area | Status | Note |
|---|---|---|
| **Image pipeline** | **CLOSED / HEALTHY** | Do **not** rebuild or replace. See `docs/ARCHITECTURE.md` |
| Supabase connection | Verified | Publishable key `sb_publishable_…`, `isDemoMode=false` in prod |
| Storage | Verified | 109/109 active product images return HTTP 200 |
| RLS on public reads | Verified | categories 15, sessions 5, products 49 rows return 200 |
| `/_next/image` optimizer | Verified | 200 `image/jpeg` for Supabase and Unsplash sources |
| Service worker | Verified clean | `public/sw.js` never intercepts image requests; cache-first applies only to same-origin `/_next/static/**` |
| Image optimizer | Verified, measured | `/_next/image` TTFB 111 ms vs 109 ms for a static file on the same origin; warm p50 **3.9 ms**, 107/107 images 200. Region is `cpt1` (Cape Town), not `iad1` |
| P10 Safety & privacy | Complete | `docs/CHECKPOINT-P10-SAFETY-PRIVACY.md` |
| P11 Growth & loyalty | Complete | `docs/CHECKPOINT-P11-GROWTH-LOYALTY.md` |
| P12 Analytics / BI | Complete | `docs/CHECKPOINT-P12-ANALYTICS-BI.md` |
| P13 Communication & marketing | Complete, local verified | `docs/CHECKPOINT-P13-COMMUNICATION-MARKETING.md` |
| P14 Marketplace | Complete, local verified | `docs/CHECKPOINT-P14-MARKETPLACE.md` — 97 SQL assertions; **no live seller or payout yet** |
| P15 Mobile / PWA | Complete, runtime verified | `docs/CHECKPOINT-P15-MOBILE-PWA.md` — installability never audited in a real browser |
| P16 Performance / SEO / infra | **Partially complete** | `docs/CHECKPOINT-P16-PERFORMANCE.md` — the 0.7–2.7 s/image figure does **not** indicate a pipeline defect; Core Web Vitals, bundle attribution and RUM still open |
| Production branch strategy | **UNRESOLVED** | See `docs/BRANCH_STRATEGY.md` |
| Remote backup | **INVALID** | `dlxstore_remote_backup.sql` is 0 bytes |
| Applied-migration audit | **UNKNOWN** | Cannot verify; DB connection IP-blocked |

---

## 6. Git stashes — PRESERVE ALL

| Ref | Base commit | Contents | Status |
|---|---|---|---|
| `stash@{0}` | `bb81f9d` (= `main` tip) | 1 file, +2/-3 — `src/app/dashboard/page.tsx`: switches the notifications tab from `getNotifications()` to `refreshNotifications()` | **Real uncommitted fix, not present on production branch.** Companion to `main`'s realtime work. |
| `stash@{1}` | `e63e22e` (ancestor of both branches) | **Empty** — no tracked changes, no untracked files | No-op. Nothing to recover, but still do not drop. |
| `stash@{2}` | `452773b` (ancestor of both branches) | 8 tracked files +365/-69, plus untracked `src/components/admin/HomepageContentControls.tsx` and `supabase/.temp/cli-latest` | Aug-19 admin/deliveries/orders/products work. Both branches have since evolved past it; untracked component already exists on both branches. |

Do not `git stash drop`, `git stash clear`, or `git stash pop` these without approval.
Recovery material is irreplaceable; a `pop` also mutates the working tree.

---

## 7. Backups

| File | Size | Date | Verdict |
|---|---|---|---|
| `dlxstore_data_backup.sql` | 265,908 B | 2026-09-04 | **Genuine.** Verified real `INSERT` statements for `auth.users`, `auth.identities`, `public.profiles`, `public.vendors`, `public.categories`, `public.products`, `public.product_images`, `public.orders`, `public.order_items`, `public.deliveries`, `public.sessions`, `public.settings`, `public.reviews`, `public.wishlist`, `public.notifications`, `public.partner_applications`, `public.food_vendors`, `public.food_categories`, `public.inventory_history`, `public.coupons`, `public.delivery_zones`, `storage.buckets`, `storage.objects`. **23 days stale.** |
| `dlxstore_remote_backup.sql` | **0 B** | 2026-09-04 | **INVALID — empty file.** A dump that produced nothing. Must not be counted as a backup. |
| `dlxstore_project.zip` | 186,364 B | 2026-08-16 | Stale project archive. |

Note: table names in the data backup are quoted (`"public"."products"`), so naive greps
for `public.products` or `COPY public.` return zero and misreport the dump as empty.

Both SQL files are **untracked in Git** (see `.gitignore`) — single copy, unversioned, one `rm` from gone.
Slice 3 (not yet approved) is intended to produce a fresh verified backup.

**Offsite backup location:** Not yet configured. When OPS-4 is completed, document the offsite
backup location here (e.g., cloud storage service, external drive, etc.). This ensures recovery
is possible even if the local machine is lost.

---

## 8. Environment configuration

See `docs/PRODUCTION_STATE.md` for the full environment and deployment reference.

Production Vercel env vars (verified via `vercel env ls`, 2026-09-28):

| Name | Environments |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | Production only |
| `NEXT_PUBLIC_SUPABASE_URL` | Production, Preview |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Production, Preview |

No `NEXT_PUBLIC_SUPABASE_ANON_KEY` and no `NEXT_PUBLIC_ENABLE_DEMO_MODE` in Vercel.
That is correct: the code prefers the publishable key and demo mode must never be
enabled in production (`src/services/db/index.ts:25`).

**Caveat:** these are stored as Vercel *sensitive/encrypted* values. They are therefore
not inlined at build time for client bundles; `NEXT_PUBLIC_SITE_URL` only resolves
server-side at runtime. The Supabase URL and publishable key **are** correctly inlined
(verified in the deployed client bundle). Treat the `NEXT_PUBLIC_SITE_URL` pattern as
fragile and avoid depending on build-time inlining of it.

---

## 9. Known open risks

1. **No canonical branch.** Production deploys from a feature branch; `main` is 20
   commits behind. Any deploy triggered from `main` would ship 20 commits of regressed
   application code and **omit 8 migration files** that production depends on.
2. **`main` holds work production lacks** — real Supabase Realtime notification
   subscriptions plus the `20260823154800_realtime_notifications.sql` migration.
   Production notifications are **not** real-time today. See `docs/BRANCH_STRATEGY.md`.
3. **Empty remote backup.** Only one real backup exists, and it is 23 days old.
4. **Backups untracked in Git.**
5. **Migration drift unverifiable.** DB connection is IP-blocked, so applied-migration
   state is unknown.
6. **Image cold-cache latency** 0.7–2.7 s/image from `iad1` for a Goma audience.
   A performance issue, **not** a reliability bug.
7. **Silent image fallback.** `resolveProductImageUrl` (`src/lib/product-image.ts:5`)
   substitutes `/globe.svg` for any disallowed URL, and admin category/vendor forms
   (`src/components/admin/CategoryControls.tsx:59`,
   `src/components/admin/FoodVendorControls.tsx:173`) accept unvalidated free-text URLs.
   An invalid pasted URL fails invisibly.

---

## 10. Try-On feature status

Not implemented. DB table `try_on_jobs` exists (migration
`20260829060000_customer_avatar_reconciliation.sql`) but there is no service layer, no
UI, and no external AI provider integration. Do not implement without an identified
provider and configured credentials. See `ROADMAP.md` Phase 4/5 for the AI track.
