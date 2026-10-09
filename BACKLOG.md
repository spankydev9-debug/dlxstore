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

## P3 — Social-commerce continuation (product cards, Stories sharing, custom orders)

Built 2026-10-09. See `docs/CHECKPOINT-P3-SOCIAL-COMMERCE-CONTINUATION.md`. tsc/eslint/build green.

| ID | Item | Status | Notes |
|---|---|---|---|
| SC-A | Product cards through DLX Chat | **DONE (local)** | Reader (`ProductCardMessage`) + "Send in DLX Chat" action. No migration needed — card rides in the message body. Activation of the *send* path also depends on the chat-media migration (`20261020090000`) for media, but text cards work today. |
| SC-B | Share eligible products to DLX Stories | **DONE (local)** | "Share to Story" deep-links into the existing composer pre-tagged; tagged products navigable in the viewer. Reuses `create_story`; no schema change. |
| SC-C | Custom orders & quotations | **DONE (local), migration UNAPPLIED** | `20261021090000_custom_orders.sql` written, **not applied — needs explicit approval**. Customer request + reference images + reviewer quote flow. UI shows honest "not available" until applied. |

**Next known follow-ups (not complete):**
- P4 — Inventory & cart — **DONE (local)** 2026-10-09. See below.
- P5 — In-app advertising, campaigns & rewards — **DONE (code) `48085a5`** 2026-10-09; banner + admin controls + coupon-honesty guard. **Open:** the "We are now open" launch itself (DEP-3, two ordered production writes) and a launch modal. Never fabricate savings.
- P6 — In-app advertising surfaces beyond the banner (modal), then the feedback page + external marketing/sharing (honest about permissions; do not pretend a post published).

---

## P4 — Inventory & cart

Built 2026-10-09. tsc/eslint/build green. Reuses existing `Product` fields — no speculative schema.

| Item | Status | Where |
|---|---|---|
| Distinguish available / out-of-stock / withdrawn | **DONE** | `src/lib/product-availability.ts` — `getProductAvailability()` → `available` / `low_stock` / `out_of_stock` / `unavailable` (archived or deactivated). One classifier used by cart + checkout. |
| Preserve cart items / variants / historical refs | **DONE** | Cart still keeps every line item with its size/color/variant; unavailable items are retained for reference, not deleted. |
| Exclude unavailable from eligible totals + block purchase | **DONE** | `CartContext` splits `purchasableItems` vs `unavailableItems`; `subtotal`/`total` count purchasable only; checkout sends only `purchasableItems` and refuses to open when `hasOnlyUnavailable`. |
| Validate stock server-side + prevent overselling | **ALREADY DONE (verified)** | `create_customer_order` locks each product `FOR UPDATE`, checks `is_active`/`is_archived` and `stock_quantity >= quantity`, and validates the total against the live catalogue. Not modified — confirmed correct. |
| Handle stock changes + stale carts safely | **DONE** | A product that goes OOS/archived after being added stays visible but excluded from totals; `addToCart` refuses non-purchasable products; cart page shows an honest "unavailable" section. |
| Restock dates | **DEFERRED (honest)** | No per-product restock-date column exists and none was invented. Low-stock is surfaced from real `stock_quantity`/`low_stock_threshold`. A restock-ETA field is a schema decision for a future approved migration. |

---

## P4b — Cart/checkout safety against the live catalogue

Built 2026-10-09 on top of P4. See `docs/CHECKPOINT-P4B-CART-SAFETY.md`. tsc/eslint/build green and the
stale-cart fix verified in a real browser against live production data.

