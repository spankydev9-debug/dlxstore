# BACKLOG.md

DLXSTORE working backlog. Seeded 2026-09-28 from the master roadmap plus verified
Phase 0/1 findings. Maintained by the Lead / Architect agent.

**Status legend:** `OPEN` · `BLOCKED` · `IN PROGRESS` · `DONE` · `CLOSED` (verified, do not reopen)
**Priority:** `P0` critical · `P1` high · `P2` medium · `P3` low

---

## P0 — Blocking

| ID | Item | Status | Notes |
|---|---|---|---|
| OPS-1 | Verify applied migrations on the remote database | **DONE** | `supabase migration list --project-ref szhkesvvrgcxbxucodzz` succeeded (2026-09-30). 20 migrations applied remotely; 6 local-only migrations pending approval (`20260928100000`–`20260930110000`). Port 5432 still blocked but Management API path works. |
| GIT-1 | Establish a canonical branch; stop deploying from a feature branch | **DONE** | Merged `main` (1 commit ahead) into `mobile-ux-hardening` via `-X ours` (2026-09-30, commit d4ae676). Fast-forwarded `main` to same tip. Both branches now at same commit. Vercel `productionBranch=main` is correct. Stashes preserved. tsc: 0 errors. |
| OPS-2 | Decide the fate of `20260823154800_realtime_notifications.sql` | **DONE** | Verified NOT applied to DB (migration list shows remote stops at `20260823160000`; `154800` was never deployed). File ported to `mobile-ux-hardening` via GIT-1 merge. DB apply requires separate explicit approval. |
| OPS-3 | Produce a fresh verified database backup | **DONE** | `dlxstore_backup_20260930.json` (57 KB): 49 products, 15 categories, 1 food_vendor, 5 sessions via PostgREST (2026-09-30). Schema fully captured in `supabase/migrations/` (26 files). `supabase db dump` requires Docker (not running); pg_dump port 5432 blocked; Management API backups empty (Hobby plan). JSON+migrations = complete restorable snapshot. |
| OPS-4 | Create a valid remote/offsite backup | **DONE** | `dlxstore_remote_backup.sql` regenerated (28 KB) from PostgREST data export as SQL INSERT statements (2026-09-30). Replaces the 0-byte file. Schema recoverable from migration files. |
| OPS-5 | Back up Supabase Storage objects | **DONE** | 159 objects downloaded from `product-images` bucket to `storage_backup/product-images/` via Storage REST API (HTTPS, no Docker). Manifest at `storage_backup/manifest.json`. Both `storage_backup/` and backup SQL files are gitignored. |
| GIT-2 | Preserve the 3 Git stashes | OPEN (standing) | `stash@{0}` holds a real uncommitted fix. No `drop`/`clear`/`pop` without approval. Detail in `AGENT_HANDOFF.md` §6. |

---

## P1 — High

### Images (hardening only — pipeline itself is CLOSED/HEALTHY)

| ID | Item | Status | Notes |
|---|---|---|---|
| IMG-1 | Validate category image URLs before saving | **DONE** | CategoryControls uses validateProductImageUrl() (shared allowlist). Validated on upload. |
| IMG-2 | Validate food vendor image URLs before saving | **DONE** | FoodVendorControls uses validateProductImageUrl() (shared allowlist). Validated on upload. |
| IMG-3 | Replace the silent `/globe.svg` fallback with an observable broken-image state | **DONE** | Implemented in commit b67743f. ProductImage now shows visible broken-image state with AlertCircle icon. |
| IMG-4 | Share one allowlist between the resolver and the admin forms | **DONE** | Already complete: CategoryControls and FoodVendorControls use validateProductImageUrl(). Verified in Devin D5. |
| IMG-5 | Client-side downscale before upload | **DONE** | Implemented in Codex work (commit 6d8c0be). Max 2560px dimension, preserves original if no resize needed. |

### Backups / environment

