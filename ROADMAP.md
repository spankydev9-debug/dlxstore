# ROADMAP.md

DLXSTORE master roadmap. Seeded 2026-09-28. Working detail lives in `BACKLOG.md`;
evidence and rules live in `AGENT_HANDOFF.md` and `docs/`.

---

## Phase numbering: roadmap phases vs. checkpoint P-series

Two numbering schemes are in use. They are **not** interchangeable, which has caused
repeated confusion and incorrect completion claims.

- **Roadmap phases** — the `## Phase N` headings in this file. Phase 15 is Notifications,
  Phase 16 is Safety & privacy, Phase 21 is Mobile/PWA, Phase 22 is Performance/SEO/infra.
- **Checkpoint P-series** — the implementation sequence recorded in
  `docs/CHECKPOINT-P*.md`. `P6`–`P10` are Social commerce, Discover, AI Assistant,
  Notifications, Safety & privacy respectively. `F1`–`F5` are the earlier feature phases.

Mapping for the completed and remaining work, **agreed 2026-10-03**:

| P-series | Roadmap phase | State |
|---|---|---|
| P6 | 11 Social commerce | built, migration unapplied |
| P7 | 13 Discover | built, migration unapplied |
| P8 | 14 AI Assistant | built, AI provider unconfigured |
| P9 | 15 Notifications | complete |
| P10 | 16 Safety & privacy | complete |
| **P11** | **17 Growth & loyalty** | complete, local verified |
| **P12** | **18 Analytics & business intelligence** | complete, local verified |
| **P13** | **19 Communication & marketing** | complete, local verified; live WhatsApp unverified; `tl`/`kg`/`ln` strings need native-speaker review |
| **P14** | **20 Scale the business** (marketplace) | complete, local verified; no live seller or payout yet; `tl`/`kg`/`ln` strings need native-speaker review |
| **P15** | **21 Mobile / PWA** | complete, browser-verified in a real browser (Chrome, mobile + desktop, offline); see `docs/CHECKPOINT-P15-MOBILE-PWA.md` and `docs/CHECKPOINT-PRODUCTION-READINESS.md` |
| **P16** | **22 Performance, SEO & infrastructure** | image pipeline measured, **not** rebuilt; one reliability defect fixed; Core Web Vitals + PERF-4 still open |
| **Audit** | **Production readiness (P9–P16)** | local code production-ready. Re-checked 2026-10-09: **production IS deployed** (`dlxstore-flax.vercel.app` ← `main` @ `276e759`, the `git-main` alias) and the old "37 RPCs missing" figure is obsolete — the ledger is **45/45 at `20261017093000` with 4 pending**. See `docs/CHECKPOINT-PRODUCTION-READINESS.md`, corrected in `docs/CHECKPOINT-P4B-CART-SAFETY.md` §1 |
| **P0–P4b** | **2026-10-09 working series** (commits `18f250b`→`8a2fd56`, 8 ahead of `origin/main`) | See the section below; each advances an existing roadmap phase rather than opening a new one |

### 2026-10-09 working series — where each increment landed

| P | Delivered | Roadmap phase advanced | Live on production? |
|---|---|---|---|
| P0 | Chat media repaired, honest errors, UX cleanup (`18f250b`) | 7 DLX Chat | No — undeployed. Media also needs `20261020090000` |
| P1 | Explicit purchase continuation: DLX Chat vs WhatsApp (`73e47bf`) | 3 Commerce · 7 DLX Chat | No — undeployed |
| P2 | Global horizontal category rail from real catalogue categories (`98f3e68`) | 2 UX · 3 Commerce | No — undeployed |
| P3 | Chat product cards, product→Story sharing, custom orders (`46ccaa3`) | 11 Social commerce · 10 Stories · 3 Commerce | Cards work on text; custom orders gated on `20261021090000` |
| P4 | Availability classifier + purchasable/unavailable split (`c61132f`) | 3 Commerce · 6 Inventory | No — undeployed |
| P4b | Cart revalidation against the live catalogue, checkout prefill, coupon drift, false-alert and dead-code fixes (`8a2fd56`) | 3 Commerce · 6 Inventory | **Committed locally; browser-verified; not pushed, not deployed.** See `docs/CHECKPOINT-P4B-CART-SAFETY.md` |
| P5 | Campaigns, launch banner/modals, admin controls, welcome rewards, "We are now open" | 17 Growth & loyalty · 19 Communication | **NOT STARTED** — next approved increment |

