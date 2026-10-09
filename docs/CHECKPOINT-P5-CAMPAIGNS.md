# CHECKPOINT — P5: campaigns, launch banner, admin controls

**Status: BUILT, TYPE-SAFE, LINT-CLEAN, PRODUCTION BUILD PASSES, VERIFIED IN A REAL BROWSER, COMMITTED LOCALLY.**
**Branch:** `main` · **Commit:** `48085a5` (base `796ccb4`) · **Date:** 2026-10-09 · **Pushed:** no
**Scope:** the approved P5 increment — campaigns, the storefront launch banner, admin controls.
No migration applied. No production write. No push. No deploy.

Standing rule honoured throughout: **never fabricate savings.** Every number the banner prints
comes from the campaign row, and the write path now refuses a campaign whose banner and coupon
disagree.

---

## 1. Production facts established this increment (read-only)

Project `szhkesvvrgcxbxucodzz`, re-read 2026-10-09.

| Question | Verified reality |
|---|---|
| Rows in `campaigns` | **0.** |
| Rows in `personalized_promotions` | **0.** |
| Rows in `coupons` | **3**, and **none of them can currently redeem**: `DLX2001` (percentage 20, `active = true`) expired **2026-08-30**, `2073` (percentage 35, `active = true`) expired **2026-08-29**, and the only unexpired one — `DLX5-1e75629a`, expires 2026-11-02 — has **`active = false`**. |
| `campaigns` constraints | `campaigns_channel_check` = `in_app, whatsapp, push, email`; `campaigns_segment_check` = `all, vip, gold, new, inactive, birthday`; `campaigns_check` = `ends_at > starts_at`; `campaigns_discount_percent_check` = null or `> 0 and <= 90`; `campaigns_min_order_check` = `>= 0`; `campaigns_slug_key` UNIQUE; **`campaigns_coupon_code_fkey` → `coupons(code)` ON DELETE SET NULL.** |
| `campaigns` RLS | `Anyone can read active campaigns` — SELECT, `is_active = true`, **no date window**; `Admins manage campaigns` — FOR ALL, `is_admin()`. |
| `coupons` RLS | **One policy only:** `Admins manage coupons` (FOR ALL, `is_admin()`). Probed through PostgREST with the browser key: `GET /rest/v1/coupons` → **HTTP 200 `[]`**. Customers cannot read coupon rows at all. |
| Config note that cost a probe | `.env.local` has **`NEXT_PUBLIC_SUPABASE_ANON_KEY` empty**; the app authenticates with **`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`** (`sb_pub…`). Use the publishable value for any anonymous-role probe. |

Consequences that shaped the build:

* The launch campaign **cannot be seeded as a single row.** A campaign carrying a `coupon_code`
  needs that code to exist (FK), and to advertise a real saving the code has to be active,
  unexpired and un-exhausted. Production has no such coupon, so **"We are now open" needs two
  production writes in order: a coupon first, then the campaign.** Both are owner decisions.
* Because `coupons` is invisible to the customer role, the storefront **cannot** verify a
  campaign's code at render time. The guard therefore belongs on the admin write path (§4), and
  the durable fix is a `SECURITY DEFINER` read RPC (§7).

## 2. What already existed, and what was genuinely missing

Mapped before writing anything, per the "no duplicate services, tables or UI" rule.

| Existing | State found | Action taken |
|---|---|---|
| `public.campaigns` table + grants + both RLS policies | shipped in `20261014090000` (P11), applied | Reused. **No new table, no migration.** |
| `src/services/db/messaging.ts` campaign reads (`getCampaigns`, `isCampaignLive`) | P13 built them for outbound sends only | **Not copied.** messaging now re-exports the single implementation: `export type MessagingCampaign = Campaign; export { getCampaigns, isCampaignLive } from "./campaigns";` so the Message Center and the storefront banner cannot disagree about what "live" means. |
| Admin dashboard | 15 tabs, no campaign editor | Added a `campaigns` tab (registered in `VALID_TABS`, tab list and render branch). |
| Customer-facing campaign surface | **none** — nothing read a campaign | Added `CampaignBanner`, mounted in `StorefrontShell`. |
| `src/lib/store-config.ts` `homepage_banners` / `homepage_promotions` | normalised and **rendered by nothing** — a dead parallel model | Deliberately **not** built out. Left as-is; listed in §7 as the reconciliation item. |
| `getPersonalizedPromotions` / `dismissPromotion` + `LoyaltyPanel` | already the welcome/loyalty reward surface, live in the account page | Reused rather than duplicated; no second reward UI built. |