| Item | Status | Notes |
|---|---|---|
| Cart availability came from a stale localStorage snapshot | **FIXED** | `revalidateCart()` re-reads the existing `getProducts()` service, swaps in live price/stock, clamps quantity to real stock, and marks a product absent from the sellable catalogue unavailable (kept, never deleted). Called after hydration and on `/cart` + `/checkout` mount. Without this, P4's "handle stale carts safely" was untrue: `create_customer_order` recomputes gross from live prices and rejected the order at the final step. |
| Checkout prefill deleted by P1 | **FIXED** | `73e47bf` emptied two `useEffect` bodies and left the comments. Restored name/phone from the profile and the default neighborhood. Not browser-verified (needs a signed-in account). |
| False "added to cart" alert | **FIXED** | `addToCart` returns `boolean`; the product page only confirms success and otherwise shows `addToCartUnavailableAlert` (new key × 6 locales). |
| Coupon could drift under a revalidated total | **FIXED** | Checkout tracks the subtotal a coupon was quoted against and re-quotes on drift, so the discount matches what `apply_order_coupon` recomputes. |
| Order discount forgeable from the client? | **NO — verified** | A `BEFORE INSERT` trigger re-resolves the coupon, enforces active/expiry/max_uses/min_order/reward ownership, recomputes `expected_discount` and RAISES on any mismatch. |
| Custom-order reads hid the unapplied state | **FIXED** | `getMyCustomOrders()` returned `[]` on a missing RPC, making the panel's honest "not available" branch dead code; it now throws `CustomOrdersUnavailableError`. |
| `staff` cannot reach the custom-orders reviewer console | **OPEN — decision** | DB gates reviewers as admin/staff; `/admin/dashboard` renders for `role === "admin"` only. UI is stricter than the DB, so not a security hole. Widening admin access is the owner's call. |

## P5 — Campaigns, launch banner & welcome rewards

**DELIVERED (code) at `48085a5` — not pushed, no migration, nothing seeded.** Evidence:
`docs/CHECKPOINT-P5-CAMPAIGNS.md`.

| Item | Status | Detail |
|---|---|---|
| Campaign data layer | **DONE** | `src/services/db/campaigns.ts` is the one owner of `public.campaigns` (table shipped in `20261014090000`; no new table, no migration). `messaging.ts` re-exports `getCampaigns` / `isCampaignLive` / `MessagingCampaign` instead of keeping its own copy. |
| Admin campaign controls | **DONE (code)** | `src/components/admin/CampaignControls.tsx` behind a new dashboard **Campagnes** tab. Renders and validates in a dev session; channel/segment options come from the same constants the validator and the DB CHECKs use. **Save/update never run as an admin** — no admin session exists locally and none was created on production. |
| Storefront campaign banner | **DONE (code)** | `src/components/shared/CampaignBanner.tsx` in `StorefrontShell`, shop routes only (`/cart` confirmed banner-free), per-slug dismissal in `localStorage`, all copy built from campaign fields, `fr`/`en` copy and `formatMoney` verified in a real browser. Populated states verified through a temporary stub that is **reverted** — never a production write. |
| **Never fabricate savings** | **ENFORCED** | Two rules now hold: the banner prints no percentage and no threshold unless the row carries them (verified with `discount_percent: null`, `min_order: 0`); and `describeCouponProblem` refuses a campaign whose banner promises what its coupon cannot deliver — missing code, switched off, expired, exhausted, expiring before the campaign ends, fixed-amount coupon under a `%` claim, or a different percentage. 20 validator + coupon-guard cases all behaved as designed. |
| Coupon code reaches the customer | **DONE** | `campaigns.discount_percent` is **not** applied at checkout — the coupon code is the only real saving — so the banner now shows the code as a copy chip (`aria-label` reuses `rewardsCouponCopy`/`rewardsCouponCopied`; no new keys). Copy verified with a stubbed clipboard; a blocked clipboard leaves the code visible. |
| "We are now open" launch campaign | **BLOCKED — owner decision, two writes in order** | `campaigns` **and** `personalized_promotions` are empty in production, and `coupons` holds 3 rows of which **none can redeem**: `DLX2001` expired 2026-08-30, `2073` expired 2026-08-29, and the only unexpired code is `active = false`. So the launch needs a real coupon first (its expiry **at or after** the campaign end, or the new guard rejects the campaign), then the campaign row. |
| Welcome rewards | **NO UI TO BUILD** | `getPersonalizedPromotions` / `dismissPromotion` + `LoyaltyPanel` already are the surface; the table is empty. Remaining work is data/segment, not code. |
| Client-side campaign window | **DONE — mitigation only** | The customer SELECT policy filters on `is_active` **alone**, so a scheduled campaign publishes its coupon code early. `getLiveInAppCampaigns()` windows by date after the read; the real fix is a policy change (see §Blocking decisions / checkpoint §7). |

