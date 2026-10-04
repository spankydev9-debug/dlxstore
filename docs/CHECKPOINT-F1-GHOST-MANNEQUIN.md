# CHECKPOINT — Feature 1: AI Product Studio / Ghost Mannequin

**Date:** 2026-10-01
**Branch / HEAD at time of writing:** `main` @ `e760c09` (unchanged — no commit made)
**Scope:** ROADMAP Phase 4 (AI Product Studio) plus the missing pieces of the
try-on job lifecycle described in `docs/MASTER_PROJECT_CHECKPOINT.md` §23.3/§24.1.
**Status: architecture COMPLETE and buildable — activation BLOCKED on external
provider configuration + one unapplied migration.**

---

## 1. What already existed (not rebuilt)

Per §23.1 and the `CURRENTLY ESTABLISHED` list, these were left alone and extended:

| Asset | Status |
|---|---|
| `customer_avatars` + `AvatarVisual` + `AvatarEditor` | Untouched; still the sole mannequin identity |
| `try_on_jobs` ledger | Extended, not replaced |
| `visual_job_assets` provenance table | Reused as-is |
| `visual-workspace` private bucket | Reused as-is |
| `create_visual_job` RPC | Reused as the only job-creation path |
| `product_images` catalogue media | Canonical public media; original supplier images never overwritten |
| `20260930110000_visual_studio_job_hardening.sql` | Untouched; this work is additive on top |
| `VisualStudio.tsx` (dashboard surface) | Kept; only added the `canceled` status label/icon |
| `next.config.ts` / `ProductImage` image pipeline | **Not touched** (closed/healthy per `ROADMAP.md` Phase 1) |

---

## 2. What was genuinely missing, and is now implemented

### 2.1 Migration (created, **NOT applied**)

`supabase/migrations/20261002090000_visual_studio_wardrobe_and_lifecycle.sql`

- `canceled` added to the `try_on_jobs` status CHECK (constraint dropped by name
  and recreated, preserving the original four values).
- `visual_wardrobe_items` — the wardrobe: customer-owned product/media pairings,
  with owner-only RLS, admin read, and a partial unique index for the
  "any image" (`NULL`) case that a plain UNIQUE would not dedupe.
- `save_wardrobe_item(UUID, UUID, TEXT)` — SECURITY DEFINER; derives the owner from
  `auth.uid()` and upserts, so saving twice is harmless.
- `cancel_visual_job(UUID)` — owner/admin, only from `queued`/`failed`. A running
  job is deliberately left to the worker.
- `retry_visual_job(UUID)` — issues a **fresh** `request_key` and increments
  `attempt_count`; a naive retry would collide with the idempotency index and
  silently do nothing. Re-validates that the source media is still available.
- `promote_visual_job_output(UUID, TEXT, TEXT, TEXT, BOOLEAN)` — admin-only gate
  that publishes an approved generated asset into `product_images` and records an
  `approved_catalog_output` provenance row. Idempotent: a repeated call returns the
  existing row. Customer try-on results can never reach the catalogue.

Idempotent throughout (`IF NOT EXISTS` / `OR REPLACE` / `DROP POLICY IF EXISTS`),
with a documented rollback block. No table duplicates `customer_avatars`,
`try_on_jobs`, or `visual_job_assets`.

### 2.2 Server boundary (provider-agnostic, no fake AI)

- `src/services/visual-studio/server.ts` — **new.** Caller-scoped Supabase client
  built from the caller's own JWT. It deliberately has **no service-role path**, so
  RLS and the SECURITY DEFINER RPCs stay the only authorization decision.
- `src/services/visual-studio/provider.ts` — extended with
  `describeVisualProviderCapability()` and `VISUAL_STUDIO_REQUIRED_ENV`. Reports
  booleans about configuration only; never a value, never a simulated result.
  `getVisualGenerationProvider()` still throws `VisualProviderNotConfiguredError`.

New API routes (all `force-dynamic`):

| Route | Purpose |
|---|---|
| `POST /api/visual-studio/jobs` | Create a job via `create_visual_job`; validates workflow/refs/UUID + idempotency key; returns `generation: "unavailable"` when no provider exists |
| `GET /api/visual-studio/jobs/[id]` | Job + provenance assets; RLS decides visibility; reports `result.reason: "service_role_required"` instead of a URL that would 403 |
| `POST /api/visual-studio/jobs/[id]/cancel` | Cancel |
| `POST /api/visual-studio/jobs/[id]/retry` | Retry |
| `POST /api/visual-studio/jobs/[id]/promote` | Admin-only approval → catalogue; returns `503 service_role_required` with the exact missing env var |
| `GET /api/visual-studio/status` | Pre-existing; now returns the richer capability while keeping its original `available`/`reason` contract |

### 2.3 Client data layer

`src/services/db/visual-studio.ts` — added `canceled` to `VisualJobStatus`,
`attempt_count`/`constraints`/`started_at`/`completed_at` to the row type, plus
`isVisualJobActive` / `canRetryVisualJob` / `canCancelVisualJob` predicates,
`cancelVisualJob`, `retryVisualJob`, and wardrobe read/save/remove.

### 2.4 Workspace UI (mobile-first)