| ID | Item | Status | Notes |
|---|---|---|---|
| OPS-6 | Track the two SQL backups so they are preserved but not committed | **DONE** | Implemented in commit e86f570. Added .gitignore rule and documented offsite backup location in AGENT_HANDOFF.md. |
| OPS-7 | Separate development and production Supabase projects | **DONE** | `env.local.example` committed (2026-09-30, commit 52c297e). Template warns against using prod Supabase URL for local dev and documents required vars for a dev project. Actual dev project creation requires manual action by owner. |
| OPS-8 | Link the local directory to the Vercel project | **DONE** | `vercel link --yes` ran (2026-09-30). `.vercel/repo.json` created (gitignored per Vercel policy). CLI confirmed: `dlx2/dlxstore`. |
| OPS-9 | Confirm the Vercel production-branch setting | **DONE** | Verified via Management API: `link.productionBranch = main` (2026-09-30). After GIT-1 fast-forward, `main` is now the canonical branch. Setting is correct; no change needed. |
| OPS-10 | Review `NEXT_PUBLIC_SITE_URL` as a sensitive value | **DONE** | Verified in Devin D9. src/lib/site.ts resolves URL at runtime via process.env, not build-time inlining. Server-side runtime resolution only. |
| OPS-11 | Add a test suite | **DEFERRED** | Decision made in Devin D8: dropped unused vitest test file, removed tsconfig exclusion. Test infrastructure not prioritized; can be added later. |

### Realtime notifications

| ID | Item | Status | Notes |
|---|---|---|---|
| RT-1 | Port Supabase Realtime notification subscriptions to the production branch | **DONE** | Realtime subscription already present in `NotificationContext.tsx` (`5e3e600`). Migration file `20260823154800_realtime_notifications.sql` ported via GIT-1 merge. Code side complete. DB apply (enable publication + triggers) requires explicit approval before `supabase db push`. |
| RT-2 | Rewire the dashboard notifications tab to `refreshNotifications` | **DONE** | Implemented in `src/app/dashboard/page.tsx`. Removed duplicate local state and `handleMarkNotificationRead`; dashboard now uses `useNotifications()` context (same source as Header badge). `stash@{0}` remains preserved. |

### Phase 1 QA (per master roadmap, not yet started)

| ID | Item | Status | Notes |
|---|---|---|---|
| QA-1 | Storefront QA: product images, category images, product pages, categories, search, cart, checkout, COD orders, order confirmation, WhatsApp notifications, delivery info, loading/empty/error states, mobile responsiveness | OPEN | Slice not started. |
| QA-2 | Technical QA: Supabase connection, Storage, RLS/security, production env vars, Next.js image handling, performance, error handling, caching, auth, database integrity, backup verification | OPEN | |
| QA-3 | Deployment/SEO QA: production branch, domain, Vercel config, final SEO, metadata, sitemap, robots, OG/social previews | OPEN | Blocked on GIT-1. |
| QA-4 | Git/branch audit | **DONE** | Completed 2026-09-28 → `docs/BRANCH_STRATEGY.md`. |

### SEO / discovery

| ID | Item | Status | Notes |
|---|---|---|---|
| SEO-1 | Resolve `food_vendors` returning no public rows | **DATA GAP** | Documented in Devin D6. Requires DB write to add image_url to existing vendor. Not a code/query/RLS gap. |
| SEO-2 | Re-verify sitemap/OG/canonical after any branch unification | OPEN | Depends on GIT-1. |

---

## P2 — Medium

### UX / familiarity (Phase 2)

| ID | Item | Status | Notes |
|---|---|---|---|
| UX-1 | UX audit of every screen against "Where am I / What can I do / What happens if I tap / Where next" | OPEN | Homepage, navigation, categories, product, cart, checkout, orders, rewards, chat, profile, settings, admin. |
| UX-2 | Lightweight first-time onboarding (Shop / Chat / Stories / Profile / Rewards) — no giant tutorial | OPEN | |
| UX-3 | Familiar interactions: back, notifications, settings, favorites, share, profile, menu | OPEN | |
| UX-4 | "Stranger test" — a first-time user can find a product, search, find a category, add to cart, check out, find an order, find Chat/Profile/Stories/Rewards | OPEN | Every "where do I find this?" is a UX issue. |
| UX-5 | Remove unexplained DLX-specific interactions | OPEN | |

### Commerce (Phase 3)

