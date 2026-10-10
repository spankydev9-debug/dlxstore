# CHECKPOINT — Seller AI Studio and Catalog routes

**Date:** 2026-10-10  
**Branch:** `main` (no commit, push, deploy, migration, or production write)  
**Scope:** Recover the seller-facing AI Product Studio and AI Catalog Automation routes without replacing existing Visual Studio or catalog infrastructure.

## Audit result

- The working tree already contained uncommitted implementations for
  `AICatalogAutomation`, `AIProductStudio`, the `/ai-catalog` route, and seller
  dashboard links. `/ai-studio` was genuinely missing.
- Visual work reuses `try_on_jobs`, `visual_job_assets`,
  `create_visual_job`, the Visual Studio provider boundary, and catalogue media.
- Catalog work reuses `ai_catalog_drafts`, its review/apply RPCs, the catalog
  provider boundary, and existing canonical `products` / `product_images`.

## Changes in this pass

- Added `/ai-studio` route metadata and a client/Suspense boundary which render
  the existing `AIProductStudio` workspace.
- Corrected the existing studio polling implementation so ESLint no longer
  reports a self-reference error; active jobs are polled every five seconds.
- Removed unused imports and an unused catalog-panel prop from the existing
  uncommitted studio components.

### Exact files changed in this pass

- `src/app/ai-studio/page.tsx` (new)
- `src/app/ai-studio/AIStudioPage.tsx` (new)
- `src/components/studio/AIProductStudio.tsx`
- `src/components/studio/AICatalogAutomation.tsx`
- `docs/CHECKPOINT-F1-F2-SELLER-AI-2026-10-10.md` (new)

## Verification

| Check | Result |
| --- | --- |
| `npx tsc --noEmit --incremental false` | Pass — zero errors |
| ESLint on all feature and seller-dashboard paths | Pass — zero errors; two existing-style `react-hooks/set-state-in-effect` warnings in `SellerDashboard.tsx` and `AICatalogAutomation.tsx` |
| `npm run build` | Pass — production build completed |
| Built route manifest | Includes `/ai-studio`, `/ai-catalog`, and all four catalog APIs |
| Production-server HTTP checks | `GET /ai-studio` → 200; `GET /ai-catalog` → 200 |

## Honest activation blockers

1. No reviewed Visual Studio provider adapter is implemented. A real visual job
   needs `DLX_VISUAL_AI_PROVIDER`, `DLX_VISUAL_AI_API_KEY`, a trusted worker,
   and `SUPABASE_SERVICE_ROLE_KEY` for private-object handling.
2. No reviewed Catalog AI provider adapter is implemented. Until configured,
   catalog drafts use the explicitly labelled deterministic `rule_based`
   fallback, not image analysis. Real analysis needs
   `DLX_CATALOG_AI_PROVIDER` and `DLX_CATALOG_AI_API_KEY`.
3. The related migrations remain unapplied:
   `20260930110000_visual_studio_job_hardening.sql`,
   `20261002090000_visual_studio_wardrobe_and_lifecycle.sql`, and
   `20261003090000_ai_catalog_drafts.sql`.
4. The current RPC/API authorization is admin-only for
   `ghost_mannequin`, `product_visualization`, and catalog drafting/review.
   Seller-dashboard links now reach real routes, but ordinary sellers cannot
   submit the protected workflows until a separately reviewed vendor-ownership
   authorization design and migration are approved. No authorization was
   broadened in this pass.

---

## Continuation — seller authorization and provider audit

### Seller authorization prepared (not applied)

`supabase/migrations/20261022090000_seller_ai_workflow_authorization.sql` is a
new, unapplied, additive migration. It reuses the established ownership chain
`products.vendor_id → vendors.id → vendors.profile_id` rather than adding a
second seller mapping.

- `can_manage_ai_product(product_id)` allows only an active vendor owning that
  product, or an admin.
- It redefines `create_visual_job` so a seller can queue
  `ghost_mannequin`/`product_visualization` only for its own product/media.
  Jobs remain owned by the caller. Provider status, output assets, private
  storage, and `promote_visual_job_output` remain worker/admin-only.
