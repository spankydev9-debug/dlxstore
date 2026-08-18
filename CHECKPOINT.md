# DLXSTORE Progress Checkpoint

> Last updated: 2026-08-18 by production agent
> Project root: `/Users/dollface/Desktop/dlxstore`
> GitHub: https://github.com/spankydev9-debug/dlxstore

## Current Git State

| Item | Value |
|------|-------|
| Branch | `main` (1 commit ahead of `origin/main`) |
| Latest commit | Pending commit — coupon, food, WhatsApp, and founder milestone |
| Uncommitted | Intentional production milestone; `Untitled/` is an unrelated nested Git repository and is deliberately untouched. |

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
- **Not verified live** — no `.env` with credentials in repo (correct)

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

- `npm run lint` passes with 59 pre-existing warnings and no errors.
- `npm run build` passes; includes `/food`.
- Local dev server was already running from this repository at `http://localhost:3001` (PID 4773).
- Smoke-tested `/, /food, /about, /contact, /manifest.webmanifest, /robots.txt, /sitemap.xml` with HTTP 200.
- No Supabase credentials or Vercel access are available in this workspace, so migrations and production deployment remain unverified.
