# CHECKPOINT — Production Readiness Audit

**Date:** 2026-10-04
**Scope:** Full production-readiness pass over P9–P16 plus the live deployment.
**Verdict:** **Local code is production-ready. Production is NOT — it is running an old build against an old database.** Deploying requires applying pending migrations first.

---

## 1. Headline finding

The repository is far ahead of what is live. Two independent gaps must both be closed before the current code can ship:

| Gap | State |
|---|---|
| **Code** | P6–P16 exists **only in the working tree — it is uncommitted.** `main` @ `e760c09` (also `origin/main`) is a docs-only commit containing none of it, and production runs an even older build (no `/discover`, `/studio`, `/partner/dashboard`). |
| **Database** | Production is missing **37 of the 40 read-only RPCs** the app calls. Every feature built on the RPC layer is non-functional live. |

The storefront still works in production because it reads `products`/`categories` directly from tables. Everything that depends on the function layer fails silently.

## 2. RPC drift (read-only audit, nothing applied)

Probed each read-only RPC (`get_`/`list_`/`search_`/`quote_` prefixed) via `GET /rest/v1/rpc/<name>`. Response signatures are unambiguous:

- `Authentication required` → **function exists**, auth failed (correct behaviour)
- `Could not find the function ... in the schema cache` → **function does not exist**

Result: **3 present, 37 missing.** Mutating RPCs were deliberately *not* probed (a `GET` could execute a write).

Missing groups and the live features they disable:

- **Social graph** — `get_my_friends`, `get_my_followers`, `get_my_following`, `get_friend_suggestions`, `get_close_friends`, `get_blocked_profiles`, `get_restricted_profiles`, `get_muted_profiles`, `get_my_friend_requests`, `get_my_shared_products`, `search_profiles`
- **Stories** — `get_stories_feed`, `get_story_viewers`, `get_my_stories`
- **Growth / loyalty** — `get_loyalty_summary`, `get_my_streak`, `get_points_history`, `get_referral_code`, `get_referrals`, `get_personalized_promotions`, `get_active_bundles`, `get_active_flash_sales`, `get_cart_recovery_offer`
- **Notifications** — `get_my_notifications`, `get_my_notification_preferences`, `get_my_notification_summary`, `get_my_message_opt_ins`
- **Chat / assistant** — `get_assistant_turns`, `get_my_assistant_conversations`, `search_the_catalogue`
- **Discovery / social proof** — `get_recently_viewed`, `get_trending_products`, `get_social_recommendations`, `get_product_social_proof`
- **Commerce extras** — `quote_coupon`, `get_shop_stats`

Also confirmed present but auth-gated: `get_my_rewards_summary`, `list_my_conversations`, `list_staff_profiles`.

## 3. Live deployment smoke test (Playwright + system Chrome)

Two real deployments tested: `dlxstore-dlx2.vercel.app`, `dlxstore-flax.vercel.app`.

### Local build — 94 / 96 passed

Only failure: `rpc/get_product_social_proof` → 404. **Not a code defect** — the local build talks to the production database, which lacks that function (see §2). Four earlier "failures" were harness timing artifacts and were disproved by direct inspection: `/shop` does render 49 products with 49 optimizable images, and `/dashboard`, `/partner/dashboard`, `/admin/dashboard` all correctly redirect to `/auth` when signed out.

### Production — 81 / 93 passed, 9 real findings

Genuine issues, all already **fixed in local code** but **live right now**:

1. **Service worker caches private routes.** `/dashboard` was served from cache while offline (`HTTP 200`). This is the P15 privacy leak, unfixed in production. Anyone who visited `/dashboard`, `/admin`, or `/partner` while signed in can read that page's cached HTML offline on a shared device.
2. **Push notification images 404.** `/icons/icon-192x192.png` and `/icons/badge-72x72.png` both 404, so every notification ships a broken image.
3. **Not installable.** Manifest exposes only a 512 icon, no 192 icon, and no `apple-touch-icon`. Home-screen install is unavailable on iOS and shows a poor prompt on Android.
4. `/partner/dashboard` → 404 (P14 not deployed)
5. `/discover` → 404 (P7 not deployed)
6. `/studio` → 404 (visual studio not deployed)

Two further failures were harness artifacts, not app defects: `net::ERR_ABORTED` on Next.js `_rsc=` prefetches (benign, cancelled on navigation) and one `net::ERR_NETWORK_CHANGED` caused by the harness's own offline toggle.

## 4. Verification gates

| Gate | Result |
|---|---|
| `tsc --noEmit` | **exit 0** |
| `eslint .` | **0 errors**, 137 warnings |
| `next build` | **success** — 49 routes, 26/26 static generation |
| `git diff --check` | **clean** |
| `p13_communication.sql` | **64 pass / 0 fail** (re-run after migration edits) |
| `p14_marketplace.sql` | **97 pass / 0 fail** (re-run after migration edits) |
| Migration idempotency | 44 / 45 re-apply cleanly on local DB |

Lint warnings are pre-existing and were triaged as false positives or low-value: `set-state-in-effect` on hydration-safe effects, `no-explicit-any` at Supabase boundary casts, and `alt-text` reports on `<Image>` where `alt` is a required prop passed via a spread.

## 5. Migration audit