## 3. Files

| File | Change |
|---|---|
| `src/services/db/campaigns.ts` | **new** — the one data layer for `campaigns`: `CAMPAIGN_COLUMNS`, `getCampaigns`, `validateCampaign`, `saveCampaign`, `updateCampaign`, `describeWriteError`, `describeCouponProblem`, `isCampaignLive`, `getLiveInAppCampaigns`, exported `CAMPAIGN_CHANNELS` / `CAMPAIGN_SEGMENTS`. |
| `src/components/shared/CampaignBanner.tsx` | **new** — storefront banner; route allow-list, per-slug dismissal in `localStorage`, copy built only from campaign fields, copy-to-clipboard coupon chip. |
| `src/components/admin/CampaignControls.tsx` | **new** — create/edit form + list; channel and segment options imported from the service, not restated. |
| `src/components/shared/StorefrontShell.tsx` | mounts `<CampaignBanner />` between `<Header />` and the category rail. |
| `src/app/admin/dashboard/page.tsx` | `campaigns` tab (import `Megaphone`, `CampaignControls`, `VALID_TABS`, tab list, render branch). |
| `src/types/index.ts` | canonical `Campaign` interface (the shape the table actually returns). |
| `src/services/db/messaging.ts` | de-duplicated as above. |
| `src/lib/i18n.ts` | 21 campaign keys in **all six** locales (`fr, en, sw, ln, tl, kg`). Non-`fr` locales are typed `typeof fr`, so parity is compiler-enforced — a missing key fails `tsc`. |

Nothing was written to any database.

## 4. Findings the build fixed rather than documented

1. **A banner advertising a discount nobody could redeem.** `campaigns.discount_percent` is not
   consumed anywhere at checkout — grep confirms the only saving mechanism is the coupon
   (`checkout/page.tsx:117` → `coupon?.coupon.code` → `quote_coupon`). The first draft of the
   banner showed "15% off" and never showed the code, so the offer was unreachable. Two fixes: the
   banner now renders the code as a copy chip (§5), and the write path refuses a campaign whose
   stated percentage the coupon does not deliver.
2. **`validateCampaign` claimed to mirror the table's CHECK constraints but missed two.** The
   `channel` and `segment` enum CHECKs were not mirrored, so an out-of-list value passed the client
   and failed as a raw Postgres error. Both lists now live in one place
   (`CAMPAIGN_CHANNELS` / `CAMPAIGN_SEGMENTS`), the validator checks them, and
   `CampaignControls` builds its `<option>` lists from the same constants.
3. **The `coupon_code` FK had no explanation.** `campaigns_coupon_code_fkey` failures surfaced as
   Postgres text; `describeWriteError` now maps them to "create it under Coupons & Promotions
   first".
4. **Client-side windowing was required, not optional.** The SELECT policy returns every
   `is_active` row to every visitor, so a campaign scheduled for next week would publish its
   coupon code early. `getLiveInAppCampaigns()` therefore applies `isCampaignLive` after the read
   and orders soonest-ending first. This is a mitigation, not a fix — see §7.

## 5. Verification — what actually ran

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | **exit 0** |
| Lint | `npx eslint` on the 8 touched files | **exit 0 — 0 errors, 7 warnings.** 6 are pre-existing on `src/app/admin/dashboard/page.tsx` (lines 135, 136, 167, 169, 817, 818). The 7th is `CampaignControls.tsx:89` — the repo's own fetch-on-mount pattern, identical to `CouponControls.tsx:44` and `MessageCenter.tsx:121`. The two `set-state-in-effect` warnings my first draft produced on `CampaignBanner` are **gone**. |
| Build | `npm run build` | **exit 0** on the final tree (all routes emitted; `/shop` static). |
| Rules | `campaigns` / `personalized_promotions` row counts | re-read **0 / 0** after all work; no write attempted. |