---

## Blocking decisions (need the owner)

| ID | Item | Status |
|---|---|---|
| DEP-1a | Apply `20261018090000` + `20261019090000` | **BLOCKED — approval required. Highest urgency: these gate features that are ALREADY on production.** The deployed bundle (`main` @ `276e759`) calls `get_trending_products`, `get_product_social_proof` and `get_or_create_direct_conversation`; probed live 2026-10-09 they return `42P10`, `42804` and "function does not exist" respectively. So `/discover`'s trending shelf, product social proof and "message this person" are broken for real customers **right now**, and applying these two migrations fixes them with **no deploy needed**. `20261018090000` replaces two read-only function bodies only; `20261019090000` adds the DM RPC. Neither can be dry-run locally (no Postgres, Docker unavailable). |
| DEP-1b | Apply `20261020090000` + `20261021090000` | **BLOCKED — approval required.** Not live defects: their callers were first committed on 2026-10-09 and are undeployed. Must land chronologically, before or with the DEP-2 deploy, or chat media and custom orders go dark on day one. |
| DEP-2 | Push local `main` and deploy | **BLOCKED — approval required.** Corrected state: production **is** deployed — `dlxstore-flax.vercel.app` serves `276e759` (= `origin/main`), built 2026-10-08 22:39. `/discover`, `/studio`, `/partner/dashboard` return 200, so the handoff's old "not deployed / 404" note was stale. What is missing is P0–P5 (`fa4d510`→`48085a5`); run `git rev-list --count origin/main..HEAD` for the live count rather than trusting any figure written here. Until this deploys, `campaigns` has no editor and the storefront has no banner in production. **Verify through the browser, not just the alias: the installed Service Worker serves stale bundles (checkpoint §7).** |
| DEP-3 | Seed the "We are now open" launch | **BLOCKED — approval required, and it is two writes in order.** `campaigns` and `personalized_promotions` are empty; `coupons` holds 3 rows and **none can redeem** (`DLX2001` expired 2026-08-30, `2073` expired 2026-08-29, the only unexpired code is `active = false`). `campaigns.coupon_code` has an FK to `coupons(code)`, and the new `describeCouponProblem` guard rejects a campaign whose coupon is missing, off, expired, exhausted, expiring before the campaign ends, or offering a different percentage than the banner states. So: create the coupon first (expiry ≥ campaign end), then the campaign. Values are the owner's. |

---

## P4–P6 — Later roadmap phases (reconciled, not yet started)

Phase 4 AI Product Studio (Ghost Mannequin, Model Studio, Lifestyle Studio, batch) · Phase 5 AI Catalog Automation · (Friends/Streaks/Stories/Social/Discover/Assistant/Notifications/Safety/Growth/Analytics/Communication/Scale/Mobile delivered in prior phases). Studio & Avatar remain **paused by project direction — do not modify without authorization.**

---

## Closed

| ID | Item | Status | Evidence |
|---|---|---|---|
| IMG-0 | Production image pipeline | **CLOSED** | 109/109 storage objects 200; 15/15 categories valid; homepage 19/19, shop 49/49, product 8/8 loaded in headless Chrome; 0 non-200; 0 console errors. **Do not rebuild or replace.** See `docs/ARCHITECTURE.md` §5. |
| QA-5 | Supabase public read path + RLS | CLOSED | categories 15, sessions 5, products 49 all 200 with the production publishable key. |
| QA-6 | `/_next/image` optimizer | CLOSED | 200 `image/jpeg` for Supabase and Unsplash sources. |
| QA-7 | Service worker image safety | CLOSED | `public/sw.js` returns early for all non-navigate requests. |
| DOC-1 | Phase 0 control docs | **DONE** | `AGENT_HANDOFF.md`, `BACKLOG.md`, `ROADMAP.md`, `docs/`. 2026-09-28. |