- 45 migration files; all 39 `DROP TABLE` statements use `IF EXISTS`; **no unguarded `DELETE FROM`** anywhere.
- **Fixed:** 5 migration files created policies without a preceding `DROP POLICY IF EXISTS`, so they could never re-apply. Guards added in:
  - `20260928100000_notification_security_and_realtime.sql`
  - `20260928101000_chat_lifecycle_foundation.sql`
  - `20260928102000_social_foundation.sql`
  - `20260928104000_coupon_privacy_hardening.sql`
  - `20260930110000_visual_studio_job_hardening.sql`
- **Known non-issue:** `20260823160000_permanent_categories_and_sessions.sql` still fails to re-apply locally because the local `categories` table lacks `image_url`. Production read-only inspection confirms the column exists, and `supabase/schema.sql` (the frozen baseline) defines it. This is local drift, not a migration defect.

## 6. Environment audit

18 variables referenced in code. Absent from `.env.local` but all classified as optional, platform-injected, or gracefully degraded — **none block a deploy**:

`DLX_CATALOG_AI_API_KEY`, `DLX_CATALOG_AI_PROVIDER`, `DLX_VISUAL_AI_API_KEY`, `DLX_VISUAL_AI_PROVIDER`, `DLX_WHATSAPP_*` (3), `NEXT_PUBLIC_SITE_DESCRIPTION` (fallback), `NEXT_PUBLIC_SITE_URL` (fallback chain in `src/lib/site.ts`), `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (degrades gracefully), `NODE_ENV` (platform), `SUPABASE_SERVICE_ROLE_KEY` (server-only), `VERCEL_PROJECT_PRODUCTION_URL` / `VERCEL_URL` (platform).

Actual Vercel project env values were **not** inspected — that requires Vercel access.

## 7. Accepted risks (no action taken)

- **Status endpoints expose configuration shape.** `/api/messaging/status`, `/api/visual-studio/status`, `/api/ai-catalog/status` return HTTP 200 anonymously and reveal env-var *names* and boolean presence. No secrets, no user data. The messaging UI intentionally consumes `requiredEnvironment` to render honest "channel not configured" messaging, so gating these would break intended UX. Documented rather than changed.
- **`POST /api/assistant/ask` is public and unmetered.** It searches the public catalogue by design. Today no AI provider is configured, so it serves a deterministic fallback at near-zero cost. If a paid provider is ever enabled, add rate limiting before go-live.
- **Seller page shell is static.** `/partner/dashboard` is statically rendered and only its data/mutations are RPC-gated. Correct as designed, but confirmed via browser rather than by hiding the route.

## 8. Go-live checklist (requires explicit approval)

> **⚠️ Corrected 2026-10-04.** An earlier version of this section instructed
> "Deploy `main` @ `e760c09`". **That was wrong.** `e760c09` is a docs-only commit
> from 2026-09-30 containing none of P6–P16 — no `/discover`, `/studio`,
> `/partner/dashboard`, and none of the October migrations. `origin/main` equals that
> commit, so deploying it would have shipped the same stale build that is already live.
> **The P6–P16 implementation is uncommitted and must be committed first.**

Preconditions, in order:

1. **Add `dlxstore_storage_backup_*.tar.gz` to `.gitignore`** so the 25 MB Storage backup
   is not committed. (Content is only the public `product-images` bucket — no PII, no
   credentials — but it is a recovery artifact, not source.)
2. **Produce and verify a real `pg_dump` of production.** The existing artifacts are not
   trustworthy: `dlxstore_backup_20260930.sql` is 0 bytes, `dlxstore_remote_backup.sql` is
   a schema *reconstruction* (4 INSERTs), and `dlxstore_data_backup.sql` holds only 27
   INSERTs. The 25 MB tarball is Supabase **Storage** (images), not Postgres. Applying 18
   migrations that create 40 tables without a verified dump is not acceptable.
3. **Confirm the production migration ledger** ends at `20260930110000`. The
   `supabase_migrations.schema_migrations` table is not readable with the anon key and
   `SUPABASE_SERVICE_ROLE_KEY` is absent locally, so the §2 table-probe evidence is strong
   but indirect.
4. **Commit the P6–P16 implementation** and record that new SHA. This SHA — not
   `e760c09` — is the deployment commit.

Then, still requiring explicit approval for each production write:

5. Apply the **18 October migrations** (`20261002090000` → `20261017093000`) in order.
   Review `20261007090000_revoke_internal_helper_grants.sql` first: it revokes `EXECUTE`
   from `PUBLIC`/`anon`/`authenticated` on five reward and stock helper functions. It is
   idempotent and a genuine security tightening, but it narrows live privileges — confirm
   nothing depends on calling those helpers directly.
6. Re-probe the 37 RPCs; expect `Authentication required`, not
   `Could not find the function`.
7. Push and deploy the commit from step 4 so `/discover`, `/studio`,
   `/partner/dashboard` resolve.
8. Re-run this smoke suite; confirm the offline `/dashboard` cache leak is gone and the
   192/512/apple icons all return 200.
9. Confirm Vercel env vars match §6.

Optional: add rate limiting to `/api/assistant/ask` before enabling a paid AI provider.

None of steps 1–7 were performed.

## 9. Still unverified

Authenticated browser flows (checkout, order placement, Chat, notifications, avatar, Try-On, seller, admin) — no test credentials, and creating accounts on the production database was out of scope. Live WhatsApp delivery. Real Goma network conditions, RUM, and Core Web Vitals. Native-speaker review of `ln`, `tl`, `kg`.