# DLXSTORE Progress Checkpoint

> Last updated: 2026-08-18 by production agent
> Project root: `/Users/dollface/Desktop/dlxstore`
> GitHub: https://github.com/spankydev9-debug/dlxstore

## Current Git State

| Item | Value |
|------|-------|
| Branch | `main` (pushed to `origin/main`) |
| Latest commit | `3800081` — fix: harden production auth and order handoff |
| Uncommitted | `Untitled/` remains an unrelated nested Git repository and is deliberately untouched. |

## Phase 1 Audit Summary

### Architecture
- **Next.js 16.2.10** (non-standard APIs — see `node_modules/next/dist/docs/`)
- **React 19**, Tailwind 4, Supabase JS client
- App Router under `src/app/` — 19 routes, build passes
- Dual data layer: Supabase (production) + opt-in demo mode (`NEXT_PUBLIC_ENABLE_DEMO_MODE=true`) with localStorage fallback

### What Previous Agents Built
1. Premium Goma-focused storefront (homepage, shop, product, cart, checkout, order tracking)
2. Admin dashboard (products CRUD, orders, deliveries, inventory, analytics)
3. BusinessControls admin tab (launch mode, contacts, delivery zones, partner applications)
4. Multilingual foundation (fr/en/sw/ln/kg/lu) with first-visit language prompt
5. Coming-soon mode with countdown (`StorefrontShell` + `ComingSoon`)
6. PWA: manifest, icon route, service worker, offline page
7. SEO: metadata, Open Graph, sitemap, robots
8. Supabase migrations (marketplace entities, security hardening)
9. Partner application flow (`/partner`)
10. DRC geography (26 provinces in `lib/drc-geography.ts`)

### Supabase Status
- **Schema**: `supabase/schema.sql` — profiles, products, orders, settings, etc.
- **Migrations ready** (must be applied manually in Supabase SQL editor or CLI):
  - `20260816_marketplace_foundation.sql`
  - `20260816_marketplace_entities.sql`
  - `20260816_security_hardening.sql`
  - `20260818_coupons_food_foundation.sql` (new)
- **RLS**: Hardened in migration — profiles not public; orders require auth; admin via profile role
- **Read-only connectivity verified** on 2026-08-18 using `.env.local`: the public `settings` query returned successfully. Credentials remain uncommitted.
- **Live migration/auth flow not verified**: applying migrations and creating a real test account require Supabase Dashboard/CLI authorization and a controlled test account.

### Vercel Status
- GitHub remote connected; deployment URL not verified in this session
- Set `NEXT_PUBLIC_SITE_URL`, Supabase keys in Vercel project env

### Environment (`.env.example`)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
NEXT_PUBLIC_SUPABASE_ANON_KEY=          # legacy fallback
NEXT_PUBLIC_ENABLE_DEMO_MODE=false      # never true in production
```

### Gaps Identified (being addressed)
- [x] Remove hardcoded personal phone numbers from UI
- [x] Restore admin-configurable WhatsApp Buy button (shows only when a shared business number is configured)
- [x] Coupons/rewards DB + checkout integration, with database-side code/expiry/usage validation
- [x] Food/fast-food discovery foundation (`/food`, vendor hours, availability, food product feed)
- [x] Founders section on About page
- [x] BusinessControls: WhatsApp buy number and per-channel WhatsApp settings
- [ ] Coupon administration UI and banner/promotion management UI (schema/config types are prepared)
- [ ] Admin invoice uses dynamic contacts (not hardcoded)
- [ ] Apply Supabase migrations on live project

### Commerce Flow Status
| Step | Route | Status |
|------|-------|--------|
| Homepage | `/` | Working |
| Shop | `/shop` | Working |
| Product | `/product/[slug]` | Working |
| Cart | `/cart` | Working |
| Checkout | `/checkout` | Working (auth required, COD only) |
| Confirmation | `/order-tracking` | Working |
| Account | `/dashboard` | Working |
| Admin | `/admin/dashboard` | Working (admin role guard) |

### Security Notes
- No service-role key in client code ✓
- Demo mode opt-in only ✓
- Sign-up trigger ignores client-supplied role ✓
- Settings readable publicly (store config) — admin write only ✓

## Milestones

### M1 — Audit complete
- Documented findings in this file
- Committed security hardening + checkpoint

### M2 — Production features (in progress)
- WhatsApp buy from admin config ✓
- Coupons foundation and checkout application ✓
- Food discovery page ✓
- Founders/about ✓
- Extended admin controls ✓

### M3 — Final QA fixes (pending commit)
- Production auth no longer silently creates local users when demo mode is disabled.
- Supabase auth session changes refresh the in-app profile; signup waits for the database profile trigger and reports the exact email-confirmation blocker.
- Auth redirects now safely honor an internal `next` checkout return URL.
- Website order creation remains first; WhatsApp opens only after a successful order and its failure is communicated without affecting tracking.
- Service worker now removes stale DLX caches and activates updates instead of leaving old shells indefinitely.
- Persistent language control has expanded French/English navigation and auth coverage and updates the document language attribute.

## How to Resume

```bash
cd /Users/dollface/Desktop/dlxstore
npm install
cp .env.example .env.local   # fill Supabase keys
npm run dev                    # http://localhost:3000
npm run build                  # verify production build
```

### User Actions Required
1. Create/configure Supabase project and add env vars locally + on Vercel
2. Run all migrations in `supabase/migrations/` in order
3. Promote admin: `UPDATE profiles SET role = 'admin' WHERE email = 'your@email.com';`
4. Configure store settings in Admin → Configuration (WhatsApp buy: +243982016912)
5. Push commits and verify Vercel deploy

## Latest Verification

- `npm run lint` passes with 55 warnings and no errors.
- `npm run build` passes; includes `/food`.
- Local development server is running at `http://localhost:3000`.
- Smoke-tested `/, /auth, /checkout, /order-tracking, /manifest.webmanifest, /offline` with HTTP 200.
- Public Supabase connectivity is verified; Vercel access and live migration/auth test remain unverified.

