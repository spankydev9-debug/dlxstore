# CHECKPOINT — Feature 2: AI Catalog Automation

**Status: PARTIALLY DONE (architecture complete, live activation blocked)**
**Branch:** `main` @ `e760c09` (uncommitted working tree)
**Roadmap:** Phase 5 — AI Catalog Automation / Product Enrichment
**Checkpoint written:** after Feature 1 (Ghost Mannequin) was completed and approved.

---

## 1. What was built

The full pipeline **image → suggestion → draft → human review → published catalogue**,
with `products` and `product_images` kept as the only canonical catalogue tables.

### Database (unapplied)
`supabase/migrations/20261003090000_ai_catalog_drafts.sql`

- Adds nullable `products.seo_title`, `seo_description`, `seo_keywords` (additive,
  `IF NOT EXISTS`, no data rewritten).
- `public.ai_catalog_drafts` — staging table with per-field confidence, rationale,
  provenance, review lifecycle and a rollback comment.
- `suggestion_source` is honest: `'ai'`, `'rule_based'` (deterministic local
  output, **not** a model), `'manual'`. The UI must never label `rule_based` as AI.
- Partial unique index: one live (`draft`/`approved`) draft per product, so two
  competing suggestion sets cannot be published for the same article.
- Admin-only RLS. Customers never see or create drafts.
- `review_ai_catalog_draft(uuid,text,text,jsonb)` — `approve` / `reject` / `reopen`,
  records `reviewed_by` from the JWT (not client-asserted), accepts a field patch
  restricted to suggestion columns. Provenance and lifecycle columns are
  unreachable from the client.
- `apply_ai_catalog_draft(uuid)` — the **only** path from suggestion to catalogue.
  Refuses anything not `approved`. Touches name/description/slug/category/brand/
  colors/sizes/tags/SEO and `product_images.alt_text`. **Never** touches price,
  stock, SKU or product visibility.
- Both functions are `SECURITY DEFINER`, `search_path = public`, with
  `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated`.

### Server
- `src/services/server/user-scope.ts` — caller-scoped Supabase helper, extracted
  from `src/services/visual-studio/server.ts` so both features share one
  authentication path instead of growing two. Never uses a service-role key:
  every request runs on the caller's own JWT, so RLS and the RPCs remain the only
  authorization decision.
- `src/services/ai-catalog/provider.ts` — provider-agnostic `CatalogAnalysisProvider`
  contract, capability probe, `CatalogProviderNotConfiguredError`. No adapter is
  compiled in, so it throws honestly rather than returning a fabricated result.
- `src/services/ai-catalog/rule-based.ts` — deterministic local fallback built from
  the product's own stored data. It performs **no** image analysis and makes no
  price claim, and says so in its rationale.
- `src/services/db/ai-catalog.ts` — client data access + RPC wrappers with
  `CatalogAutomationUnavailableError` for a missing migration.

### API (all admin-only, 401/403/503 handled)
| Route | Purpose |
|---|---|
| `GET  /api/ai-catalog/status` | non-sensitive capability signal, no provider/key disclosure |
| `POST /api/ai-catalog/analyze` | stages a draft; never writes to `products` |
| `POST /api/ai-catalog/drafts/[id]/review` | approve / reject / reopen (+ optional patch) |
| `POST /api/ai-catalog/drafts/[id]/apply` | publishes an approved draft |

### UI
`src/components/admin/CatalogAssistant.tsx`, wired into the admin dashboard as the
"Assistant Catalogue" tab. Shows per-field suggestions with confidence percentages,
`À compléter` markers for missing fields, honest provenance labelling, and a
**Publier dans le catalogue** button that appears only for `approved` drafts.
Degrades to an explanatory panel when the migration is absent; the existing
"Articles & CRUD" tab is never blocked.

---

## 2. Design decisions

- **Enrich an existing product; do not create products.** The admin form already
  owns creation, so Feature 2 would otherwise have duplicated it. New articles are
  created as today, then enriched.
- **No price field at all — not even an advisory range.** An earlier draft carried
  `suggested_price_range`; it was removed rather than left as a temptation. AI
  cannot suggest a price in any form.
- **The image URL is derived from the database, never from the client.** The
  analyze route looks up the `product_images` row scoped to the target product and
  uses its stored URL. `apply_ai_catalog_draft` independently re-checks that the
  analyzed image belongs to the product. Without this, product A could be paired
  with product B's image and alt text would be written onto the wrong product.