Roadmap Phase 12 (DLX Profiles) has no separate P-series entry; the profile, privacy and
identity surfaces it describes were delivered inside P6 and P10.

Note that finishing P16 means finishing **both** P15 (Mobile/PWA) and P16
(Performance/SEO/infra). Both must be genuinely implemented and verified.

---

## Vision

DLXSTORE evolves from a local ecommerce storefront into a complete ecosystem.

| Pillar | Role |
|---|---|
| DLXSTORE | Commerce |
| DLX CHAT | Communication |
| DLX SOCIAL | Community |
| DLX AI | Intelligence & automation |
| DLX AI PRODUCT STUDIO | Catalog and image creation |
| DLX BUSINESS | Operations and analytics |

---

## Phase 0 — Project control & foundation

**Status: substantially complete (2026-09-28).**

| Item | Status |
|---|---|
| Protect production | Rules codified in `AGENT_HANDOFF.md` §3 |
| Preserve existing database/data | No DB writes performed; documented |
| Preserve backups | Documented; **gaps logged** (`BACKLOG.md` OPS-3/4/5) |
| No destructive Git operations | Enforced; no Git mutation performed |
| No unnecessary migrations | Enforced; none run |
| No deployment without approval | Enforced |
| Keep changes isolated and reviewable | Enforced |
| Maintain `AGENT_HANDOFF.md` | Created |
| Document architecture and decisions | `docs/ARCHITECTURE.md`, `docs/PRODUCTION_STATE.md`, `docs/BRANCH_STRATEGY.md` |
| Separate production/development environments | **Open** — `BACKLOG.md` OPS-7 |
| Maintain feature/bug backlog | `BACKLOG.md` created |
| Keep branches clearly defined | **Open** — `BACKLOG.md` GIT-1 |
| Multi-agent rules and handoff requirements | `AGENT_HANDOFF.md` §4 |

---

## Phase 1 — Production stability & verification

**Status: image pipeline CLOSED/HEALTHY. Remaining QA not started.**

### Image pipeline — CLOSED, do not rebuild

Verified 2026-09-27/28: 109/109 active product images HTTP 200; 15/15 category images
valid; homepage 19/19, shop 49/49, product page 8/8 loaded; Storage, `/_next/image`,
and production Supabase config all working; no image-related console errors; no
broken-image reproduction found. **The previous image problem is resolved and is not an
active bug.** Full evidence: `docs/ARCHITECTURE.md` §5.

### Remaining image hardening (do not touch the pipeline itself)

- `BACKLOG.md` IMG-1 — validate admin category image URLs before saving
- `BACKLOG.md` IMG-2 — validate food vendor image URLs before saving
- `BACKLOG.md` IMG-3 — replace the silent `globe.svg` fallback with an observable state
- `BACKLOG.md` IMG-4 — reuse the existing image allowlist in the admin forms
- `BACKLOG.md` IMG-5 — client-side downscale before upload

### Storefront QA — not started
`BACKLOG.md` QA-1. Product images, category images, product pages, categories, search,
cart, checkout, COD orders, order confirmation, WhatsApp notifications, delivery
information, loading/empty/error states, mobile responsiveness.

### Technical QA — not started
`BACKLOG.md` QA-2. Supabase connection, Storage, RLS/security, production env vars,
Next.js image handling, performance, error handling, caching, authentication, database
integrity, backup verification.

### Deployment / SEO QA — not started
`BACKLOG.md` QA-3. Production branch verification, production domain, Vercel
configuration, final SEO, metadata, sitemap, robots, Open Graph/social previews.

### Git / branch audit — DONE
`docs/BRANCH_STRATEGY.md`. `main` is 20 commits behind and not an ancestor; production
deploys from the feature branch; `main` uniquely holds realtime notification code and
its migration; 8 migration files exist only on the production branch. **No merge, rebase,
reset, or branch modification was performed.** Recommended strategy recorded, awaiting
approval.

---

## Phase 2 — DLX UX / familiarity

**Priority: major.** Not started. `BACKLOG.md` UX-1 … UX-5.

Goal: someone who has never used DLX understands what to do without assistance.
Navigation (Home, Search, Shop, Chat, Profile) and familiar interactions (cart, search,
back, notifications, settings, favorites, share, profile, menu).

