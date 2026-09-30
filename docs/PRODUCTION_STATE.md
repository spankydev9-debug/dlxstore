# PRODUCTION_STATE.md

Production environment, deployment, and backup reference. Generated 2026-09-28.
All values verified read-only. No production change was made.

---

## 1. Deployment

| | |
|---|---|
| Provider | Vercel |
| Scope / project | `dlx2/dlxstore` (the only project in the scope) |
| Production alias | `https://dlxstore-flax.vercel.app` |
| Other aliases | `https://dlxstore-dlx2.vercel.app`, `https://dlxstore-git-mobile-ux-hardening-dlx2.vercel.app` |
| Latest production deployment | `dpl_GnugoNYDwBzefawAkQjhy8r5vrrF` — `https://dlxstore-hgxh2wdyu-dlx2.vercel.app` |
| Created | 2026-09-09 02:08:05 +0200 (19 days before this document) |
| Status | Ready |
| Built from | **`mobile-ux-hardening`** @ `a9876be` |
| Runtime region | `iad1` (US East) |
| Node version | 24.x |
| Local link | **NOT linked** — `.vercel/project.json` is absent; only `.vercel/repo.json` exists |
| Custom domain | None. `dlxstore.cd`, `dlxstore.com`, `dlxstore.app`, `dlxstore.co` all fail to resolve. |

All three aliases serve a byte-identical build
(`1sbmru_bu_5ru.js` MD5 `02c0cd8febdc2b3023e7958921f85b97`).

The local directory being unlinked matters: `vercel` commands resolve via the account
scope, so verify the target project before any CLI action.

---

## 2. Environment variables

`vercel env ls` (2026-09-28):

| Name | Type | Environments | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | Config (sensitive) | Production | Canonical site URL, e.g. `https://dlxstore-flax.vercel.app` |
| `NEXT_PUBLIC_SUPABASE_URL` | Config (sensitive) | Production, Preview | `https://szhkesvvrgcxbxucodzz.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Config (sensitive) | Production, Preview | `sb_publishable_…` |

**Not set** (intentionally): `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`NEXT_PUBLIC_ENABLE_DEMO_MODE`. Demo mode must never be enabled in production
(`src/services/db/index.ts:25`).

### Sensitive-value caveat

All three are stored as Vercel *sensitive/encrypted* values, shown by the CLI as
`eyJ2IjoidjIiLCJjIj…`. Sensitive values are **not inlined into client bundles at build
time**. Verified consequences:

- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` **are** correctly
  present in the deployed client bundle. Vercel inlines these as build-time values, and
  the deployed bundle contains `https://szhkesvvrgcxbxucodzz.supabase.co` and
  `sb_publishable_VuXEkzmJHl4wfeE823vn6g_8lslPJ4Z`.
- `NEXT_PUBLIC_SITE_URL` resolves **server-side at runtime only** (canonical link,
  sitemap, robots all emit `https://dlxstore-flax.vercel.app` correctly).

`next.config.ts` reads `NEXT_PUBLIC_SUPABASE_URL` at **build time** to derive
`remotePatterns`. This currently works. If the variable were ever removed or converted
in a way that prevents build-time access, **every product and category image would break
simultaneously**. Treat it as a critical build dependency and verify it after any env
change.

### Local development

`.env.local` (untracked) points at the same project ref `szhkesvvrgcxbxucodzz`, so local
and production share one database. Local development therefore operates on **production
data** — a real risk. A separate Supabase project for development is recommended.

`supabase/.temp/project-ref` = `szhkesvvrgcxbxucodzz`, linked to
"spankydev9-debug's Project" (org `jtpaonkgnovawfztueig`).

---

## 3. Supabase

| | |
|---|---|
| Project ref | `szhkesvvrgcxbxucodzz` |
| Rest / storage host | `https://szhkesvvrgcxbxucodzz.supabase.co` |
| Public bucket | `product-images` |
| Anon/publishable key | `sb_publishable_…` — verified to read public data |
| Migrations in branch | 20 (production branch) |
| Direct DB port | **Not reachable from this network** |

### Connectivity

| Channel | Status |
|---|---|
| PostgREST (`/rest/v1`) | Reachable, 200 |
| Storage public objects | Reachable, 200 |
| Direct Postgres (`supabase migration list`) | **Blocked — local egress filter on 5432** |
| Pooler `aws-1-eu-west-1.pooler.supabase.com:5432` | **Blocked** (same cause) |
| Direct DB `:6543` (transaction pooler) | **Blocked** (same cause) |
| Management API `api.supabase.com` | Reachable, but 401 without a personal access token |

**Root cause, verified 2026-09-28: local network egress filtering — NOT Supabase-side IP
allowlisting.** Evidence:

