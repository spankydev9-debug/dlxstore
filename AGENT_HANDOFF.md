# AGENT_HANDOFF.md

Canonical handoff contract for every agent working on DLXSTORE.
Last updated: 2026-09-30 (Devin continuation). Owner: Lead / Architect agent.

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
| Service worker | Verified clean | `public/sw.js` never intercepts image requests |
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