Audit every screen against: *Where am I? What can I do? What happens if I tap this?
Where do I go next?* Lightweight onboarding — Shop / Chat / Stories / Profile / Rewards.
No giant tutorial.

**Stranger test:** a first-time user can find a product, search, find a category, add to
cart, check out, find an order, and find Chat, Profile, Stories, and Rewards. Every
"Where do I find this?" becomes a UX issue.

---

## Phase 3 — Commerce experience

**Partially delivered — not closed.** P2 (category rail), P1 (purchase continuation) and P4/P4b
(availability classifier, cart revalidation against the live catalogue, coupon/total safety) landed
2026-10-09; see `docs/CHECKPOINT-P4B-CART-SAFETY.md`. Remaining: discovery breadth (deals, new
arrivals, related, recently viewed, filters/sorting), product-page reviews & Q&A, order status
timeline and cancellation surfaces. `BACKLOG.md` COM-1 … COM-5.

Make shopping excellent before expanding the social ecosystem.

- **Discovery** — homepage, featured, new arrivals, deals, trending, categories,
  subcategories, search, filters, sorting, price/size/color, related, recently viewed
- **Product pages** — gallery, variants, sizes, colors, availability, descriptions,
  related, share, favorite, reviews, Q&A
- **Cart** — quantity, variant visibility, remove/save, price breakdown, delivery info,
  empty state
- **Checkout** — customer info, delivery zone, COD, order summary, confirmation, status
- **Orders** — history, details, status timeline, delivery status, cancellation, completed

Goal: shopping feels effortless.

---

## Phase 4 — AI Product Studio

Not started. Requires a named external AI provider and configured credentials before any
implementation.

**Ghost Mannequin Studio** — supplier uploads a normal clothing photo, DLX AI produces
clean catalogue imagery: background removal, product extraction, ghost mannequin, lighting
correction, wrinkle reduction, shadow generation, centering, cropping, consistent
dimensions, front/back, multiple angles, premium DLX style, e-commerce-ready format.

**AI Model Studio** — realistic presentation using the actual product: different poses,
environments, demographics where appropriate, full-body/lifestyle. The product must
remain recognisable.

**AI Lifestyle Studio** — streetwear, casual, luxury, indoor, outdoor, seasonal,
fashion/editorial.

**Admin flow** — upload → Make Product Photo → preview → approve → save.
**Batch** — dozens to hundreds of supplier images → consistent DLX catalogue assets.

---

## Phase 5 — AI catalog automation

**Pipeline built, activation blocked** — see `docs/CHECKPOINT-F2-AI-CATALOG.md`.
Supplier uploads material; AI suggests title, description, category, subcategory,
tags, color, size, keywords, SEO title, SEO description, alt text, attributes.
Human approves everything.

**AI suggests → human approves → product publishes.**

Status: database draft/review/apply layer, admin review UI and admin-only API routes
are implemented and build clean. The AI provider itself is not yet integrated, so
today's suggestions come from a deterministic local fallback that is explicitly
labelled as *not* AI. Enriches an existing product; product creation stays in the
admin form.

**Deliberate deviation:** price range is excluded even though listed above. AI
never suggests a price in any form — not even an advisory range. Price, stock and
availability remain operator-owned.

---

## Phase 6 — Inventory & business operations

Not started. `BACKLOG.md` INV-1 … INV-4.

Inventory and variants with low-stock alerts and history. Supplier management with costs,
purchase records, and performance. Business numbers: cost price, selling price, profit,
margin, revenue, product profitability. Delivery operations: zones, status, management,
failures, analytics.

Goal: admin becomes a real business operating system.

---

## Phase 7 — DLX Chat 1.0

Not started. `BACKLOG.md` CHAT-1 … CHAT-5, plus RT-1/RT-2.

**Core requirement: if someone sends me a message, I see it immediately.**

> ⚠️ **Current state: messages are NOT real-time on production.** The Supabase Realtime
> subscription exists only on `main`; the production branch has zero realtime code.
> See `docs/BRANCH_STRATEGY.md` §3a and `BACKLOG.md` RT-1.

Needed: realtime, read receipts, delivered, typing indicators, online/offline, last seen,
unread counts, push, history with pagination, retry, media (photos/video/voice/emoji/
stickers/GIFs), controls (reply/forward/edit/delete/pin/react/copy/search).

Future: group chats, communities, voice and video calls, camera-first sharing,
disappearing media, rich presence.

---