| Probe | Result |
|---|---|
| `db.szhkesvvrgcxbxucodzz.supabase.co:5432` | timeout |
| `db.szhkesvvrgcxbxucodzz.supabase.co:6543` | timeout |
| `aws-1-eu-west-1.pooler.supabase.com:5432` | timeout |
| `echo.postgresql.org:5432` (neutral, non-Supabase host) | **also timeout** |
| `github.com:443` (control) | open |
| `szhkesvvrgcxbxucodzz.supabase.co:443` (control) | open |

A neutral Postgres host failing identically proves the block is on this machine's
outbound path, not on the Supabase project. **Supplying a pooler connection string will
not unblock this** — that suggestion was tested and disproven on 2026-09-28.

PostgREST (443) and Storage (443) remain reachable, but PostgREST does not expose
`schema_migrations`, so applied-migration state cannot be read from here.

### Unblocking options

1. **Fastest — no config change.** Run this read-only query in the Supabase Dashboard SQL
   editor and paste the result:

   ```sql
   SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC;
   ```

2. Permit outbound TCP 5432 and 6543 on this machine/network, then
   `supabase migration list`. Durable fix.
3. Supply a Supabase **personal access token** so the Management API's server-side query
   route can read the table over 443.

Consequence until unblocked: **applied-migration state cannot be read**, so the `main`-only
migration `20260823154800_realtime_notifications.sql` cannot be confirmed as applied or
not. This is a **blocker** for any migration work. Tracked in `BACKLOG.md` (OPS-1).

### Verified live data (read-only, 2026-09-28)

| Table | Rows / result |
|---|---|
| `categories` (`is_active = true`) | 15 |
| `sessions` | 5 |
| `products` (active, not archived) | 49 |
| `product_images` | readable; 109 distinct URLs across active products, all HTTP 200 |
| `food_vendors` (public) | none returned → `/food` renders 0 images |

---

## 4. Backups

| File | Size | Date | Verdict |
|---|---|---|---|
| `dlxstore_data_backup.sql` | 265,908 B | 2026-09-04 | **Genuine but 23 days stale** |
| `dlxstore_remote_backup.sql` | **0 B** | 2026-09-04 | **INVALID — empty** |
| `dlxstore_project.zip` | 186,364 B | 2026-08-16 | Stale archive |

### What the data backup actually contains

`pg_dump` output, `PostgreSQL database version 17.6`, 27 `INSERT` statements covering:

`auth.users`, `auth.identities`, `auth.sessions`, `auth.mfa_amr_claims`,
`auth.one_time_tokens`, `auth.refresh_tokens`,
`public.profiles`, `public.vendors`, `public.categories`, `public.coupons`,
`public.delivery_zones`, `public.orders`, `public.deliveries`, `public.food_categories`,
`public.food_vendors`, `public.products`, `public.inventory_history`,
`public.notifications`, `public.order_items`, `public.partner_applications`,
`public.product_images`, `public.reviews`, `public.sessions`, `public.settings`,
`public.wishlist`, `storage.buckets`, `storage.objects`.

**Verification gotcha:** table names are quoted (`"public"."products"`), so
`grep "public.products"` or `grep "COPY public\."` both return **zero** and make a valid
265 KB dump look empty. Use `grep 'INSERT INTO "public"'`.

### Risks

- The only real backup is 23 days old and predates the 2026-09-09 production deploy.
- The "remote" backup is empty — a dump that silently produced nothing. If a routine ever
  treated it as a successful backup, that assumption is false.
- Both SQL files are **untracked in Git**: single copy, no version history.
- No storage-object backup exists. The SQL dump records `storage.objects` **metadata**
  only — the ~14.7 MB of image binaries are not in it. A database restore would restore
  `image_url` values pointing at objects that no longer exist.

---

## 5. SEO / discovery status

| Item | Status |
|---|---|
| Canonical URL | `https://dlxstore-flax.vercel.app` (from `NEXT_PUBLIC_SITE_URL`) |
| `robots.txt` | Serves; disallows `/admin/`, `/dashboard/`, `/auth/`, `/checkout/`, `/cart/`, `/order-tracking/` |
| `sitemap.xml` | Data-driven, generated from public products and partners; `lastmod` 2026-09-09 |
| Google Search Console | Verified meta present: `rDLfWrWhsGIOrBrggnaVJEkzdPSPWunULd-pUM-bR64` |
| Open Graph | `opengraph-image.tsx` route + dynamic per-page metadata |
| Structured data | Product + Breadcrumb JSON-LD (`37be25b`) |
| Dead-domain fallback | `dlxstore.cd` fallback removed (`30c8199`) — correctly |

---

## 6. Git deployment risk

**Highest-severity item.** Production deploys from `mobile-ux-hardening`, a feature
branch. `main` is 20 commits behind and omits 8 migration files. If the Vercel
production-branch setting is ever pointed at `main`, the next deploy ships regressed
application code and loses chat, rewards, avatar, food, partner-shop, and session schema
history. Full analysis and remediation sequence: `docs/BRANCH_STRATEGY.md`.
