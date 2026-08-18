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
