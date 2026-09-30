# ROADMAP.md

DLXSTORE master roadmap. Seeded 2026-09-28. Working detail lives in `BACKLOG.md`;
evidence and rules live in `AGENT_HANDOFF.md` and `docs/`.

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

Not started. `BACKLOG.md` COM-1 … COM-5.

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

Not started. Supplier uploads material; AI suggests title, description, category,
subcategory, tags, color, size, keywords, SEO title, SEO description, alt text, price
range, attributes. Human approves everything.

**AI suggests → human approves → product publishes.**

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

Not started. Add friend, accept, decline, remove, block, mute, restrict, close friends,
followers, following, suggestions, user search. Identity: username, profile URL, QR
sharing, picture, bio.

---

## Phase 9 — DLX Streaks

Not started. Milestones 3/7/30/100/365 days. Counter, reminders, expiration, recovery,
milestone celebrations, badges, statistics. Badges: New Streak, 7 Days, 30 Days,
100 Days, 365 Days.

---

## Phase 10 — DLX Stories

Not started. Photos, video, text, music, outfits, food, daily moments, DLX purchases.
24-hour expiration, viewers, reactions, replies, mentions, close friends, privacy,
archive, highlights. **Products attach directly to stories** — "Fresh pickup, Black
Pants $15, View Product".

---

## Phase 11 — Social commerce

Not started. Share products with friends, share to stories, tag products, share outfits,
share carts, ask for opinions, react, vote, recommend. "Which one should I get?" — black
vs white, friends vote, buy now.

---

## Phase 12 — DLX Profiles

Not started. Picture, username, bio, friends, followers, following, stories, streaks,
favorites, badges, reviews, optional purchase activity. Badges: Early Shopper, Streak
Master, DLX OG, VIP, Top Reviewer. Users control visibility.

---

## Phase 13 — DLX Discover

Not started — delayed until moderation, ranking, storage, and performance foundations
exist. Feed combining stories, videos, products, community. Sections: trending, fashion,
new arrivals, community, DLX creators, products, Goma, Gisenyi.

---

## Phase 14 — DLX AI Assistant

Not started. AI inside Chat. "Find me black pants under $20" → searches actual inventory.
"What goes with these?" → recommends actually-available products. "Is medium available?"
→ checks actual inventory. "Where's my order?" → checks the actual order.

Roles: shopping, discovery, support, order assistant, recommendations, size and product
guidance, catalogue assistant. **AI must use actual DLX data and never invent
availability.**

---

## Phase 15 — Notifications

Not started. Unified: new message, friend request/accepted, story reaction/reply,
mention, streak, product shared, order update, promotion, reward, new drop, low-stock
admin alert. Users choose what they receive.

---

## Phase 16 — Safety & privacy

Not started. User controls: block, report, mute, restrict, message requests, privacy
settings, story visibility, close friends, who can message/follow/interact. Platform:
spam protection, abuse reporting, content moderation, admin moderation, account
restrictions, suspicious activity detection, media moderation, report review.

---

## Phase 17 — Growth & loyalty

Not started. Rewards, points, loyalty levels, shopping/streak/referral/birthday rewards,
VIP benefits. Referral system, promo codes, coupons, flash sales, bundles, discounts,
abandoned-cart recovery, campaigns, personalised promotions.

---

## Phase 18 — Analytics & business intelligence

Not started. Revenue, orders, AOV, conversion, best and slow sellers, category
performance, retention, repeat customers, delivery performance, inventory turnover,
profit, margins. AI answers real questions — what sold best, what isn't moving, which
category earned most, what to restock. **Answers must come from actual DLX data.**

---

## Phase 19 — Communication & marketing

Not started. WhatsApp: order confirmation, status, delivery updates, customer support,
promotional. DLX push: new drops, promotions, rewards, social notifications. Goal: one
customer action → appropriate automated communication across DLX + WhatsApp.

---

## Phase 20 — Scale the business

Not started. Goma → Gisenyi → other markets. Multiple delivery zones, warehouses,
suppliers, sellers. Seller onboarding, seller dashboards, seller inventory, marketplace
commissions. DLX becomes a marketplace, not only its own inventory.

---

## Phase 21 — Mobile / PWA

Not started. Don't rush native apps. First: perfect mobile web, PWA, push notifications,
installable experience, mobile performance. Evaluate native iOS/Android only once the
product and business justify it.

---

## Phase 22 — Performance, SEO & infrastructure

Continuous technical layer. **The image pipeline remains intact** — it is a verified
reliability success, not a rebuild target.

| Area | Backlog |
|---|---|
| Image performance | PERF-1 Supabase transformation/loader strategy · PERF-2 optimizer latency · PERF-3 sizing, lazy loading, responsive, first paint |
| Other | PERF-4 Core Web Vitals, caching, bundle, DB queries, realtime, storage, accessibility, SEO, structured data |

**Known OpenCode finding:** cold-cache image latency reaches roughly **0.7–2.7 s/image**
from the `iad1` Vercel region while the audience is in Goma, DRC. Treated as a
performance optimisation opportunity, **not** an image reliability bug.

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
