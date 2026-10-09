# CHECKPOINT — P3: Social-commerce continuation

**Status: BUILT AND TYPE-SAFE — custom-orders migration written, UNAPPLIED (pending approval)**
**Branch:** `main`
**Scope:** the three P3 follow-up items (product cards in chat, product→Story sharing,
            custom orders & quotations).
**Gates:** `npx tsc --noEmit` (0 errors) · `npx eslint` (0 errors on touched files) ·
            `npm run build` (exit 0). No production migration applied. No deploy.

---

## 1. Verified baseline before this work

| Fact | Evidence |
|---|---|
| Branch `main`, 5 commits ahead of `origin/main`, clean tree | `git status` |
| P0 `18f250b`, P1 `73e47bf`, P2 `98f3e68` present and real | `git log` |
| Baseline typecheck clean | `tsc --noEmit` exit 0 |
| Production migrations: 45/45 applied (2026-10-04); three newer local-only migrations pending | `docs/MIGRATION-CHECKPOINT.md` |
| Studio/Avatar paused — untouched | AGENTS.md |

---

## 2. P3a — Product cards through DLX Chat (writer existed, reader did not)

**Gap confirmed:** `shareProductToChat()` / `encodeProductShareMessage()` existed but no chat
component rendered the encoded `[[dlx-product:<slug>]]` token — it leaked as raw text, and there
was no UI to send a product into chat at all (documented as CHECKPOINT-P6 limitation #5).

**Delivered:**

| File | Change |
|---|---|
| `src/lib/product-share.ts` | Added `parseProductShareMessage()` (slug + sender name + note) and `productSharePreview()` for inbox previews. Slug stays authoritative; the sender name is only a display fallback. |
| `src/components/chat/ProductCardMessage.tsx` | New reader: resolves the live product by slug, renders image + name + current price/discount + a link to the product page. Degrades honestly (sender name + "no longer available") when the product is gone. |
| `src/components/chat/EnhancedChatUi.tsx` | `MessageBubble` renders a product card inline instead of raw text (used by `ModernChatInterface` on `/chat`). |
| `src/components/chat/ChatUi.tsx` | Same reader in the admin/support/internal bubble + preview. |
| `src/components/chat/ModernChatInterface.tsx` | Conversation-list preview uses `productSharePreview()` so the token never leaks into an inbox row. |
| `src/components/product/SocialShare.tsx` | New **"Send in DLX Chat"** action: opens the support conversation (same path as post-order continuation), posts the card, lands the customer in `/chat`. |

**Persistence / permissions / failure:** the card rides in the message body (no new table, no
migration), so it persists with the message and is readable by anyone who can read the
conversation. Rendering is a pure read; a missing product degrades to text, never a broken card.

---

## 3. P3b — Share eligible products to DLX Stories

**Gap confirmed:** the Stories composer already supported product tagging via `create_story`
(validated `story_products`, max 5), but there was **no entry point** to share a product into a
Story from the product page, and tagged products in the viewer were not navigable.

**Delivered:**

| File | Change |
|---|---|
| `src/components/product/SocialShare.tsx` | New **"Share to Story"** action → `/dashboard?tab=stories&share=<slug>`. |
| `src/components/account/StoriesPanel.tsx` | Reads `?share=<slug>`, auto-opens the composer once, pre-tags the product (slug→id resolved against the loaded catalogue), then clears the param so a refresh does not reopen it. Tagged products in the viewer now link to the product page. |

**Reused, not rebuilt:** the single existing composer + `create_story` validation path. No
parallel story system, no schema change. Visibility/permissions are unchanged (still enforced by
`can_view_story` and the story-media bucket policy).

---

## 4. P3c — Custom orders & quotations (entirely absent before)

**Gap confirmed:** no table, migration, service, or UI existed for a customer requesting a
non-stocked product with reference images and receiving a quotation.

**Delivered:**

| File | Role |
|---|---|
| `supabase/migrations/20261021090000_custom_orders.sql` | **UNAPPLIED.** `custom_order_requests`, `custom_order_quotes`, `custom-order-media` bucket, RLS, and 6 SECURITY DEFINER RPCs (`create_custom_order_request`, `get_my_custom_order_requests`, `list_custom_order_requests`, `submit_custom_order_quote`, `respond_custom_order_quote`, `set_custom_order_request_status`) + grants + rollback. |
| `src/services/db/custom-orders.ts` | RPC-first data layer + reference-image upload, with the established `isMissingRpc`/`CustomOrdersUnavailableError` degradation. |
| `src/components/account/CustomOrdersPanel.tsx` | Customer surface (new `/dashboard?tab=custom-orders`): submit a request with up to 6 reference images, view status + quotes, accept/decline a quote, cancel. |
| `src/components/admin/CustomOrdersConsole.tsx` | Reviewer surface (new `/admin/dashboard?tab=custom-orders`, admin/staff): filter the queue, view references + contact preference, send a real quotation, mark fulfilled/declined. |
| `src/types/index.ts` | `CustomOrderRequest`, `CustomOrderReviewItem`, `CustomOrderQuote`, status unions. |
| `src/lib/i18n.ts` | ~50 keys × 6 locales. |

**Security decisions (load-bearing):**
- No client INSERT/UPDATE policy on either table. Every write is a validated RPC.
- The customer can never author a price — `submit_custom_order_quote` is admin/staff-gated in the
  database, and a newer quote supersedes the old one.
- A customer may only cancel or accept/decline a quote; advancing to quoted/declined/fulfilled is
  a reviewer action, enforced in `set_custom_order_request_status`, not just the UI.
- `budget_cents` is the customer's optional hint (NULL = no figure in mind); a quote's
  `price_cents` is always a reviewer's number. Nothing is fabricated.

**Activation requirement:** the migration must be reviewed and applied (with approval) before the
feature works end-to-end. Until then the UI shows an honest "not available" state — it never
pretends a submission succeeded.

---

## 5. Verification actually run

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `npx eslint` (10 touched files) | 0 errors, warnings only (pre-existing patterns) |
| `npm run build` | exit 0 |
| i18n key parity | every new key present × 6 locales |
| Migration SQL | static review only; balanced `$$`/BEGIN/END; **never applied** |

No automated test suite exists in this project; correctness rests on the static gates above plus
the RPC-level authorization, which is enforced in the database.