## Phase 8 — DLX Friend system

**Core friend graph built, activation blocked** — see `docs/CHECKPOINT-F3-FRIENDS.md`.

Done: accept, decline, remove friend, cancel a sent request, friends / followers /
following lists, friend-request notifications, `useFriends` hook, dashboard tab,
6-language i18n. Built on the already-applied `20260928102000_social_foundation`
tables and RPCs; `20261004090000_friend_graph_core.sql` adds only the missing
remove/cancel writes, the read RPCs, and the notification triggers.

Not started: block/unblock UI, **mute (no table exists anywhere)**, restrict,
close friends, user search, friend suggestions, and identity (username, profile
URL, QR sharing, picture, bio). Search and suggestions are the practical blocker
for sending requests in the first place.

Note: `profiles` RLS is self-or-admin, so every social read goes through a narrow
`SECURITY DEFINER` RPC rather than reopening the table.

---

## Phase 9 — DLX Streaks

**Built, activation blocked** — see `docs/CHECKPOINT-F4-STREAKS.md`.

Done: daily counter with hard break and preserved history, milestones 3/7/30/100/365
with in-app milestone notifications, badges (New Streak, 7, 30, 100, 365 Days),
statistics, in-app "keep it going" reminder, dashboard streak panel, shared header
counter and account-menu entry, 6-language i18n.

Design decisions: any authenticated activity advances the streak once per
Africa/Kinshasa calendar day, so there is no check-in button to forget; a missed day
resets the counter while `longest_count`, `total_active_days` and earned milestones
are permanent. Reminders are in-app only and computed on read — this project has no
scheduler (no pg_cron anywhere) and the web-push subscription route does not exist.

Not started: leaderboards, streak freezes/grace days, streak sharing to social,
admin analytics, and any push or email notification.

Security follow-up from local Postgres verification:
`20261007090000_revoke_internal_helper_grants.sql` closes an over-broad `EXECUTE`
grant class inherited from the rewards schema, where several `SECURITY DEFINER`
helpers taking an identity argument had no internal auth guard and were reachable
by an anonymous caller. See `docs/CHECKPOINT-F4-STREAKS.md` §10. Open decision:
`get_shop_stats` still exposes per-shop revenue to any caller because the app calls
it from the browser.

---

## Phase 10 — DLX Stories

Not started. Photos, video, text, music, outfits, food, daily moments, DLX purchases.
24-hour expiration, viewers, reactions, replies, mentions, close friends, privacy,
archive, highlights. **Products attach directly to stories** — "Fresh pickup, Black
Pants $15, View Product".

---

## Phase 11 — Social commerce

**Status: BUILT (2026-10-03).** See `docs/CHECKPOINT-P6-SOCIAL-COMMERCE.md`. Migration
`20261008090000_social_commerce_core.sql` verified against local Postgres; awaiting production
application. Share products with friends, share to stories, tag products, share outfits,
share carts, ask for opinions, react, vote, recommend. "Which one should I get?" — black
vs white, friends vote, buy now.

---

## Phase 12 — DLX Profiles

Not started. Picture, username, bio, friends, followers, following, stories, streaks,
favorites, badges, reviews, optional purchase activity. Badges: Early Shopper, Streak
Master, DLX OG, VIP, Top Reviewer. Users control visibility.

---

## Phase 13 — DLX Discover

**Status: BUILT (2026-10-03).** See `docs/CHECKPOINT-P7-DISCOVER.md`. Migration
`20261009090000_discover_recent_and_trending.sql` verified against local Postgres; awaiting
production application. Was originally deferred until moderation, ranking, storage and
performance foundations exist. Feed combining stories, videos, products, community. Sections: trending, fashion,
new arrivals, community, DLX creators, products, Goma, Gisenyi.

---

## Phase 14 — DLX AI Assistant

**Status: BUILT (2026-10-03).** See `docs/CHECKPOINT-P8-AI-ASSISTANT.md`. Migration
`20261010090000_ai_shopping_assistant.sql` verified against local Postgres; grounded
retrieval works, awaiting production application and AI provider configuration.
AI inside Chat. "Find me black pants under $20" → searches actual inventory.
"What goes with these?" → recommends actually-available products. "Is medium available?"
→ checks actual inventory. "Where's my order?" → checks the actual order.

Roles: shopping, discovery, support, order assistant, recommendations, size and product
guidance, catalogue assistant. **AI must use actual DLX data and never invent
availability.**