---

## Production Launch Audit & Master Task Queue

> Audit completed: 2026-08-21 by production launch agent.  This queue is the
> authoritative resume point for the current launch pass.  Tasks are executed
> and checkpointed one at a time.

### Audit evidence

- The repository is on `main`; `origin/main` currently points to `452773b`.
- There is pre-existing, uncommitted launch work affecting SEO, icons, the web
  manifest, offline page, public-product filtering, and route metadata. It was
  preserved intact during the audit.
- `npx tsc --noEmit` and `npm run build` pass. `npm run lint` exits zero with
  40 warnings (state-in-effect, unused imports, `any`, and image-alt issues).
- Local browser QA confirms the customer storefront loads and has no browser
  console errors. It does **not** contain the required visible install entry
  point. Local authenticated checkout and administrator QA cannot be completed
  without a controlled test account.
- Public product and category data are available from Supabase, but the live
  migration/RPC version and Vercel production URL cannot be established from
  the checked-in project configuration.

### Findings

1. The interrupted product-detail correction produced an untracked duplicate
   component in `src/components/paw/`, while the active product route remains a
   client component. Consequently product-specific server metadata and JSON-LD
   are not rendered on the product page.
2. The manifest and service worker foundation exist, but no visible install
   control or iOS install guidance exists.
3. `create_customer_order` verifies stock and inserts order items, but the SQL
   function in `20260819_launch_hardening.sql` does **not** decrement stock or
   add inventory-history entries, contrary to its comment. This must be fixed
   and rolled out before production checkout can be approved.
4. The admin dashboard handles catalogue, orders, deliveries, inventory,
   settings, categories, and partner applications. It has no workflow to
   create/manage food vendors or food-product availability. Partner management
   is nested in Configuration and needs mobile QA.
5. Production deployment verification is blocked by missing checked-in Vercel
   project metadata / public production URL and by unapplied or unverified
   Supabase migrations. Google Search Console verification is intentionally
   configurable but no token is set.

### Queue

| # | Task | Status | Scope / completion condition |
|---|---|---|---|
| 1 | Recover and validate interrupted launch work | PENDING | Inspect, complete, and checkpoint the existing uncommitted PWA/SEO/layout/icon/product-data work without losing user changes. |
| 2 | Make public product pages crawlable and canonical | PENDING | Complete the product-detail route correction; add dynamic metadata, JSON-LD, valid not-found handling, and product/category discoverability QA. |
| 3 | Complete visible PWA installation and offline UX | PENDING | Add storefront install control with Android/desktop prompt, iOS guidance, installed/unsupported states; verify manifest, worker, icons, and offline behavior. |
| 4 | Repair transactional checkout and inventory | PENDING | Correct the SQL RPC so order persistence, authoritative prices, coupon use, inventory decrement/history, and WhatsApp handoff are consistent; perform a controlled authenticated end-to-end test. |
| 5 | Complete food and partner business operations | PENDING | Add admin food-vendor and food-product management, ensure mobile access, and verify partner review/status operations. |
| 6 | Resolve launch-quality UI, accessibility, and responsive defects | PENDING | Address meaningful lint/accessibility defects and run desktop/mobile customer and admin QA. |
| 7 | Roll out and verify Supabase production schema | PENDING | Apply all migrations in order and verify RLS, auth profile trigger, checkout RPC, storage, and admin access on the live project. Requires configured Supabase administrative access. |
| 8 | Deploy, verify production, and prepare search-console handoff | PENDING | Push clean commits to `origin/main`, identify and verify the actual production deployment, validate critical routes/PWA, and document exact Search Console submission/verification action. Requires a configured deployment target and optional Google token. |

### Current task

**TASK 1 — Recover and validate interrupted launch work**

**STATUS: BLOCKED — production deployment is not DLXSTORE**

**What changed:** recovered and committed the pending SEO/PWA metadata work:
canonical/Open Graph defaults, public-only product lookup, dynamic sitemap,
robots exclusions, PWA manifest and multi-size icons, Apple/OG images, and
no-index metadata for private routes.

**Files changed:** `.env.example`, `src/app/{layout,manifest,icon,robots,sitemap}.tsx`,
private-route layouts, `src/app/{apple-icon,opengraph-image}.tsx`,
`src/app/offline/page.tsx`, `src/lib/{seo,site-url}.ts`, and
`src/services/db/products.ts`.

**Tests run:** `git diff --check`; `npx tsc --noEmit`; `npm run build`; local
HTTP checks for `/`, `/icon/192`, `/manifest.webmanifest`, and `/robots.txt`;
local browser storefront smoke test (no console errors).

**Build result:** PASS (Next.js 16.2.10 production build).

**Commit / push:** `ab72974` (`feat: harden SEO and PWA metadata`) pushed to
`origin/main`; remote head confirmed as `ab729748ce17720b22ff343818930dc3ae87fe1d`.

**Production verification:** FAILED. `https://dlxstore.vercel.app/` returns
HTTP 200 but serves an unrelated Vietnamese "DLX Foods" site, not this Next.js
DLXSTORE project. `https://dlxstore.cd/` does not resolve. No `.vercel` project
link, Vercel project metadata, or non-interactive Vercel credentials are present
in this workspace, so this agent cannot identify or correct the deployment
binding safely.

**Required external action:** provide the intended production domain and either
link this repository to the correct Vercel project/domain or provide access to
that project. Once resolved, resume Task 1 by verifying the deployed commit;
only then continue to Task 2.