**Browser, dev server on `localhost:3111` against live production data:**

* `/shop` with the empty table: banner **absent**, 61 product links rendered, **no console errors**
  — the correct behaviour, not a silent failure.
* Populated states were checked with a **temporary stub** of the campaign read (never a
  production write), then reverted: the file now diffs from its pre-stub backup by exactly the
  coupon-chip feature, and `grep` confirms **zero** stub leftovers.
* Copy in `fr`: `We are now open — 15% de remise · … · dès 40.00 $ d'achat`, `Fin le 17/10/2026`,
  CTA `Voir l'offre`, dismiss label `Masquer`. Switching `dlxstore_language` to `en` re-rendered
  the same row as `15% off`, `on orders over 40.00 $`, `Ends 10/17/2026`, `Shop the offer`, `Hide`.
  `formatMoney` output matches the house convention (`40.00 $`).
* **Honesty check:** the same banner with `discount_percent: null` and `min_order: 0` printed
  **no percentage and no threshold** — only the name, the description, the end date and the CTA.
* Dismissal: click removes the banner, writes `dlxstore:dismissed-campaigns = ["we-are-now-open"]`,
  and the banner stays away after a reload. Clearing that key brings it back.
* Route guard: `/cart` shows **no** banner even with a live campaign (the shell wraps checkout,
  the dashboard and the admin console); `/product/<slug>` **does** show it.
* Coupon chip renders `GOMA10` with `aria-label="Copy code"` (reusing the existing
  `rewardsCouponCopy` / `rewardsCouponCopied` keys, so **no new i18n keys**). A real click in the
  hidden in-app tab failed with `NotAllowedError: Document is not focused` — environmental, and the
  designed fallback held: no error surfaced, the code stayed visible for manual entry. With the
  clipboard stubbed, `writeText` received exactly `GOMA10` and the icon swapped to the emerald
  check.
* **Validator battery** (`validateCampaign`, 11 cases through the shipped module): accepted the
  well-formed launch campaign and the 90% boundary; rejected an uppercase slug, a `we--open` slug,
  a blank name, a missing end date, an end before a start, 100%, 0%, a negative minimum order, an
  in-app banner with neither discount nor code, `channel = "smoke_signal"` and
  `segment = "platinum"`. Correctly allowed a coupon-only in-app banner and an outbound campaign
  with no offer.
* **Coupon-guard battery** (`describeCouponProblem`, 9 cases): flagged a code that does not exist,
  a coupon switched off, an expired coupon, an exhausted one, a coupon expiring **before** the
  campaign ends, a fixed-amount coupon under a percentage claim, and a 20% coupon under a 15%
  claim; passed a matching percentage coupon and a campaign that advertises no code. Both
  batteries ran in a temporary route (`src/app/p5-harness/`) which is **deleted** — the working
  tree contains only the eight P5 files.
* **Final tree re-checked with the stub removed:** `/shop` issues `GET /rest/v1/campaigns` against
  live production, renders **no banner** (the table is empty), still renders its 61 product links,
  and the console is **clean**.
* Admin panel: `CampaignControls` renders in a dev session (heading, 9 inputs, and `<select>`
  option lists exactly `all/vip/gold/new/inactive/birthday` and `in_app/whatsapp/push/email`).
  Its **save/update paths were not exercised** — see §6.

## 6. Explicitly unverified

1. **No campaign or coupon row was created, edited or deleted in any environment.** Every write-path
   claim in §4 rests on the pure function plus the constraint and policy rows quoted in §1, not on
   a round trip.
2. **The admin panel was never used while signed in as an admin.** No admin session exists locally
   and none was created on production. Saving the form as a signed-out visitor would have been a
   production write attempt whose success or failure I chose not to test — an INSERT that slipped
   past RLS would have created a real campaign.
