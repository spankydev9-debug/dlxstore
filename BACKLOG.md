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
| GIT-2 | Preserve the Git stashes | OPEN (standing) | **4 stashes** as of 2026-10-30 (`stash@{0}`–`stash@{3}`); all intact and untouched. No `drop`/`clear`/`pop` without approval. Detail in `AGENT_HANDOFF.md` §6. |
| AUTH-1 | P0 signup/auth freeze: never leave the account area loading forever | **DONE (hardened; freeze not reproduced)** | The freeze could **not** be reproduced: 11 scenarios (auth lock contention, service worker, email-confirmation round-trip, build drift) all behaved correctly against production-identical auth config. The mechanism that *could* produce it was found and removed instead: (1) transport-level 30 s deadline on every Supabase fetch (`src/lib/request-deadline.ts`, wired via `createClient({ global: { fetch } })`) so no request can stay pending; (2) the authenticated shell paints from the last known profile (`dlxstore_profile_cache`) while the read is in flight; (3) failures are classified (`session-unverified` / `profile-unavailable` / signed-out) and every consumer gets `isLoading = false`; (4) the client-side profile INSERT was deleted — `profiles` grants only SELECT+UPDATE to `authenticated`, so it could never succeed and its swallowed error caused a silent sign-out. Retry panels added to `/dashboard`, `/admin/dashboard`, `/partner/dashboard`. Evidence: `npm test` 15/15; browser: guest → `/auth`, signup → dashboard in 757 ms, reload 3 ms with no spinner, Kong-down → `session-unverified` panel in 1.4 s with **no** redirect and token intact, retry recovers in 430 ms; missing profile → `profile-unavailable` panel, token intact, retry recovers in 336 ms. |

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
| OPS-11 | Add a test suite | **DONE** | `npm test` runs Node's built-in runner (`node --test "tests/*.test.ts"`, no new dependencies): `tests/auth-errors.test.ts` (failure classification — only a definite verdict may clear a session), `tests/inflight.test.ts` (dedupe/release/no-poisoning), `tests/request-deadline.test.ts` (a **real hung socket** is aborted at 1026 ms; caller cancellation honoured at 103 ms; fast requests unaffected; default 30 s, bogus override ignored). 15/15 pass. `tests` is excluded from `tsconfig.json` (Node runs the TS natively). |

### Realtime notifications

| ID | Item | Status | Notes |
|---|---|---|---|
| RT-1 | Port Supabase Realtime notification subscriptions to the production branch | **DONE** | Realtime subscription already present in `NotificationContext.tsx` (`5e3e600`). Migration file `20260823154800_realtime_notifications.sql` ported via GIT-1 merge. Code side complete. DB apply (enable publication + triggers) requires explicit approval before `supabase db push`. |
| RT-2 | Rewire the dashboard notifications tab to `refreshNotifications` | **DONE** | Implemented in `src/app/dashboard/page.tsx`. Removed duplicate local state and `handleMarkNotificationRead`; dashboard now uses `useNotifications()` context (same source as Header badge). `stash@{0}` remains preserved. |

### Phase 1 QA (per master roadmap, not yet started)