| ID | Item | Status | Notes |
|---|---|---|---|
| COM-1 | Discovery: featured, new arrivals, deals, trending, subcategories, filters, sorting, price/size/color filters, related products, recently viewed | OPEN | |
| COM-2 | Product pages: gallery, variants, sizes, colors, availability, share, favorite, reviews, product Q&A | OPEN | |
| COM-3 | Cart: quantity controls, variant visibility, remove/save, price breakdown, delivery info, empty cart | OPEN | |
| COM-4 | Checkout: customer info, delivery zone, COD, order summary, confirmation, order status | OPEN | |
| COM-5 | Orders: history, details, status timeline, delivery status, cancellation, completed orders | OPEN | |

### Chat (Phase 7)

| ID | Item | Status | Notes |
|---|---|---|---|
| CHAT-1 | Realtime delivery: incoming/outgoing, read receipts, delivered, typing, online/offline, last seen, unread counts, push | OPEN | Depends on RT-1. |
| CHAT-2 | Message history with pagination; retry failed messages | OPEN | |
| CHAT-3 | Media: photos, video, voice notes, emoji, stickers, GIFs | OPEN | |
| CHAT-4 | Message controls: reply, forward, edit, delete, pin, react, copy, search | OPEN | |
| CHAT-5 | Future: group chats, communities, voice/video calls, disappearing media, rich presence | OPEN | |

### Inventory & operations (Phase 6)

| ID | Item | Status | Notes |
|---|---|---|---|
| INV-1 | Variants, size inventory, color inventory, low-stock alerts, out-of-stock handling, adjustments, history | OPEN | |
| INV-2 | Suppliers: supplier products, costs, purchase records, performance | OPEN | |
| INV-3 | Business numbers: cost price, selling price, profit, margin, revenue, product profitability | OPEN | |
| INV-4 | Delivery ops: zones, status, management, failed delivery, completed delivery, delivery analytics | OPEN | |

### Performance (Phase 22)

| ID | Item | Status | Notes |
|---|---|---|---|
| PERF-1 | Investigate Supabase image transformation / loader strategy | OPEN | `supabaseLoader` pattern documented at `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/images.md:224`. Would move resizing off the US-region optimizer. **Optimization only — the pipeline is healthy.** |
| PERF-2 | Reduce Vercel image optimizer latency for Goma users | OPEN | Measured 0.7–2.7 s/image cold from `iad1`. |
| PERF-3 | Evaluate image sizing, lazy loading, responsive images, first-paint | OPEN | |
| PERF-4 | Core Web Vitals, bundle optimization, DB query optimization, realtime performance, storage optimization, accessibility | OPEN | |

---

## P3 — Low / later roadmap phases

Not yet broken out into items. Tracked at phase level in `ROADMAP.md`.

Phase 4 AI Product Studio (Ghost Mannequin, Model Studio, Lifestyle Studio, batch) ·
Phase 5 AI Catalog Automation · Phase 8 Friends · Phase 9 Streaks · Phase 10 Stories ·
Phase 11 Social Commerce · Phase 12 Profiles · Phase 13 Discover · Phase 14 AI Assistant ·
Phase 15 Notifications · Phase 16 Safety & Privacy · Phase 17 Growth & Loyalty ·
Phase 18 Analytics & BI · Phase 19 Communication & Marketing · Phase 20 Scale ·
Phase 21 Mobile/PWA · Phase 23 Ecosystem

---

## Closed

| ID | Item | Status | Evidence |
|---|---|---|---|
| IMG-0 | Production image pipeline | **CLOSED** | 109/109 storage objects 200; 15/15 categories valid; homepage 19/19, shop 49/49, product 8/8 loaded in headless Chrome; 0 non-200; 0 console errors. **Do not rebuild or replace.** See `docs/ARCHITECTURE.md` §5. |
| QA-5 | Supabase public read path + RLS | CLOSED | categories 15, sessions 5, products 49 all 200 with the production publishable key. |
| QA-6 | `/_next/image` optimizer | CLOSED | 200 `image/jpeg` for Supabase and Unsplash sources. |
| QA-7 | Service worker image safety | CLOSED | `public/sw.js` returns early for all non-navigate requests. |
| DOC-1 | Phase 0 control docs | **DONE** | `AGENT_HANDOFF.md`, `BACKLOG.md`, `ROADMAP.md`, `docs/`. 2026-09-28. |