- It grants seller read access only to their own products/media, including
  inactive listings needed for the workspace; it grants no direct writes.
- Catalog draft RLS permits sellers to read only their own drafts for products
  they still own. They may stage only local `rule_based` drafts; authenticated
  clients cannot forge `ai` provenance or a provider id.
- Review and apply RPCs now permit the draft creator to review/edit/apply only
  their own currently-owned product drafts. The RPCs retain the review gate and
  keep price, stock, SKU, and visibility outside the editable set. Admins retain
  cross-seller authority.
- `/ai-studio` and `/ai-catalog` now load products through the existing
  `seller_list_my_products()` RPC, not broad catalogue reads.
- The two authenticated API submissions now attach the active Supabase access
  token as a bearer credential. The API routes therefore receive the same caller
  identity that the database RLS/RPC checks enforce; without a session the UI
  stops before submitting.

This migration depends on the three F1/F2 migrations **and**
`20261017090000_marketplace_core.sql`. Do not apply it until the remote migration
ledger proves all four are present, then test it in a disposable database first.

### Provider recommendation (researched, not integrated)

- **F1 primary: Photoroom Image Editing API.** It directly supports Ghost
  Mannequin, background removal, Virtual Model, and AI enhancement/editing in
  one server-side API, so it best matches the product-studio workflows without
  vendor stitching. Its docs specifically show `ghostMannequin.mode=ai.auto`
  for clothing listings and require an `x-api-key`.
  [Photoroom clothing workflow](https://docs.photoroom.com/tutorials/how-to-create-listing-images-for-clothing-and-apparel)
  and [API pricing](https://docs.photoroom.com/getting-started/pricing) confirm
  that editing calls consume five background-removal credits; background removal
  is documented at US$0.02/call on the Basic plan.
  [Background-removal pricing](https://docs.photoroom.com/remove-background-api-basic-plan/pricing)
- **Optional customer try-on: FASHN**, not needed for the seller F1 path. Its
  asynchronous API is aligned with the existing job ledger and costs one credit
  per v1.6 output, but it is a separate vendor and budget.
  [FASHN try-on reference](https://docs.fashn.ai/api-reference/tryon-v1-6)
- **F2 catalog analysis: OpenAI vision with structured JSON output.** It fits the
  existing `CatalogAnalysisProvider` contract: pass an approved product image,
  constrain categories to the live list, parse/validate the schema, then stage
  a draft only. The API accepts image inputs; cost is usage/token based, so a
  provider-side per-image price cannot be promised without selecting a model and
  size. [OpenAI image-input reference](https://platform.openai.com/docs/api-reference/chat/object?lang=ruby)
  and [current pricing](https://platform.openai.com/pricing) are the source of
  truth at implementation time.

Required server-only configuration after a provider decision:

- `DLX_VISUAL_AI_PROVIDER=photoroom`
- `DLX_VISUAL_AI_API_KEY` (Photoroom API key)
- `DLX_CATALOG_AI_PROVIDER=openai`
- `DLX_CATALOG_AI_API_KEY` (OpenAI API key)
- `SUPABASE_SERVICE_ROLE_KEY` (trusted worker only; private result storage,
  signing, copying output into public product media, and AI-provenance drafts)

Do not expose any of these as `NEXT_PUBLIC_*` variables. Live providers remain
unimplemented so the app does not represent a configured result as real.

### Verification in this continuation

| Check | Result |
| --- | --- |
| TypeScript | Pass — `npx tsc --noEmit --incremental false` |
| ESLint, edited TS/TSX paths | Pass — zero errors and warnings |
| Production build | Pass — `npm run build` completed after seller authorization changes |
| Production-server route checks | Pass — `GET /ai-studio` and `GET /ai-catalog` each returned 200 |
| API authentication check | Pass — unauthenticated `POST /api/visual-studio/jobs` and `POST /api/ai-catalog/analyze` each returned 401 `missing_token` |
| `supabase db lint --local` | Blocked — no local Postgres/Docker (`127.0.0.1:54322` refused) |
| Real seller upload/process/review/save | Blocked — migration unapplied; no provider/worker credentials; no test seller account used |
| Static workflow audit | Pass — UI selects only `seller_list_my_products`; database migration rechecks active-vendor ownership, product/media membership, and review/apply ownership |

### Exact files changed in this continuation

- `supabase/migrations/20261022090000_seller_ai_workflow_authorization.sql` (new, unapplied)
- `src/app/api/ai-catalog/analyze/route.ts`
- `src/app/api/ai-catalog/drafts/[id]/review/route.ts`
- `src/app/api/ai-catalog/drafts/[id]/apply/route.ts`
- `src/components/studio/AIProductStudio.tsx`
- `src/components/studio/AICatalogAutomation.tsx`
- `docs/CHECKPOINT-F1-F2-SELLER-AI-2026-10-10.md`

### Next required decisions

1. Approve a disposable-database test and the remote migration ledger review.
2. Approve Photoroom for F1 and OpenAI (including an exact vision model and
   spend limits) for F2, or select alternatives.
3. Provide isolated server/worker credentials and a retention/consent policy
   before provider calls or private-storage copies are implemented.

---

## Local testing continuation

**Local server:** `npm run dev -- -p 3017` (no migration, write, or deployment
action performed).

| Check | Result |
| --- | --- |
| Working-tree preservation | Pass — existing modified/untracked F1/F2 and unrelated seller-dashboard files remained intact; `git diff --check` passed |
| `/ai-studio` | Pass — route rendered locally and the image-selection workspace was visible |
| `/ai-catalog` | Route loaded, but its client-side data loading remained pending with no authenticated seller session/local schema; no draft or catalogue write was attempted |
| `GET /api/visual-studio/status` | 200; provider unavailable, no provider/key/service-role configuration present |
| `GET /api/ai-catalog/status` | 200; provider unavailable; clearly reports deterministic fallback capability only |
| Unauthenticated visual job submission | 401 `missing_token` |
| Unauthenticated catalog analysis submission | 401 `missing_token` |
| Invalid bearer visual submission | 401 `invalid_token` |
| Seller ownership, source-media selection, upload/process/review/save | Not executable locally: no authenticated active-seller test identity, unapplied F1/F2/seller-authorization migrations, no provider key, and no trusted worker/private storage configuration |

The visual workspace selects existing canonical `product_images`; it does not
upload arbitrary browser files. Any provider input/output upload remains a
trusted-worker responsibility and was intentionally not exercised.

---

## Production-release preparation — 2026-10-10

### Remote migration ledger (read-only reconciliation)

`supabase migration list --linked` confirmed that production already contains
the original F1/F2 and marketplace dependencies:

- `20260930110000_visual_studio_job_hardening.sql`
- `20261002090000_visual_studio_wardrobe_and_lifecycle.sql`
- `20261003090000_ai_catalog_drafts.sql`
- `20261017090000_marketplace_core.sql`
- `20261017093000_marketplace_read_rpcs.sql`

The local-only queue, in the only order a normal `supabase db push` can apply
it, is:

1. `20261018090000_fix_social_rpc_return_types.sql` — unrelated social-RPC
   function fixes; no data/table/storage changes.
2. `20261019090000_direct_chat.sql` — unrelated: expands the conversation-type
   check constraint, adds `dm_key` plus a unique index, creates a privileged
   direct-message RPC, and changes Realtime publication membership.
3. `20261020090000_chat_media_and_commerce_fix.sql` — unrelated: creates the
   public `chat-media` bucket and lets every authenticated user upload to it;
   adjusts a chat SECURITY DEFINER RPC for media-only messages.
4. `20261021090000_custom_orders.sql` — unrelated: creates custom-order tables,
   six SECURITY DEFINER RPCs, RLS policies, and a public
   `custom-order-media` bucket. Customer reference images become public URLs.
5. `20261022090000_seller_ai_workflow_authorization.sql` — the only pending
   F1/F2 migration. It is additive: seller-owned read policies, the
   ownership predicate, and replacements of existing protected AI RPCs. It
   contains no `DROP TABLE`, `TRUNCATE`, destructive data update, or public
   bucket/policy change.

Therefore F1/F2 have **no missing production dependency**. Migration 5 cannot
be pushed alone through the normal migration history while 1–4 remain pending.
Those preceding files are chronological ledger blockers, not F1/F2
dependencies, and must be separately approved, split into a separate
production release, or otherwise reconciled by the database release owner.

### Database and security audit

- The F1/F2 migration rechecks active-vendor ownership in the database using
  `products.vendor_id → vendors.id → vendors.profile_id`; a seller cannot act
  on another seller's product/media. It grants no direct canonical
  product/media writes and keeps private-result handling and visual promotion
  privileged.
- Seller catalog staging is restricted to deterministic `rule_based` drafts.
  Sellers cannot claim AI provenance or provider identifiers. Review/apply
  rechecks ownership, requires human approval, and cannot alter price, stock,
  SKU, or listing visibility.
- `supabase db lint --linked --level error --fail-on error` was read-only and
  found five *pre-existing production* function errors. The queued social-RPC
  migration fixes two (`get_trending_products`, `get_product_social_proof`).
  Three remain outside F1/F2: `get_conversation_with_realtime_data`,
  `seller_list_sub_orders`, and `seller_set_warehouse_stock`. The database is
  not lint-clean, so a full production database release is not yet approved.
- Local migration execution tests remain unavailable because local Supabase
  PostgreSQL/Docker is not running. No production row, policy, bucket, or
  migration was modified during this audit.

### Application and deployment verification

| Check | Result |
| --- | --- |
| `npx tsc --noEmit --incremental false` | Pass |
| ESLint on F1/F2 routes, APIs, components, and dashboard | 0 errors; one pre-existing `react-hooks/set-state-in-effect` warning in `SellerDashboard.tsx` |
| `npm run build` | Pass in the previous verified run; a fresh production build also compiled and type-checked, producing the current `.next/BUILD_ID` |
| Local HTTP checks | `/ai-studio`, `/ai-catalog`, visual-status, and catalog-status all returned 200 |
| Provider status | Correctly unavailable: no visual/catalog provider credentials or service-role key were detected; catalog exposes only its clearly labelled rule-based fallback |

The repository has no checked-in Vercel/Netlify/Render/Docker deployment
configuration. Deployment must supply the current public Supabase URL/key
variables plus server-only provider variables. Production visual generation
also needs a trusted asynchronous worker, private `visual-workspace` access,
and `SUPABASE_SERVICE_ROLE_KEY`; no browser or `NEXT_PUBLIC_*` variable may
hold those secrets. A reviewed provider adapter is still absent, so neither
visual generation nor real catalog-image analysis is release-functional even
if credentials are later set.

### Release gate — no deploy or migration executed

No release commit was created and no files were staged, preserving the shared
dirty tree while OpenCode may still be working. The proposed F1/F2 release
commit would include exactly the current feature routes/components/APIs,
`SellerDashboard.tsx`, this checkpoint, and
`20261022090000_seller_ai_workflow_authorization.sql`; it must **exclude** the
four unrelated pending migrations unless their owner explicitly approves a
combined release. Recheck `git status`, the remote ledger, and the exact diff
immediately before staging because an OpenCode desktop process was present
during this audit.

Required decision before any production action: approve a separate resolution
for migrations 1–4 and provide a clean test database for migration/RLS tests;
then approve the exact staged commit and ordered migration list. Until then,
do not run `supabase db push`, deploy, or represent AI output as available.

---

## Full-release continuation — migration safety and lint reconciliation

### Pending migration disposition

The remote migration ledger remains unchanged: migrations through
`20261017093000` are applied, and the following sequence is pending. The order
is both the Supabase history order and the only safe normal-push order:

1. `20261018090000_fix_social_rpc_return_types.sql` — **necessary and low
   risk.** It only replaces two read-only function bodies and fixes two proven
   production lint/runtime failures. Regression SQL exists at
   `supabase/tests/p15_social_rpc_returns.sql`.
2. `20261019090000_direct_chat.sql` — **necessary for the already-shipped
   direct-chat client paths, conditionally safe.** It replaces a check
   constraint, adds nullable `dm_key` plus a partial unique index, creates a
   caller-gated SECURITY DEFINER RPC, and adjusts Realtime publication. It has
   regression SQL at `supabase/tests/p16_direct_chat.sql`. The existing
   realtime-detail RPC it relies upon is currently broken; the forward fix in
   step 6 below repairs it before application deployment.
3. `20261020090000_chat_media_and_commerce_fix.sql` — **necessary for the
   shipped chat-media upload code, but requires explicit privacy approval.** It
   creates a public `chat-media` bucket; any authenticated user can upload and
   every object is publicly readable. It does not constrain MIME type, file
   size, or conversation-path ownership at the policy layer. Accept this only
   with an agreed retention/moderation/privacy policy.
4. `20261021090000_custom_orders.sql` — **necessary for the already-shipped
   customer/admin custom-order panels, but requires explicit privacy approval.**
   It is additive (two tables, six SECURITY DEFINER RPCs, RLS) but creates a
   public `custom-order-media` bucket. The request RPC accepts URL strings
   without verifying that each URL is an object in the caller's folder; this is
   an integrity/privacy risk to resolve or consciously accept before release.
5. `20261022090000_seller_ai_workflow_authorization.sql` — **necessary for
   F1/F2 seller workflows and additive.** It contains no destructive DDL/DML,
   public storage change, or direct seller write policy. Its database ownership
   checks remain the authority for seller product/media actions.
6. `20261023090000_release_rpc_lint_fixes.sql` — **new, prepared and
   unapplied.** It is a forward-only function-body repair with no table, row,
   RLS, bucket, grant-surface, or signature changes. It fixes all four errors
   returned by remote lint: the realtime participant alias, missing order
   reference column, F1/F2's nonexistent `products.image_url` read in
   `seller_list_my_products`, and the PL/pgSQL output-variable ambiguity in
   seller warehouse allocation. It selects the established primary
   `product_images.image_url` instead.

No migration contains `DROP TABLE`, `TRUNCATE`, or destructive production-data
deletion. Migration 19 takes a brief access-exclusive lock while replacing the
conversation type constraint; schedule that work in a low-traffic window.
Migrations 20 and 21 are not wrapped in explicit transactions, so an operator
must check the migration ledger and new storage objects after each step and use
a forward corrective migration—not a database reset—if one fails partway.

### Production-schema and lint evidence

- Read-only `supabase inspect db` checks found no blocking query and no
  pre-existing exclusive lock other than the diagnostic query itself. The only
  long-running process observed was normal Supabase Realtime replication.
- A full linked schema dump could not run because Docker Desktop is unavailable
  on this host; the Supabase CLI requires it for the dump client. That prevents
  final live object-definition comparison and local SQL execution.
- Remote lint proves the four failures existed before this continuation:
  `get_conversation_with_realtime_data` (`cp` alias missing),
  `get_product_social_proof` (bigint/integer mismatch),
  `get_trending_products` (invalid sort ordinal), `seller_list_sub_orders`
  (missing `orders.order_number`), `seller_list_my_products` (missing
  `products.image_url`), and `seller_set_warehouse_stock` (ambiguous output
  variable). The social migration repairs the middle two; the new step-6
  migration repairs the other four. None is introduced by F1/F2 code.

### Shared-tree coordination and proposed staging boundaries

The tree was rechecked without discarding anything. Two edits appeared during
this continuation and are preserved:

- `src/services/db/chat-realtime.ts` corrects chat thumbnail URLs to use the
  pending `chat-media` bucket; stage it only with migration 3.
- `src/components/shared/MobileTabBar.tsx` is unrelated visual polish; keep it
  out of the database/F1-F2 release unless its owner explicitly includes it.

Subject to the remaining gates, the exact candidate F1/F2 correction commit is:

- `src/app/ai-catalog/AICatalogPage.tsx`
- `src/app/ai-catalog/page.tsx`
- `src/app/ai-studio/AIStudioPage.tsx`
- `src/app/ai-studio/page.tsx`
- `src/app/api/ai-catalog/analyze/route.ts`
- `src/app/api/ai-catalog/drafts/[id]/apply/route.ts`
- `src/app/api/ai-catalog/drafts/[id]/review/route.ts`
- `src/components/partner/SellerDashboard.tsx`
- `src/components/studio/AICatalogAutomation.tsx`
- `src/components/studio/AIProductStudio.tsx`
- `supabase/migrations/20261022090000_seller_ai_workflow_authorization.sql`
- `supabase/migrations/20261023090000_release_rpc_lint_fixes.sql`
- this checkpoint

No commit or staging action has been taken. The current branch tip is
`045014e`; a release commit hash cannot honestly be supplied until the owner
approves the migration/privacy decisions and the shared-tree diff is frozen.

### Required pre-execution approvals and recovery plan

Before any migration or deployment, obtain all of the following:

1. A confirmed production backup/PITR retention point and a documented,
   rehearsed restore owner/target/time objective. This host cannot verify the
   project backup configuration.
2. A disposable database (or approved isolated clone) where the six migrations
   and `p15`/`p16` SQL regressions can execute before production.
3. Explicit acceptance or revision of the public `chat-media` and
   `custom-order-media` exposure model, including retention and moderation.
4. Approval of the exact frozen staged file list and commit. Recheck the remote
   migration ledger immediately before the release window.

Provider credentials and a trusted worker are still additionally required to
activate real AI processing; they are not required merely to ship the routes or
the authorization migration, and no provider result is represented as live.

### Revalidation snapshot

The linked production ledger was re-read after the release-RPC correction was
prepared. Production still ends at `20261017093000`; all six migrations
`20261018090000` through `20261023090000` remain pending in that exact order.
Remote lint still reports six pre-application errors, as expected: the social
pair belongs to step 1 and the realtime/marketplace pair plus the seller product
selector belong to step 6. This confirms they are production baseline defects,
not errors introduced by an applied candidate migration.

`git diff --check` continues to pass. The shared dirty tree is still preserved:
the collaborator's chat-media thumbnail correction remains separate from the
F1/F2 commit, and unrelated MobileTabBar styling remains excluded. No backup,
PITR retention point, recovery drill, database clone, migration execution,
staging, commit, or deployment has been performed.

---

## Release safety continuation — backups, isolated testing, and media privacy

### Backup/PITR status and recovery procedure

**Verified:** the linked production project is `szhkesvvrgcxbxucodzz`, is
`ACTIVE_HEALTHY`, and runs PostgreSQL 17.6 in `eu-west-1`. There are no preview
branches. The only other project visible to this account is the unlinked,
healthy `dlxstore-dev` project (`spohxxumrstslwyynufz`). Its remote migration
ledger is empty, so it is not a production-derived test clone.

**Not verified:** this session has no Management API access token and the CLI
does not expose production backup inventory, plan, PITR enablement, recovery
window, or a successful restore drill. Do not infer any of those from the
healthy project status. Supabase documents daily database backups for eligible
paid plans and PITR as an add-on; the project owner must check the Dashboard's
Database > Backups/PITR view and record the exact latest restore point and
retention before release. Storage objects require their own recovery plan: the
Supabase backup documentation says database backups do not include Storage API
objects.

Required recovery runbook before a production window:

1. Owner records the selected backup/PITR restore point, retention, and a
   named incident owner; verify the point predates the release window.
2. Create and validate a restore/clone in an isolated project first. Verify
   core table counts, migration ledger, RLS/RPC checks, and Storage object
   availability against an approved inventory.
3. Before production migration, freeze schema deploys, capture the current
   migration ledger, and produce an operator-approved logical database export
   plus a separate Storage object inventory/export. This host cannot create the
   logical export while Docker Desktop is unavailable.
4. If a release causes data/schema harm, stop application writes, restore the
   selected point using the Supabase Dashboard under the named incident owner,
   expect downtime, then recreate/verify non-Realtime replication or external
   integrations as required. Prefer a forward corrective migration for an
   isolated SQL defect; never use `db reset` against production.
5. Validate auth, RLS, storage access, and the migration ledger before reopening
   writes. A restore is not considered complete until the separate Storage
   recovery check passes.

### Safest available isolated migration test

The suitable target is a new Supabase preview branch or clone derived from the
current production project—not `dlxstore-dev`, whose empty ledger cannot test
migration compatibility. The project has no preview branches today. Creating
one is a cloud-resource change and needs owner approval; by default it can be
schema/config-only, avoiding production data. Synthetic seller, customer,
staff, products, images, conversation, and custom-order fixtures are sufficient
for these migrations and are preferable to copying customer data.

After an approved production-derived branch/clone exists, use its project ref
without relinking the local production configuration:

1. Read its ledger and run `supabase db push --project-ref <test-ref> --dry-run`.
2. Apply exactly `20261018090000` → `20261019090000` →
   `20261020090000` → `20261021090000` → `20261022090000` →
   `20261023090000`; do not use `--include-all` unless its empty ledger was
   intentionally created from this repository history.
3. Run remote lint, `supabase/tests/p15_social_rpc_returns.sql`, and
   `supabase/tests/p16_direct_chat.sql`; then run fixture-based RLS/storage
   tests for seller ownership, media read/write denial, custom-order reviewer
   access, and the F1/F2 draft review/apply boundary.
4. Record all output, test both allowed and denied cases, and destroy the
   disposable branch only after results are retained.

No such database has been created and no migration test has run. Docker Desktop
remains unavailable, preventing local PostgreSQL execution.

### Private-media review

Public access is **not genuinely required** for either bucket. It is currently
used only because the application stores permanent public URLs and renders them
directly:

- Chat upload code calls `getPublicUrl()` and persists URL strings in
  `message_media.file_url` / `thumbnail_url`; chat components render those
  strings directly.
- Custom-order upload code returns a public URL, persists it in
  `reference_image_urls`, and both the customer and reviewer panels render it
  directly.

The safer complete-release design is private storage plus short-lived signed
URLs. It requires a deliberate follow-up before migrations 20/21 are approved:

- **Chat media:** store object paths, not public URLs; enforce Storage SELECT,
  INSERT, UPDATE, and DELETE with conversation-participant authorization;
  require the message RPC to validate that each path belongs to the target
  conversation; mint signed display URLs only after the caller passes the same
  authorization. Consolidate the duplicate chat upload implementations and
  update all chat renderers to resolve signed URLs rather than use stored URL
  strings.
- **Custom-order media:** store object paths; enforce caller-folder upload and
  SELECT only for the owning customer or authorized admin/staff reviewer;
  validate in the request RPC that every supplied object exists in that
  caller's folder; resolve signed URLs in customer/reviewer panels. Apply
  bucket-level MIME and size restrictions in addition to client validation.

This changes the planned full release: migrations 20/21, their client services,
and their tests must be revised and tested together. It is safer than approving
the existing broad public-read policy but is not implemented in this pass, so
no claim is made that private media is ready.

### F1/F2-only versus full-release recommendation

An F1/F2-only database release is not safe through the normal history because
four earlier migrations are pending. Skipping them or recording only later
versions would make the remote migration ledger dishonest. The safest complete
plan is:

1. Freeze unrelated UI polish (`MobileTabBar`) and preserve the OpenCode chat
   thumbnail edit without staging it yet.
2. Revise pending chat/custom-order media to private-storage design, then test
   all six migrations on a production-derived isolated branch with synthetic
   data.
3. After all migration, RLS, storage, lint, route, and rollback checks pass,
   create separate reviewable commits for (a) media/direct-chat/custom-order
   release and (b) F1/F2 plus RPC corrections. Deploy them only in the tested
   ledger order.
4. Activate real AI only later, after provider adapters, credentials, worker,
   consent, and spend decisions are independently approved.

This avoids a false “F1/F2 only” release, preserves migration history, and
keeps customer media private by default. It requires explicit approval to
create the isolated branch/clone and to adopt the private-media scope.
