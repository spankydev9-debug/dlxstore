# CHECKPOINT — P4b: cart/checkout safety against the live catalogue

**Status: BUILT, TYPE-SAFE, AND VERIFIED IN A REAL BROWSER against live production data.**
**Branch:** `main` · **Base commit:** `c61132f` · **Date:** 2026-10-09
**Scope:** the defects a review of P3/P4 found in the *running system*, plus the production
migration/security facts the earlier docs recorded as unknown. No migration applied. No push.

---

## 1. Production facts established (read-only SQL, project `szhkesvvrgcxbxucodzz`)

| Question | Earlier record | Verified production reality |
|---|---|---|
| Migrations applied remotely | `docs/MIGRATION-CHECKPOINT.md` (2026-10-04): 45/45 | **Confirmed still 45/45**, latest `20261017093000`, gapless. **4 pending:** `20261018090000`, `20261019090000`, `20261020090000`, `20261021090000`. |
| SEC-01 shop-stats fix | "Production migrations applied: **None**" | **APPLIED AND LIVE.** `get_shop_stats` ACL = `{postgres, authenticated, service_role}` — no `anon`. |
| SEC-01 coupon fix | "apply first, coupon validation currently broken for every customer" | **APPLIED AND LIVE.** `quote_coupon` ACL has no `anon`. Coupon validation works in production today; that checklist item is obsolete. |
| `is_admin()` body (§6.2 unresolved) | double-quoted `role = "admin"` in repo migrations | **Live body is correct:** `role = 'admin'` (single quotes, `STABLE SECURITY DEFINER`, pinned search_path). Policies depending on it function. |
| `anon=X` definer sweep (§5) | 52, measured on a scratch DB | **83 in production.** Re-triaged: only 18 lack any `auth.uid()`/admin guard, and 16 of those are `RETURNS trigger` (not callable through PostgREST). The two callable ones — `get_active_bundles`, `get_active_flash_sales` — expose only public retail prices and are the intended storefront read path. `adjust_inventory` is anon-granted but admin-gated inside. **No new exposure found; §5's severity was a scratch-DB artefact.** |
| `notifications` columns for custom orders | unverified | All present (`actor_id`, `entity_type`, `entity_id`, `type`, `data`) and **no CHECK on `type`** — the migration's notification inserts will work. |
| `profiles.role` values | unverified | CHECK allows `customer`/`staff`/`admin`; live rows are only `admin` and `customer`. |
| Can an order's discount be forged? | not examined | **No.** A `BEFORE INSERT` trigger `apply_coupon_on_order` re-resolves the coupon, checks active/expiry/max_uses/min_order, verifies reward-coupon ownership against `auth.uid()`, recomputes `expected_discount`, and RAISES if the client's figure differs — then increments `used_count` under `FOR UPDATE`. Combined with `create_customer_order` recomputing gross from live prices, the money path is sound. |
| Production deploy state | `AGENT_HANDOFF.md`: "**not deployed**, `/discover` `/studio` `/partner/dashboard` return 404" | **That claim was stale.** All three routes return **200**. `vercel ls`/`vercel inspect`: the production alias `https://dlxstore-flax.vercel.app` serves `dpl_H4941MTDJrpFVGQy861mpXRrhwHa`, created 2026-10-08 22:39 CAT, aliased `dlxstore-git-main-…`, i.e. built from **`main` @ `276e759`** — which equals `origin/main`. Everything from `fa4d510` onward (P0–P4, and this P4b work) is undeployed. |
| RPCs the *deployed* bundle calls but production cannot serve | not examined | Probed live 2026-10-09 with the publishable key: `get_trending_products` → **HTTP 400 `42P10` "ORDER BY position 9 is not in select list"** (`/discover` trending shelf silently absent), `get_product_social_proof` → **HTTP 400 `42804` "Returned type bigint does not match expected type integer in column 2"**, and `get_or_create_direct_conversation` → **absent from `pg_proc`** (`src/services/db/chat.ts:289` throws, so starting a DM shows "Unable to start the conversation."). `create_custom_order_request` is likewise absent, but its callers are not deployed. |
| Which pending migrations are actually urgent | treated as one block | **Split by whether the calling code is live.** `20261018090000` repairs both failing RPCs and `20261019090000` creates the missing DM RPC — these two gate features **already shipping**, so applying them fixes production with no deploy. `20261020090000` and `20261021090000` gate code first committed on 2026-10-09 and must simply land before the next deploy. Verified: the first two files exist at `276e759` (`git cat-file -e`), the last two do not. |

## 2. Defect 1 — stale carts reached checkout with stale prices (HIGH, customer-facing)

`CartContext` classified availability from `item.product`, a **localStorage snapshot taken when
the item was added**. Production `create_customer_order` recomputes the total from live prices and
raises `Order total does not match the current catalogue`, and raises `Insufficient inventory`
when `stock_quantity < quantity`. So any price change or stock movement since the item was added
guaranteed a hard failure at the last step — after the customer had filled in their address.
P4's "handle stock changes and stale carts safely" was therefore not actually true.

**Fix** — `src/context/CartContext.tsx`: new `revalidateCart()` re-reads the existing
`getProducts()` service (no new query, table or UI) and for each line swaps in the live product,
clamps quantity to real stock, and marks a product missing from the sellable catalogue
`is_active: false` so it lands in the existing unavailable section — retained for reference,
never silently deleted. A failed or empty catalogue read is ignored rather than applied, because
marking every line unavailable would silently zero the total. Called once after hydration and on
mount of `/cart` and `/checkout`.

**Browser-verified** against live production data with a deliberately stale seeded cart:

| Injected (stale) | After revalidation |
|---|---|
| price **$1**, stock 999, qty **50** | price **$129** (live), stock **8** (live), qty clamped **50 → 8** |
| product id not in the catalogue | `is_active:false`, excluded from totals, "Articles indisponibles" rendered |
| — | total **1032 = 129 × 8**, exactly what `create_customer_order` computes. Previously would have submitted **$50** and been rejected. |

0 console errors. Test cart removed afterwards.

## 3. Defect 2 — checkout prefill silently deleted (MEDIUM, customer-facing)

`73e47bf` (P1) removed the bodies of two `useEffect`s in `src/app/checkout/page.tsx` and left the
comments behind, so a signed-in customer had to retype their name and phone on every order and
`neighborhood` stayed empty against a `required` select. Restored exactly what `86dcf7f` had:
`setCustomerName(user.full_name)`, `setPhoneNumber(user.phone || "")`, `setNeighborhood(list[0])`.
*Not browser-verified — needs a signed-in customer account; static gates only.*

## 4. Defect 3 — false "added to cart" success (MEDIUM, honesty)

P4 made `addToCart` silently `return` for a non-purchasable product, while
`ProductPage.handleAddToCart` still fired `alert(t.addedToCartAlert)` unconditionally — the customer
was told an item was in the cart when nothing was added, and the cart total then disagreed with
what they thought they had. `addToCart` now returns `boolean`; the page confirms only on `true` and
otherwise shows a new `addToCartUnavailableAlert` key (**added across all 6 locales**; parity is
compiler-enforced because every locale object is typed `typeof fr`).

## 5. Defect 4 — coupon could drift under a revalidated total (MEDIUM)

`apply_order_coupon` rejects any order whose discount differs from its own recomputation. Once the
cart total moves (Defect 1's revalidation, or an item dropping out of stock), a coupon quoted
against the old subtotal would fail at submission. Checkout now records the subtotal a coupon was
quoted against (`couponBase`) and re-quotes it via the existing `validateCoupon` when that subtotal
drifts, so the discount sent always matches what the database will recompute.

## 6. P3 verification results

* **P3a product cards in chat — WORKS.** `/chat` → `ModernChatInterface` → `MessageBubble`
  (`EnhancedChatUi.tsx:146`) and `ChatUi.tsx:40` both render the reader; both inbox previews use
  `productSharePreview`. No surface still leaks the raw token. The send path calls
  `send_conversation_message` / `send_conversation_message_v2` /
  `get_or_create_customer_support_conversation`, **all confirmed present in production**, so the
  text card works without the pending migration (media still needs `20261020090000`).
* **P3b product → Story sharing — WORKS.** `StoriesPanel.tsx:137-144` waits for the catalogue
  (`products.length === 0` guard) and resolves slug→id behind a once-only ref, so there is no race
  that clears `?share=` before the product arrives. Reuses `create_story`, which is live.
* **P3c custom orders — code correct, still blocked on `20261021090000`.** Fixed a real defect:
  `getMyCustomOrders()` swallowed a missing RPC and returned `[]`, which made the panel's honest
  "not available" branch **dead code** — with the migration unapplied a customer saw an empty list
  plus a working form, and was refused only after filling it in and uploading reference images. It
  now throws `CustomOrdersUnavailableError` like the write path.
* **Reviewer access — decision needed, deliberately NOT changed.** The migration gates reviewers
  as `role IN ('admin','staff')`, but `/admin/dashboard` renders only when `user.role === "admin"`
  (line 432). `staff` therefore cannot reach the console at all. The UI is *more* restrictive than
  the database, so this is not a security hole; widening the admin surface is a product decision
  and was left to the owner. No `staff` account exists in production yet.

## 7. Gates run

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 — no type errors (re-run on the final working tree) |
| `npx eslint src` | exit 0 — **0 errors**, 141 warnings, all pre-existing `@typescript-eslint/no-explicit-any` in untouched service modules; none introduced here |
| `npm run build` | exit 0, compiled successfully, all routes emitted (re-run on the final working tree) |
| Browser flow `/shop` → `/cart` with a stale cart | Pass (table in §2); 0 console errors |
| `addToCart` return-type change | Only one call site exists (`app/product/[slug]/ProductPage.tsx:148`) — verified by grep, so no other caller relied on the old `void` |
| Migration applied / push / deploy | **None.** Requires explicit approval. |

## 8. Unverified

* Checkout prefill, coupon drift re-quote and the custom-order flow cannot be exercised without a
  signed-in customer account, and no account should be created on production.
* No local Postgres and Docker is unavailable, so the 4 pending migrations have **not** been
  dry-run anywhere. Their static review is documented in `CHECKPOINT-P3-SOCIAL-COMMERCE-CONTINUATION.md`.

## 9. Next steps

1. **Highest-value owner decision: apply `20261018090000` then `20261019090000`.** Production
   already ships their callers, and `/discover` trending, product social proof and "message this
   person" fail for real customers today (see §1). Applying them repairs live traffic **without a
   deploy**, which makes this the cheapest customer-facing fix available.
2. Decide the `staff` reviewer question (§6).
3. Approve applying `20261020090000` → `20261021090000` and pushing + deploying local `main`
   (production is still at `276e759`). Chat media and custom orders must not deploy ahead of their
   migrations, or they go dark on day one.
4. This P4b work is committed locally on `main`; it is **not pushed** and production does not have
   it. `scripts/` is deliberately left untracked — it was untracked at handover and promoting it is
   the owner's call, not a side effect of this commit.
5. Then P5 — campaigns, launch banner and welcome rewards — which the backlog lists next.