- **Category ids are constrained twice**: the analyze route discards a category
  outside the live set, and the review RPC rejects a patched category that does
  not exist.
- **No fake AI.** With no provider configured the flow still works end-to-end and
  every draft is recorded as `rule_based`, and the UI says
  "Suggestions locales (règles, pas une IA)".

---

## 3. Verification performed

| Gate | Result |
|---|---|
| `tsc --noEmit` (full project) | **0 errors** |
| ESLint on F2 paths | **0 errors**, 1 warning |
| `next build` | **passed**, 28 routes, all 4 catalog routes registered |
| Visual Studio regression | all 5 job routes + status still compile and build after the module move |
| Tests | **none exist in this repo** — nothing to run |
| Migration execution | **never executed** — see below |

The single remaining warning is `react-hooks/set-state-in-effect` on the mount
data fetch, which matches the existing pattern in this codebase.

### The migration has NOT been executed
There is no local Postgres and no Docker daemon, and direct/pooler PostgreSQL on
port `5432` is blocked from this machine (confirmed earlier against a neutral host
as well as the project; HTTPS is reachable). The SQL was therefore **structurally
reviewed only** — statement balance, `$$` quoting, `v_patch` correctly confined to
`review_ai_catalog_draft`, and the schema's dependencies confirmed against existing
migrations. It has **not** been parsed by a real Postgres server. Treat the first
application as the real syntax test, in a disposable database, before production.

One real bug was caught and fixed during this review: an edit intended only for
`review_ai_catalog_draft` had also been inserted into `apply_ai_catalog_draft`,
where `v_patch` does not exist. It would have raised a runtime error. Removed and
re-verified structurally.

---

## 4. Still missing

1. **No AI provider adapter.** This is the single largest gap. The provider
   contract and capability probe exist, but nothing implements
   `CatalogAnalysisProvider.analyze`. The user's target — real analysis of the
   product image — therefore does not happen yet; the fallback ignores pixels and
   only re-reads stored product data. Required to close:
   - pick a specific provider,
   - add `DLX_CATALOG_AI_PROVIDER` / `DLX_CATALOG_AI_API_KEY` to the target env,
   - implement the adapter,
   - decide how source images are delivered (public bucket URL vs. base64) and how
     long the URL stays valid.
2. **No field-editing form in the review UI.** `review_ai_catalog_draft` and
   `POST .../review` both accept a patch restricted to suggestion columns, but
   `CatalogAssistant` only offers approve / reject / reopen. A reviewer who
   disagrees with a suggested field must currently reject the whole draft. Wiring
   the existing patch capability into the UI is the highest-value next task.
3. **No automated tests.** The repo has no test runner; nothing was added.
4. **SEO columns are written but not consumed.** Nothing renders
   `seo_title` / `seo_description` / `seo_keywords` yet. Intentionally left for the
   marketing/SEO slice.

## 5. Blockers

- **Provider credentials absent** — `DLX_CATALOG_AI_PROVIDER`,
  `DLX_CATALOG_AI_API_KEY`.
- **`SUPABASE_SERVICE_ROLE_KEY` absent** — not needed for this feature's
  caller-scoped path, but it blocks private-storage image delivery and any
  signed-URL work.
- **Migration unapplied** — `20261003090000_ai_catalog_drafts.sql`, and still also
  `20260930110000` and `20261002090000` from Feature 1.
- **Remote migration ledger unknown** — `supabase migration list` fails with
  `LegacyDbConnectError: Connection timed out`; port `5432` blocked. An operator
  must review and apply through the approved database workflow.
- **No production contact** — no database write, migration, deploy or push was
  performed at any point.

## 6. Operational notes

- All work is **uncommitted** in the working tree. Nothing was staged, committed,
  pushed, rebased or reset. The three pre-existing stashes were left untouched.
- Pre-existing untracked files `src/lib/product-share.ts` and
  `src/lib/schema-unavailable.ts` are orphans from earlier work; they were **not**
  adopted, referenced or modified by this feature.
- `src/services/visual-studio/server.ts` was moved to
  `src/services/server/user-scope.ts` and `VisualAuthError` was renamed to
  `UserScopeAuthError`. The change is internal: all five Visual Studio job routes
  were re-pointed, the public behaviour and status contract are unchanged, and
  `tsc` + `next build` confirm no regression.
- The admin dashboard now has 4+1 tabs; verify visually once the migration is
  applied.