3. **The banner's populated state was only ever seen through the stub.** Real rows have never
   existed; the read is proven to return `[]` cleanly, not to return a campaign.
4. **The `is_active`-only read window cannot be closed from the client for the admin list.**
   `getCampaigns()` returns every active row, so the editor can see a scheduled campaign's code.
   That is intended for admins and unsafe for the storefront; only a policy change fixes it (§7).
5. **The coupon guard relies on the admin's own read of `coupons`.** Signed out, `getCoupons(true)`
   returns `[]`, so the guard would report "no coupon named X exists" for a code that merely is not
   visible to that role. Only admins reach this form, so the failure is unreachable in practice —
   recorded because it is a real dependency, not a self-evident one.
6. **No local Postgres and no Docker**, so nothing could be dry-run against a copy of the schema.

## 7. Hazards and follow-ups found on the way

* **`get_product_social_proof` fails in the customer's console, reproduced.** Loading
  `/product/<slug>` against live production emitted **two** HTTP 400 errors for
  `…/rest/v1/rpc/get_product_social_proof`. That is the `42804` RPC from `AGENT_HANDOFF.md`, now
  observed in a real session rather than inferred — direct support for applying
  `20261018090000` (DEP-1a) without a deploy.
* **The installed Service Worker serves stale bundles.** `/sw.js` (`dlxstore-shell-v4`,
  `dlxstore-static-v4`) re-registers on every load and returned an out-of-date chunk after edits —
  it had to be unregistered and its caches deleted before the browser would run new code. Turbopack
  was also blamed until a direct `curl` proved the **server** was serving the new chunk. Worth
  knowing for any deploy verification: the alias can look unchanged because the client cached it.
* **Read-policy tightening (migration, owner approval).** Give the customer SELECT policy a date
  window (`is_active AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR
  ends_at >= now())`) and drop the client-side windowing in the same step.
* **A `SECURITY DEFINER` campaign read that can see `coupons`** would let the storefront refuse to
  render a banner whose coupon expired since it was saved. The client cannot do this: the coupon
  rows are invisible to the customer role (§1).
* **`homepage_banners` / `homepage_promotions` in `src/lib/store-config.ts`** are a second, dead
  campaign model. They should be removed or reconciled with `campaigns`; leaving both invites
  someone to build the wrong one.
* **Campaign/validation strings are English** while neighbouring admin panels (`CouponControls`)
  hardcode French. Consistent inside this file, inconsistent across the admin UI — an i18n task,
  not a defect.
* **Welcome rewards:** `personalized_promotions` is empty and `LoyaltyPanel` already renders the
  RPC-backed surface, so P5's remaining welcome-reward work is a **data/segment question**, not a
  UI build.

## 8. Owner decisions this increment needs

1. **Seed the launch properly — in dependency order:** create a real coupon (code, percentage,
   min order, expiry **at or after** the campaign end, sensible `max_uses`), then the campaign row
   that advertises it. Both are production writes; nothing here does either. The values are the
   owner's, and the guard in §4 will reject any pairing where the banner and the coupon disagree.
2. **DEP-1a:** apply `20261018090000` then `20261019090000`. Independently reinforced by the live
   400 observed in §7.
3. **DEP-1b / DEP-2:** `20261020090000` + `20261021090000`, then push and deploy — until then
   `campaigns` has no editor and the storefront has no banner in production.
4. Whether to add the read-policy tightening and the definers campaign read described in §7.

## 9. Next step

P5 is committed locally at `48085a5` and **not pushed**. Two viable moves, both waiting on §8:

1. **Take DEP-3 in order** — create a redeemable coupon, then the launch campaign — and verify the
   banner end to end with a real row instead of a stub. This is the shortest path from what is built
   to what a customer in Goma can see, and it needs no deploy for the campaign itself (the banner
   code is undeployed, so realistically it lands with DEP-2).
2. **Start P6** — the launch modal on top of the same campaign layer, then the feedback page and
   honest external sharing.

Nothing in §8 is assumed approved, and no push, deploy, migration or seed has been attempted.