| ID | Item | Status | Notes |
|---|---|---|---|
| QA-1 | Storefront QA: product images, category images, product pages, categories, search, cart, checkout, COD orders, order confirmation, WhatsApp notifications, delivery info, loading/empty/error states, mobile responsiveness | OPEN | Slice not started. (Image + catalogue read paths are separately healthy — see IMG-0/QA-5.) |
| QA-2 | Technical QA: Supabase connection, Storage, RLS/security, production env vars, Next.js image handling, performance, error handling, caching, auth, database integrity, backup verification | **DONE** | 2026-10-29/30, all evidence from real runs: production project reachable read-only + `supabase migration list` clean (53 applied, 1 pending); schema rebuilt locally from 54 migrations and exercised in a real browser (signup, sign-in, sign-out, reload, guest redirects); `public.feedback` RLS/grants proven with a 32-assertion harness (guest insert 201, spoofed `profile_id`/`status`/`resolved_at` denied, guest SELECT/UPDATE/DELETE denied, member sees only own rows, admin sees all, member PATCH writes nothing); auth hardened and regression-tested (AUTH-1); error/loading states replaced everywhere auth gates a screen; fresh read-only production backup `dlxstore_backup_20261029.json` (20 tables incl. 65 products, per-table HTTP status, reload-verified); `tsc` 0, `eslint` 0 errors/146 warnings, `next build` 29 pages. Residual: PERF-4 stays PARTIAL. |
| QA-3 | Deployment/SEO QA: production branch, domain, Vercel config, final SEO, metadata, sitemap, robots, OG/social previews | **DONE (pre-deploy verified)** | `main` is the Vercel production branch (`productionBranch = main`, verified read-only); live alias `https://dlxstore-flax.vercel.app` serves `origin/main`; its `/sitemap.xml` returns 72 correct absolute URLs on the real domain. `src/app/robots.ts` disallowed `/admin/`-style prefixes that **never matched** the real routes — fixed to `/admin`, `/dashboard`, `/auth`, `/checkout`, `/cart`, `/order-tracking` (verified in the built server's `/robots.txt`); `/feedback` added to the sitemap; `/feedback` route has its own canonical + OG metadata. The robots fix reaches customers with DEP-2 (production still serves the old file until then). |
| QA-4 | Git/branch audit | **DONE** | Completed 2026-09-28 → `docs/BRANCH_STRATEGY.md`. |

### SEO / discovery

| ID | Item | Status | Notes |
|---|---|---|---|
| SEO-1 | Resolve `food_vendors` returning no public rows | **DATA GAP** | Documented in Devin D6. Requires DB write to add image_url to existing vendor. Not a code/query/RLS gap. |
| SEO-2 | Re-verify sitemap/OG/canonical after any branch unification | **DONE** | Re-verified 2026-10-29/30. Production `/sitemap.xml` = 72 URLs, all on `https://dlxstore-flax.vercel.app`, no localhost leakage; the local production build emits **18 URLs** (9 static + 9 product pages; the `http://localhost:3000` fallback is expected because the local build has no `NEXT_PUBLIC_SITE_URL`) and now includes `/feedback`. Canonical + OG verified per route (`/feedback` added). `/robots.txt` had a real defect (see QA-3) — fixed locally, ships with DEP-2. |

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
| I18N-1 | Customer-facing copy that ignores the selected language | **OPEN (confirmed defect, not fixed on purpose)** | The storefront defaults to French (6 locales available), but several surfaces are hardcoded: the **`/feedback` page** (heading, intro, category labels, placeholder, button, success/error copy, "Submitting as …") is entirely English, and the **admin console** is largely hardcoded French. Fixing `/feedback` means 12 strings × 6 locales plus the six category labels; inventing Lingála/Tshiluba/Kikongo translations at the end of a stabilization pass would ship unreviewed copy, so it is recorded instead of guessed. No functional impact: the feedback row stores a stable category *value* (`bug`, `order_delivery`, …), never the label, so switching language later needs no data migration. |

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
| PERF-1 | Investigate Supabase image transformation / loader strategy | DONE | `supabaseLoader` pattern documented at `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/images.md:224`. **Optimization only — the pipeline is healthy.** |
| PERF-2 | Reduce Vercel image optimizer latency for Goma users | DONE | Measured warm 3.9–4.2 ms p50 across all 107 catalog images; cold cost is network RTT + ~500 ms Vercel cold start. Region confusion resolved (`x-vercel-id` is edge PoP; functions run `iad1`). See `docs/CHECKPOINT-P16-PERFORMANCE.md`. |
| PERF-3 | Evaluate image sizing, lazy loading, responsive images, first-paint | DONE | `ProductImage` uses responsive `sizes` + lazy loading; first paint addressed via skeletons (see PERF-4). |
| PERF-4 | Core Web Vitals, bundle optimization, DB query optimization, realtime performance, storage optimization, accessibility | PARTIAL | 2026-10-20: `/shop` CLS 0.1526 → 0.0013 desktop / 0.0015 mobile (production build, `ShopSkeleton` grid completion + banner/rail skeletons); catalogue/campaign/settings fetches deduped ×4/×8 → ×2 (`src/lib/inflight.ts`); private/transactional routes emit `noindex, nofollow` (cart, checkout, auth, dashboard, order-tracking, admin); product wishlist + thumbnail buttons given accessible names in all 6 languages; **product + partner-breadcrumb JSON-LD moved server-side** (`product/[slug]/page.tsx`, `partners/[slug]/page.tsx`) so crawlers see `Product`/`BreadcrumbList` without executing JS, with `sku` added to the product offer. Bundle reviewed: 5 direct deps, no unused heavy library leaks (the "moment" hits are the French string `pour le moment`). Remaining: deeper structured-data (e.g. `aggregateRating` only once server-side review data exists), non-JS crawler parity for client-only surfaces. |

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
- P5 — In-app advertising, campaigns & rewards — **DONE (code) `48085a5`** 2026-10-09; banner + admin controls + coupon-honesty guard. **Open:** the "We are now open" launch itself (DEP-3, two ordered production writes). The launch **modal** is now built locally (P6 slice 1 — `src/components/shared/LaunchModal.tsx`). Never fabricate savings.
- P6 — In-app advertising surfaces beyond the banner — **modal DONE (local)** `src/components/shared/LaunchModal.tsx`: one-time-per-visitor, per-slug dismissal (`dlxstore:seen-launch-modals`), campaign-only content (no invented saving), built on the shared `Modal` primitive and the same `getLiveInAppCampaigns()` read as the banner. **Honest external sharing DONE (local)** in `src/components/product/SocialShare.tsx`: the share sheet now offers the Web Share API channel (`native_share`, already a valid `ShareChannel`/`share_events` value), recorded **only** when the OS sheet resolves, silent when the customer dismisses it, and hidden entirely when the browser has no `navigator.share` — it never claims a post was published. **Feedback system DONE (local, schema pending approval):** `src/app/feedback/` page (mobile-first, categories, validation, auth-aware), `src/services/db/feedback.ts` service layer, `src/components/admin/FeedbackAdmin.tsx` admin management (filters, status updates), and migration `20261028090000_feedback_system.sql` written (NOT applied to production). **Open:** production application of feedback migration requires explicit approval. **Safety fix DONE (local, 2026-10-21):** feedback is intended for guests **and** members (`feedback_insert_guest_or_user` allows `anon`; the page is not auth-gated). `createFeedback` now sends `profile_id = user.id` when signed in (so the `feedback_select_own_if_authenticated` policy is finally meaningful) and `NULL` for guests; the `user_email` blob was dropped from `metadata` (no unnecessary PII). Dead `getMyFeedbacks` (zero callers, no viewer UI) removed. A missing table (`PGRST205`/`42P01`) is now detected via `isTableMissing` (same helper as `sessions.ts`/`food.ts`) and raised as typed `FeedbackUnavailableError`; the customer page shows "Feedback is not available yet. Please try again later." and the admin table shows "…migration has not been applied on this installation." instead of an empty list or a raw PostgREST string. The real cause is logged once client-side via `console.warn` (PostgREST text only — never submitted content). Verified locally on build `3200`: table absent (`to_regclass=null`, 0 ledger rows), guest + authenticated submit both show the friendly message with no raw-error leak; suite 14/14 `CONSOLE_ERRORS []`. No RLS was weakened; migration untouched/unapplied.

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

## Feedback system — validated and released (2026-10-30)

`public.feedback` was hardened *before* its first application anywhere — a table that has never
been applied can still be corrected without a production write — then applied to production as
part of this release (see "Production application" below).

| Item | Status | Detail |
|---|---|---|
| Migration security model | **HARDENED** | Explicit `public.` schema qualification; explicit grants (INSERT → `anon` + `authenticated`; SELECT/UPDATE → `authenticated`; **no DELETE**); INSERT `WITH CHECK (status='new' AND resolved_at IS NULL AND (profile_id IS NULL OR profile_id = auth.uid()))` so a guest cannot plant a row in another customer's "own feedback" view, cannot self-resolve a report, and cannot forge `resolved_at`. UPDATE stays admin-only (triage is not a submitter action). Extra `profile_id` index. |
| `createFeedback` | **FIXED** | Was `insert().select().single()`. `anon` holds INSERT but **no SELECT** here, so `INSERT ... RETURNING` was filtered to zero rows and reported failure **after the row was written** — the customer would resubmit and duplicate the report. Now `return=minimal` and resolves to `void`. |
| RLS/grants proof | **32 assertions, 0 failures** | Local harness (`feedback-rls-check.sh`): grant matrix, RLS enabled, guest insert 201 / spoofed `profile_id` 401 / forged `status` 401 / forged `resolved_at` 401 / bad category 400, guest SELECT+UPDATE+DELETE denied, member insert self 201 / anonymous 201 / another profile 403 / forged status 403, read isolation (own 1, other 0, admin all), member PATCH writes nothing, admin PATCH applies `status` + bumps `updated_at`, admin can resolve, and the table has **no `ip_address` column at all** (the unused column was removed before the first production application). |
| UI reachability | **FIXED** | `/feedback` had **no link anywhere** → footer link added (`footerFeedback`, 6 locales). The admin `feedback` tab existed but had **no sidebar entry** → `Avis clients` sidebar entry added. |
| End-to-end (real browser, production build) | **PASS** | Signed-in submit → success + DB row `status='new'`, `profile_id` = customer id. Guest submit → success + DB row `profile_id NULL`. Admin console lists rows (guest + member), status change to `in_review` persisted in the DB with `updated_at > created_at`, zero console errors. |
| Production application | **DONE — 2026-10-30 release.** Applied with `supabase db push --project-ref szhkesvvrgcxbxucodzz` (the only pending migration), confirmed by `supabase migration list` (54 local / 54 applied / 0 pending) and a `200` from `/rest/v1/feedback`. The unused `ip_address` column was removed from the migration before its first application, so the table has never had an IP column anywhere. |

---

## Blocking decisions (need the owner)

| ID | Item | Status |
|---|---|---|
| DEP-1a | Apply `20261018090000` + `20261019090000` | **DONE — already applied (stale entry)** | Verified 2026-10-30 with `supabase migration list --project-ref szhkesvvrgcxbxucodzz`: both migrations show `remote = local`. The nightly deploys since 2026-10-09 carried them. The "42P10 / 42804 / function does not exist" probes recorded here were from before that deploy and no longer describe production. |
| DEP-1b | Apply `20261020090000` + `20261021090000` | **DONE — already applied (stale entry)** | Same verification: both migrations are present remotely, so chat media and custom orders are not "dark on day one" for the next deploy. Only `20261028090000` (feedback) remains unapplied. |
| DEP-2 | Push local `main` and deploy | **DONE — 2026-10-30 release.** The release commit containing this line was pushed to `main`, which is the Vercel production branch, so the Git integration built and promoted it (no manual `vercel --prod`). Verify through the browser after deploying, not just the alias — an installed service worker can serve stale bundles (checkpoint §7). |
| DEP-3 | Seed the "We are now open" launch | **CHANGED — the row now exists but is dead.** `campaigns` holds 1 row (`slug='we-are-now-open'`, `is_active=true`, window 2026-10-10 → 2026-10-11, `coupon_code=null`): the window has **expired** and there is no coupon, so `describeCouponProblem` (correctly) suppresses it and customers never saw a broken promise. Recommended housekeeping: set `is_active=false` for that row (**production write — approval required**). Re-seeding a live launch still needs a redeemable coupon first, then the campaign (owner's values). |

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
