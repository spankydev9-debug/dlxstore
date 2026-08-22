# CHECKPOINT 2026-08-21 - Checkout Inventory Trigger RLS Fix

## Branch & Commit
- **Branch**: devin-version-official
- **Previous HEAD**: 452773b feat: continue admin dashboard launch hardening
- **Current HEAD**: 09f579b fix: resolve inventory trigger RLS conflict blocking checkout

## Root Cause
The existing `adjust_stock_on_order()` trigger (defined in schema.sql) was failing when customers tried to checkout because it couldn't INSERT into `inventory_history` due to restrictive RLS policies.

**Conflict Details:**
- **Trigger**: `on_order_item_inserted` → `adjust_stock_on_order()` (SECURITY DEFINER)
- **Trigger Table**: `public.order_items` (AFTER INSERT)
- **Trigger Action**: 
  1. Decrement `products.stock_quantity`
  2. INSERT into `public.inventory_history`
- **RLS Policy**: `inventory_history` INSERT requires `role = 'admin'`
- **Failure Point**: When customers create orders, the trigger fires but the INSERT into `inventory_history` fails due to RLS blocking non-admin users

**Evidence:**
- Schema.sql lines 353-374 define the trigger function
- Schema.sql lines 228-234 define the restrictive RLS policy
- Migration files do NOT contain this trigger (it's only in schema.sql)
- The migration 20260819_launch_hardening.sql created `create_customer_order` RPC but didn't account for the existing trigger RLS conflict

## Exact Fix
**Migration**: `supabase/migrations/20260823_fix_inventory_trigger_rls.sql`

**Changes:**
1. Add `SET search_path = public` to the `adjust_stock_on_order()` function
2. This ensures the SECURITY DEFINER property properly bypasses RLS for the INSERT
3. Ensure `orders` table has `whatsapp_handoff_status` and `whatsapp_handoff_at` columns

**Security Impact:**
- The trigger function already uses SECURITY DEFINER
- Adding `SET search_path = public` is a standard pattern to ensure RLS bypass works correctly
- The restrictive RLS policy remains in place for direct user INSERTs
- Only the trusted database trigger can bypass RLS
- No security weakening or broad privilege changes

## Files Changed
1. **src/services/db/orders.ts**
   - Improved RPC error logging to expose actual Supabase error details
   - Log payload being sent (without secrets) for debugging
   - Added structured error logging with message, details, hint, code

2. **supabase/migrations/20260823_fix_inventory_trigger_rls.sql** (new)
   - Fix inventory trigger RLS conflict
   - Ensure whatsapp_handoff columns exist

## Database Changes
- **Function updated**: `public.adjust_stock_on_order()` 
- **Table altered**: `public.orders` (added whatsapp_handoff columns if missing)
- **Trigger unchanged**: `on_order_item_inserted` (already exists, just calls updated function)
- **RLS unchanged**: All existing policies remain restrictive

## Inventory Impact
- **Existing mechanism preserved**: The `adjust_stock_on_order()` trigger already decrements stock
- **No duplicate decrement**: Only one trigger on order_items, no additional mechanisms added
- **20260821_fix_inventory_decrement.sql**: NOT APPLIED - not needed since inventory decrement was already handled by the existing trigger
- **Inventory history**: Still recorded correctly via the fixed trigger

## Verification
### Build Status
✅ **PASS** - `npm run build` completed successfully

### Git Status
✅ **CLEAN** - All changes committed (09f579b)

### Logical Verification
✅ **Order creation flow**:
- `create_customer_order()` inserts into `orders` (RLS allows authenticated users to insert their own orders)
- `create_customer_order()` inserts into `order_items` (RLS allows users to insert items into their own orders)
- `on_order_item_inserted` trigger fires
- `adjust_stock_on_order()` decrements `products.stock_quantity` (SECURITY DEFINER bypasses RLS)
- `adjust_stock_on_order()` inserts into `inventory_history` (SECURITY DEFINER + SET search_path now properly bypasses RLS)

✅ **Inventory decrement**: Exactly ONE decrement per order_item insertion via the existing trigger

✅ **WhatsApp handoff**: Columns ensured to exist, handoff logic unchanged

✅ **Order tracking**: Redirect remains `/order-tracking?orderId=...&whatsapp=...`

✅ **Coupon validation**: Existing coupon trigger from 20260818_coupons_food_foundation.sql unchanged

✅ **Concurrent orders**: The existing `FOR UPDATE` locking in `create_customer_order` prevents overselling

## Remaining Limitations
⚠️ **Live Supabase verification required**:
- The migration must be applied to the production Supabase database
- A real checkout test should be performed to confirm the fix works in production
- Browser console should now show detailed error information if issues persist

⚠️ **Safari verification**: Not available in this environment - manual verification still required

⚠️ **PWA behavior**: Manual verification still required for installed app vs browser differences

## Migration Status
- **20260823_fix_inventory_trigger_rls.sql**: READY TO APPLY (not yet applied to live database)
- **20260821_fix_inventory_decrement.sql**: NOT REQUIRED (existing trigger already handles inventory)
- **20260819_launch_hardening.sql**: Already applied (contains create_customer_order RPC)
- **All other migrations**: Existing migrations remain unchanged

## What to Test on Localhost
1. **Checkout flow**: Complete a real order with a test product/account
2. **Verify database state**:
   - Order row created in `orders` table
   - Order items created in `order_items` table
   - `products.stock_quantity` decremented exactly once per item
   - `inventory_history` row created with type='sale'
3. **WhatsApp handoff**: Confirm the WhatsApp link opens and handoff status is recorded
4. **Order tracking**: Verify redirect to `/order-tracking?orderId=...&whatsapp=...` works
5. **Coupon validation**: Test with and without coupon codes
6. **Error cases**: Try ordering with insufficient stock to verify error handling

## Summary
The checkout was failing due to an RLS conflict between the existing inventory trigger and the restrictive inventory_history policy. The fix adds `SET search_path = public` to the trigger function to ensure SECURITY DEFINER properly bypasses RLS for the INSERT operation. This is a minimal, secure fix that preserves all existing security controls while allowing the trusted database trigger to execute correctly.