---

## Phase 15 — Notifications

**Status: COMPLETE (2026-10-03).** See `docs/CHECKPOINT-P9-NOTIFICATIONS.md`.

Unified notification center with channel-based preferences, admin broadcast, and full i18n support across 6 languages. Migration `20261012090000_notification_center.sql` is ready for production application.

---

## Phase 16 — Safety & privacy

**Status: COMPLETE (2026-10-03).** See `docs/CHECKPOINT-P10-SAFETY-PRIVACY.md`.

User controls: block, report, mute, restrict, close friends, privacy settings, story visibility, profile search, friend suggestions, admin moderation. Migration `20261013090000_safety_privacy_ui.sql` verified against local Postgres (including idempotent re-application); awaiting production application.

**Security review found and fixed three defects in the initial build:**
- `admin_get_reports` was `SECURITY DEFINER` with no admin guard, so any signed-in customer
  could read every abuse report. Now guarded by `public.is_admin()`.
- `search_profiles` did not exclude blocked users, defeating the block feature shipped in
  the same migration. Now filters symmetrically via `social_profiles_are_blocked`.
- The migration was not idempotent (`CREATE POLICY` without `DROP POLICY IF EXISTS`);
  re-application failed. Also fixed a reserved-word CTE (`window`) and anon-grant leaks in
  the Phase 13 Discover migration, which previously made it unappliable.

---

## Phase 17 — Growth & loyalty

**Status: BUILT (2026-10-03).** See `docs/CHECKPOINT-P11-GROWTH-LOYALTY.md`. Migration
`20261014090000_growth_loyalty_core.sql` verified against local Postgres, including a
21-case behavioural matrix; awaiting production application.

Points with an append-only ledger, bronze/silver/gold/VIP tiers with real benefits, referral
system, flash sales, bundles, campaigns, personalised promotions and abandoned-cart recovery.
Promo codes and coupons were already delivered in `20260818190600` and
`20260902120000_dlx_rewards_foundation.sql` and are extended rather than duplicated.

**Verification found five real defects** that `tsc`, ESLint and `next build` could not see —
most importantly the order triggers were `AFTER UPDATE` only, so orders inserted directly as
`delivered` never awarded points, and the admin RPCs were revoked but never granted.

---

## Phase 18 — Analytics & business intelligence

Complete, locally verified. Revenue, orders, AOV, best and slow sellers, category
performance, retention and repeat customers, delivery performance, inventory turnover,
profit and margins are all computed in SQL by admin-gated `SECURITY DEFINER` RPCs.
Cost of goods was added (`products.cost_price`) so margin is real rather than
assumed, and margin is reported only over the revenue whose cost is actually
recorded, alongside `cost_coverage_percent`. Unrecorded cost yields `NULL`, never a
fabricated zero. Conversion is reported only over the measured funnel
(signup → order → repeat); DLXSTORE does not track traffic, so no visitor-to-order
rate is invented. `admin_business_facts` is the only surface the assistant may
quote, so a business answer can only come from actual DLX data.
See `docs/CHECKPOINT-P12-ANALYTICS-BI.md`.

---

## Phase 19 — Communication & marketing

Not started. WhatsApp: order confirmation, status, delivery updates, customer support,
promotional. DLX push: new drops, promotions, rewards, social notifications. Goal: one
customer action → appropriate automated communication across DLX + WhatsApp.

---

## Phase 20 — Scale the business

**Status: complete and locally verified (2026-10-03).** See
`docs/CHECKPOINT-P14-MARKETPLACE.md`.

Goma → Gisenyi → other markets. Multiple delivery zones, warehouses, suppliers,
sellers. Seller onboarding, seller dashboards, seller inventory, marketplace
commissions. DLX becomes a marketplace, not only its own inventory.

Delivered: seller applications approved into real shops · per-seller order splitting ·
commission frozen at sale and settled through an auditable ledger · seller dashboard
(orders, payouts, warehouses + stock allocation, suppliers, profile) · admin console
for approvals, payouts and the commission journal · seller attribution on product pages.

Verified locally: 97 SQL assertions, 0 failed · `tsc`/lint/build clean. **Not**
verified: any live seller, live payout, or browser E2E — the full auth stack is not
running.

---

## Phase 21 — Mobile / PWA

**Status: complete and runtime-verified (2026-10-03).** See
`docs/CHECKPOINT-P15-MOBILE-PWA.md`.

