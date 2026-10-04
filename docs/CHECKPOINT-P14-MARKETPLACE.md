# CHECKPOINT P14 — Scale the Business (Marketplace)

**Status:** complete and locally verified. Live marketplace operation is unverified.
**Date:** 2026-10-03

DLX can now accept third-party sellers: applications are approved into real shops,
customer orders split per seller, commission is calculated and frozen per sale, and
DLX settles seller payouts through an auditable ledger.

The two rules that shape every decision below:

1. **A seller never confirms their own delivery.** COD money is only owed once DLX
   staff verify arrival. `seller_update_sub_order_status` refuses `delivered` for
   anyone who is not an admin, regardless of what the UI sends.
2. **Commission is frozen at the moment of sale** and never recalculated. Changing a
   seller's rate later cannot rewrite history.

---

## 1. What exists

### Database

`supabase/migrations/20261017090000_marketplace_core.sql`
- `products.vendor_id` → `vendors(id)`; DLX's own stock stays `NULL`.
- `order_sub_orders`: trigger-derived split of any order by seller.
- `vendor_commission_ledger`: append-only money trail (`pending → earned → paid`, or
  `reversed`).
- `vendor_payouts` + `vendor_payout_items`: one open payout per seller, enforced by the
  partial index `idx_vendor_payouts_one_open` over `requested`/`processing`.
- `vendors` onboarding columns: `legal_name`, `contact_email`, `contact_phone`,
  `payout_method`, `payout_account_ref`, `onboarding_step`, `suspended_reason`.
- `orders.status` gains `refunded`.
- RPCs: `get_my_vendor`, `get_my_vendor_id`, `update_my_vendor_onboarding`,
  `seller_dashboard`, `seller_list_sub_orders`, `seller_update_sub_order_status`,
  `seller_request_payout`, `admin_approve_partner_application`,
  `admin_marketplace_overview`, `admin_list_payouts`, `admin_settle_payout`,
  `sync_order_sub_order`, `sync_parent_order_status`.
- `vendor_public_cards` view: the only public read path to seller rows.

`supabase/migrations/20261017093000_marketplace_supply.sql`
- `vendor_warehouses`, `product_warehouse_stock`, `suppliers`, `product_suppliers`.
- RPCs: `seller_list_warehouses`, `seller_save_warehouse`, `seller_delete_warehouse`,
  `seller_set_warehouse_stock`, `seller_list_suppliers`, `seller_list_my_products`.

Both migrations are re-runnable: verified by applying each twice with no error.

### Server

`src/services/db/marketplace.ts` — seller and admin RPC wrappers plus
`listCommissionLedger`. `src/services/db/partner-shops.ts` — public reads repointed
onto `vendor_public_cards`.

### UI

- `src/components/partner/SellerDashboard.tsx` — overview, orders, payouts,
  warehouses (full CRUD + per-warehouse stock allocation), suppliers, shop profile.
- `src/app/partner/dashboard/` — auth-gated route; non-sellers get an apply CTA.
- `src/components/admin/MarketplaceConsole.tsx` — applications, payouts, and the
  commission ledger journal.
- Product pages carry seller attribution linking to the public shop.

### i18n

84 new keys × 6 locales (`fr`, `en`, `sw`, `ln`, `tl`, `kg`).

---

## 2. Verification

| Gate | Result |
| --- | --- |
| `supabase/tests/p14_marketplace.sql` | **97 assertions passed, 0 failed** |
| `supabase/tests/p13_communication.sql` | 64 passed, 0 failed (no regression) |
| Migration idempotency | core + supply each applied twice, clean |
| `npx tsc --noEmit` | exit 0 |
| `npx eslint` (touched files) | 0 errors, 2 accepted `set-state-in-effect` warnings |
| `npx next build` | exit 0, `/partner/dashboard` registered |

The P14 suite fakes `auth.uid()`/`auth.role()` by writing the request GUCs directly,
which is the only way to exercise RLS without the full auth server running. It is
not wrapped in `BEGIN`, so the actor helper uses session-level `set_config(..., false)`.

### Not verified

- **No browser E2E.** The complete Supabase auth/Kong stack is not running, so the
  seller UI was verified by `tsc`/lint/build and by SQL assertions, not by clicking
  through it. Auth-gated rendering and the redirect on signed-out access are untested.
- **No live marketplace.** No real seller has been onboarded and no real payout made.
- Remote/development Supabase is untouched. None of this is deployed.

---

## 3. Defects found and fixed during verification

Three pre-existing migrations had **never successfully applied anywhere**: each
defined `is_admin()` with `role = "admin"` (double quotes), which PostgreSQL reads as
a *column* reference, so every one aborted at line 13. Everything after that line was
missing, including `partner_applications.applicant_id` and its policies.