- `src/hooks/useVisualStudioJobs.ts` — job lifecycle hook. Polls **only** while a
  job is genuinely moving, backs off 5s → 20s, stops entirely when nothing is
  active, and clears timers on unmount. Distinguishes `loading` / `ready` /
  `unavailable` / `error`. A missing wardrobe degrades to an empty list without
  making the workspace look broken.
- `src/components/studio/MannequinStudio.tsx` — the real workspace: mannequin
  identity, product picker, source-image picker, wardrobe, job ledger with
  cancel/retry. Touch targets are `min-h-11`. It never fabricates a result and
  states plainly that the generator is not yet connected.
- `src/app/studio/` — new `/studio` route (`noindex`, personal page), with
  `?product=<id>` deep-link preselection inside a `Suspense` boundary.
- `src/components/shared/Header.tsx` — nav entry, with a new `studio` key added
  to **all six** dictionaries (fr/en/sw/rw/ln/lu) in `src/lib/i18n.ts`.
- `src/app/product/[slug]/ProductPage.tsx` — "Essayer sur mon mannequin" entry
  point. It deep-links into `/studio` and reuses the workspace rather than
  duplicating studio UI on the product page.
- `src/components/admin/VisualStudioReview.tsx` + admin dashboard tab
  "Visuels IA" — the explicit human-approval queue. Nothing publishes
  automatically.

---

## 3. Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json --incremental false` | **0 errors** |
| `npx eslint` (touched paths) | **0 errors**, 13 warnings (`react-hooks/set-state-in-effect`, same class as the project's pre-existing 110) |
| `npx next build` | **PASS** — 24 routes; 5 new API routes dynamic; `/studio` prerendered |
| Tests | **None exist.** `package.json` has no test script and `vitest` is not installed. Pre-existing decision (checkpoint F2). |
| Git | 3 stashes intact, `HEAD` unmoved, no commit, no push |
| DB / storage / deploy | **None.** No migration applied, no production data written |

---

## 4. Still blocked — exact external dependencies

The architecture is complete; these are the only things preventing a real result.

1. **No named AI image/try-on provider.** Required server env:
   - `DLX_VISUAL_AI_PROVIDER` — e.g. a reviewed virtual try-on vendor
   - `DLX_VISUAL_AI_API_KEY`
   Never a `NEXT_PUBLIC_` key.
2. **`SUPABASE_SERVICE_ROLE_KEY` is absent.** Required for two things that cannot
   be done as an authenticated user:
   - minting a signed URL for a result in the private `visual-workspace` bucket;
   - copying an approved object from `visual-workspace` → public `product-images`
     before `promote_visual_job_output` can record it.
3. **No trusted worker** to submit/poll the provider and write
   `processing`/`completed`/`failed`, `provider_job_id`, and result assets. The
   `VisualGenerationProvider` interface is ready for the first real adapter.
4. **Garment-fidelity and data-processing policy** must be decided before
   customer images are sent to a third party (retention, cost limits, consent).
5. **Migrations `20260930110000` and `20261002090000` are unapplied.** Until
   applied, `/studio` correctly shows the "not activated" state. Applying needs the
   remote migration ledger read plus explicit operator approval (gate **P7**).

---

## 5. Defects I introduced and fixed (for the next agent)

- First draft of the create route hardcoded `p_avatar_id: null`, which the RPC
  rejects for `try_on`. Now validated and passed through.
- First draft used a client `upsert` with
  `onConflict: "product_id,source_product_image_id"`, which matches no real unique
  index, and `NULL` image ids do not dedupe. Replaced with the
  `save_wardrobe_item` RPC + partial unique index.
- `describeVisualProviderCapability()` originally let a hardcoded
  `available: false` override a genuine `available: true` once a provider lands.
  Precedence fixed.
- Two French/English copy typos in new UI strings (`amodelez-le`, `treated`) fixed.

---

## 6. Next work, in ROADMAP order

| # | Area | State after this checkpoint |
|---|---|---|
| 1 | AI Product Studio / Ghost Mannequin | **Architecture DONE** · activation blocked on §4 |
| 2 | AI Catalog Automation | Not started. Reuse the provider boundary and the human-approval gate just built; do not publish AI catalog data without review. |
| 3 | Friends | Schema exists in `20260928102000` (unapplied, **zero consumer code**) — implement against it, do not create a second social graph |
| 4 | Streaks | Not started; no schema |
| 5 | Stories | Schema in `20260928102000` (unapplied); no consumer code |
| 6 | Social Commerce | Not started |
| 7 | Discover | Not started |
| 8 | AI Shopping Assistant | Not started; must use real catalogue data, never invent availability |
| 9 | Notifications | `CONFLICTED` per §12.1 — see checkpoint C5/C8; `createNotification` still throws with 4 unguarded callers |
| 10 | Safety / Privacy | `CONFLICTED` — coupon enumeration still open |
| 11 | Loyalty / Growth | `PARTIAL` |
| 12 | Analytics | Not started |
| 13 | Marketing / SEO | `PARTIAL` |
| 14 | Seller / Marketplace | `PARTIAL` |
| 15 | PWA / Mobile / Perf | `PARTIAL`; PWA install helper still stranded on `devin-version-official` |

**Immediate next action:** Phase 5 / AI Catalog Automation, reusing
`src/services/visual-studio/provider.ts` for the provider abstraction and the
approval pattern in `src/components/admin/VisualStudioReview.tsx` for the
review-before-publish gate.