Don't rush native apps. First: perfect mobile web, PWA, push notifications,
installable experience, mobile performance. Evaluate native iOS/Android only once the
product and business justify it.

Delivered: installable manifest (scope, id, shortcuts, maskable icon) · generated
192/512/maskable/apple icons · iOS standalone support · cache-first fingerprinted
build assets · offline shell that no longer caches signed-in pages · push notification
icons that previously 404'd.

Fixed en route: the app could not actually install (single 512px icon, no scope/id), and
the service worker cached `/dashboard` to disk and replayed it offline after sign-out.
Mobile *performance* remains open work under Phase 22.

---

## Phase 22 — Performance, SEO & infrastructure

Continuous technical layer. **The image pipeline remains intact** — it is a verified
reliability success, not a rebuild target.

| Area | Backlog |
|---|---|
| Image performance | PERF-1 Supabase transformation/loader strategy · PERF-2 optimizer latency · PERF-3 sizing, lazy loading, responsive, first paint |
| Other | PERF-4 Core Web Vitals, caching, bundle, DB queries, realtime, storage, accessibility, SEO, structured data |

**Resolved 2026-10-03** — see `docs/CHECKPOINT-P16-PERFORMANCE.md`. The reported
**0.7–2.7 s/image was measured and does not indicate a pipeline defect.** The image
optimizer's server time is indistinguishable from a static file on the same origin
(TTFB 111 ms vs 109 ms), and warm requests are **3.9–4.2 ms p50** across all 107
catalog images. The cost is network RTT plus a ~500 ms Vercel cold start on first touch.
The `iad1` attribution was wrong: both deployments report `x-vercel-id: cpt1` (Cape
Town). 107/107 images still return 200.

What was fixed instead: `ProductImage` defaulted to `width={400}`, which is not on
Next 16's allowlist and returned **HTTP 400** on 5 call sites. Widths are now snapped
to the nearest allowlisted value.

Rejected on evidence: capping `deviceSizes` (the apparent 100x large-width penalty was
a cache-thrash artifact — 4.3 ms in isolation — and the cap would have regressed 7 real
images) and AVIF (20% smaller but ~900 ms per image vs 4.6 ms).

**Still open:** Core Web Vitals, per-route bundle attribution, page byte budget, RUM from
real Goma sessions. Nothing has been measured *from* DRC — see the checkpoint's
limitations.

---

## Phase 23 — DLX ecosystem

Not started. Commerce, messaging, community, intelligence, catalog creation, and
operations — all connected.

### The ideal DLX loop

Discover product → see it in a story → open product → share with a friend → chat →
friend reacts → streak → buy → order appears → receive product → post to story → tag
product → another customer discovers it → cycle repeats.

---

## Development order

1. Production QA / verification — *in progress, Phase 1*
2. UX & familiarity
3. Commerce polish
4. AI Product Studio / Ghost Mannequin
5. Inventory & operations
6. Real-time DLX Chat
7. Friends
8. Streaks
9. Stories
10. Social commerce
11. Profiles / Discover
12. DLX AI
13. Growth + rewards
14. Analytics
15. Performance / scale
16. Marketplace expansion
17. PWA / native evaluation
18. Full DLX ecosystem

**Current position (2026-10-09).** Steps 1–3 are in progress, not finished: commerce polish advanced
through P1–P4b while Phase 1 QA items remain open. The next approved increment is **P5 — campaigns,
launch banner & welcome rewards** (step 13), because it is customer-facing and needs no new schema.
**AI Product Studio (step 4) and Avatar / Ghost Mannequin stay paused by project direction.**
Nothing below reaches a customer without two owner decisions: apply the 4 pending migrations, and
push + deploy local `main` (production is still at `276e759`). See `BACKLOG.md` DEP-1a/DEP-1b/DEP-2.

---

## Final objective

Not "another online store." Build DLX — a commerce platform where people shop,
communicate, discover products, share experiences, and interact with an AI-powered
ecosystem.

Working app → polished store → easy-to-use store → AI-powered catalog → real messaging →
social commerce → intelligent business → marketplace → DLX ecosystem.

### Every new feature must answer

- Does it make DLX more useful?
- Does it make DLX easier to understand?
- Does it make DLX more social?
- Does it make DLX easier to operate?
- Does it create a meaningful advantage?

If not — backlog it.