- `20260816150200_security_hardening.sql`
- `20260823132900_fix_order_rpc_and_partner_applications_rls.sql`
- `20260823140000_final_dlxstore_customer_flow_fix.sql`

Fixed to `role = 'admin'`. `20260823143000_fix_profiles_rls_recursion.sql` remains the
later, correct `is_admin()` repair.

Accounting and authorization defects found by the suite:

| Defect | Consequence if shipped | Fix |
| --- | --- | --- |
| Commission selected from `vendors` joined only on active status | Suspended seller → `NULL` commission rate | Select from `vendors` directly, `COALESCE` the rate |
| `vendor_payouts_one_open UNIQUE(vendor_id)` over all statuses | A seller could ever request one payout, ever | Partial unique index on `requested`/`processing` |
| Cancelled payout left `vendor_payout_items` behind | Ledger rows stranded, never re-payable | Cancel deletes the items |
| Inverted `IF NOT EXISTS` guard in `seller_request_payout` | Guard never fired | Corrected |
| Warehouse default set before demoting the old default | Two defaults, or none | Demote first |
| `sync_order_sub_order` was not `SECURITY DEFINER` | Trigger failed under RLS | Made `SECURITY DEFINER` |
| Supplier names unique globally | Two sellers could not share a supplier name | Unique per owner |
| Public active-vendor read hit the `vendors` base table | Leaked payout/contact columns (RLS cannot filter columns) | `vendor_public_cards` view; anon has no grant on `vendors` |
| `authenticated` retained seller UPDATE on `vendors` | Seller could edit own status/commission | Seller UPDATE policies removed; RLS silently filters to 0 rows |

UI defects found while wiring the dashboard:

| Defect | Consequence | Fix |
| --- | --- | --- |
| Seller stock screen listed the **whole public catalogue** | Leaked the catalogue into the seller console and offered allocations the server would always reject | New `seller_list_my_products()` RPC, scoped by ownership, with 8 regression assertions |
| `getMyVendor()` was typed `PartnerShop` | `legal_name`, `contact_email`, `payout_method` were invisible to the profile form, so a seller's saved details rendered blank | New `MyVendor` type |
| `SubOrderStatus` contained `shipped`, which exists in no constraint or RPC | The "shipped" button could only ever be rejected | Type corrected to the 8 real values; added `ready`/`out_for_delivery` |
| Buttons offered on delivered/cancelled orders | Actions the server refuses | Terminal statuses render no actions |
| `vendor_public_cards` exposes `display_name`, not `shop_name` | Storefront read `shop_name` (always undefined) and published the **legal** name instead of the seller's chosen shop name | Read `display_name` first |
| `productSoldBy`/`productVisitStore` and seller labels were never added to i18n | Untranslated seller console | 84 keys × 6 locales |

---

## 4. Outstanding work — needs a human, not more code

### Translation quality requires native-speaker review

The `ln`, `tl` and `kg` seller strings are machine-drafted. They are internally
consistent and avoid foreign-script contamination (checked programmatically), but
they are **not** native copy. This is the same caveat already recorded for P13. `tl`
is Tshiluba, `kg` is Kikongo.

### Business decisions still open

- Default commission rate, and whether DLX or the seller proposes it.
- Payout thresholds and a minimum withdrawal amount.
- Whether a seller may see the buyer's name/phone for their own sub-order (currently
  no).
- Returns and dispute handling: P14 models `refunded` on the parent order, but there
  is no seller-facing returns workflow.

### Not built

- No product creation UI for sellers. Products are attributed by an admin or by
  direct data entry.
- No supplier create/edit UI. `seller_list_suppliers` is the only supplier RPC, so the
  panel is deliberately read-only.
- No multi-warehouse stock *transfer* between warehouses.

---

## 5. Honest limitations of the design

- **RLS denial is silent.** A seller UPDATE with no matching policy affects zero rows
  and raises nothing. The test suite asserts stored *effects*, never the absence of an
  exception. Any future check that asserts "no error was raised" will pass even when
  the write did nothing.
- **The seller UI trusts the server for money but not for stock.** Allocations are
  validated per product inside `seller_set_warehouse_stock`; the UI only offers rows
  the ownership-scoped RPC returned.
- **`vendor_public_cards` is a snapshot of active vendors.** A suspended seller
  disappears from the public view entirely, which is intended, but it also means the
  product page silently drops its attribution card for a suspended seller rather than
  showing a "seller unavailable" state.
- **Payout settlement is manual by design.** Nothing moves money automatically; DLX
  marks payouts paid by hand, and that action is what flips ledger rows to `paid`.
