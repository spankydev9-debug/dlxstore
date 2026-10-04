import {
  CommissionLedgerEntry,
  DeliveryZone,
  MarketplaceOverview,
  MyVendor,
  PartnerApplication,
  PayoutMethod,
  PayoutRequestResult,
  PayoutStatus,
  SellerDashboard,
  SellerProduct,
  SellerSupplier,
  SubOrder,
  SubOrderStatus,
  VendorOnboardingInput,
  VendorPayout,
  VendorWarehouse,
  WarehouseStockResult
} from "../../types";
import { isSupabaseConfigured, isDemoMode, supabase } from "./index";

function notConfigured(): never {
  throw new Error("No production data source configured.");
}

/**
 * Every marketplace mutation goes through an RPC rather than a table write.
 *
 * That is deliberate, not stylistic. `vendors` has no direct INSERT/UPDATE/DELETE
 * grant for `authenticated`, so the browser cannot set its own commission rate or
 * mark itself active; the RPCs are SECURITY DEFINER and validate ownership. If
 * you add a marketplace write here, add it as an RPC -- a table write will fail
 * at runtime, which is the correct outcome.
 */
async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  if (!isSupabaseConfigured || !supabase) return notConfigured();
  const { data, error } = await supabase.rpc(fn, args ?? {});
  if (error) throw new Error(error.message || "An error occurred.");
  return data as T;
}

export async function getDeliveryZones(includeInactive = false): Promise<DeliveryZone[]> {
  if (isSupabaseConfigured && supabase) {
    let query = supabase.from("delivery_zones").select("country_code, province, city, territory, commune, active, fee, currency").order("province");
    if (!includeInactive) query = query.eq("active", true);
    const { data, error } = await query;
    if (error) throw new Error(error.message || "An error occurred.");
    return (data || []).map(({ country_code, ...zone }) => ({ ...zone, country: country_code as "CD" })) as DeliveryZone[];
  }
  if (!isDemoMode) throw new Error("No production data source configured.");
  return JSON.parse(localStorage.getItem("dlxstore_delivery_zones") || "[]") as DeliveryZone[];
}

export async function saveDeliveryZone(zone: DeliveryZone): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.from("delivery_zones").insert({ country_code: zone.country, province: zone.province, city: zone.city || null, territory: zone.territory || null, commune: zone.commune || null, active: zone.active, fee: zone.fee, currency: zone.currency });
    if (error) throw new Error(error.message || "An error occurred.");
    return;
  }
  if (!isDemoMode) throw new Error("No production data source configured.");
  const zones = await getDeliveryZones(true); localStorage.setItem("dlxstore_delivery_zones", JSON.stringify([...zones, zone]));
}

export async function updatePartnerApplicationStatus(id: string, status: PartnerApplication["status"]): Promise<void> {
  if (isSupabaseConfigured && supabase) { const { error } = await supabase.from("partner_applications").update({ status }).eq("id", id); if (error) throw new Error(error.message || "An error occurred."); return; }
  if (!isDemoMode) throw new Error("No production data source configured.");
  const applications = JSON.parse(localStorage.getItem("dlxstore_partner_applications") || "[]") as PartnerApplication[];
  localStorage.setItem("dlxstore_partner_applications", JSON.stringify(applications.map((application) => application.id === id ? { ...application, status } : application)));
}

// ---------------------------------------------------------------------------
// Seller identity and onboarding
// ---------------------------------------------------------------------------

/** The caller's own shop row, or null when they are not a seller. */
export function getMyVendor(): Promise<MyVendor | null> {
  return rpc<MyVendor | null>("get_my_vendor");
}

/**
 * Saves the seller's own onboarding fields. Deliberately cannot set
 * `commission_rate` or `status`: those are DLX's decision, enforced server-side.
 */
export async function saveVendorOnboarding(input: VendorOnboardingInput): Promise<Record<string, unknown>> {
  if (!isSupabaseConfigured || !supabase) return notConfigured();
  const { data, error } = await supabase.rpc("update_my_vendor_onboarding", {
    p_legal_name: input.legal_name ?? null,
    p_contact_email: input.contact_email ?? null,
    p_contact_phone: input.contact_phone ?? null,
    p_payout_method: input.payout_method ?? null,
    p_payout_account_ref: input.payout_account_ref ?? null,
    p_business_hours: input.business_hours ?? null,
    p_description: input.shop_description ?? null
  });
  if (error) throw new Error(error.message || "An error occurred.");
  return data as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Seller dashboard
// ---------------------------------------------------------------------------

export function getSellerDashboard(): Promise<SellerDashboard> {
  return rpc<SellerDashboard[]>("seller_dashboard").then((rows) => rows[0] ?? emptyDashboard());
}

export function getSellerSubOrders(status: SubOrderStatus | null = null): Promise<SubOrder[]> {
  return rpc<SubOrder[]>("seller_list_sub_orders", { p_status: status });
}

/**
 * Advances a sub-order to a seller-visible status. The server refuses
 * `delivered`: only DLX staff may confirm that a COD order actually arrived.
 */
export async function setSubOrderStatus(subOrderId: string, status: SubOrderStatus): Promise<string> {
  return rpc<string>("seller_update_sub_order_status", { p_sub_order_id: subOrderId, p_status: status });
}

/** Requests a payout of everything currently settled and unclaimed. */
export function requestPayout(method: PayoutMethod, accountRef: string): Promise<PayoutRequestResult> {
  return rpc<PayoutRequestResult[]>("seller_request_payout", { p_method: method, p_account_ref: accountRef })
    .then((rows) => rows[0]);
}

// ---------------------------------------------------------------------------
// Seller warehouses and stock
// ---------------------------------------------------------------------------

/**
 * The caller's own products only. The seller stock screen must never enumerate
 * the public catalogue: the seller has no claim on products they do not own.
 */
export function listMyProducts(): Promise<SellerProduct[]> {
  return rpc<SellerProduct[]>("seller_list_my_products");
}

export function listWarehouses(): Promise<VendorWarehouse[]> {
  return rpc<VendorWarehouse[]>("seller_list_warehouses");
}

export function saveWarehouse(input: {
  warehouse_id?: string | null;
  name: string;
  city?: string | null;
  province?: string | null;
  address?: string | null;
  is_default?: boolean;
}): Promise<VendorWarehouse> {
  return rpc<VendorWarehouse>("seller_save_warehouse", {
    p_warehouse_id: input.warehouse_id ?? null,
    p_name: input.name,
    p_city: input.city ?? null,
    p_province: input.province ?? null,
    p_address: input.address ?? null,
    p_is_default: input.is_default ?? false
  });
}

export function deleteWarehouse(warehouseId: string): Promise<boolean> {
  return rpc<boolean>("seller_delete_warehouse", { p_warehouse_id: warehouseId });
}

/**
 * Moves some of a product's stock into one warehouse. `products.stock_quantity`
 * stays the single sellable number; this only distributes it, and the server
 * refuses an allocation that would exceed the product total.
 */
export function setWarehouseStock(productId: string, warehouseId: string, quantity: number): Promise<WarehouseStockResult> {
  return rpc<WarehouseStockResult[]>("seller_set_warehouse_stock", {
    p_product_id: productId,
    p_warehouse_id: warehouseId,
    p_quantity: quantity
  }).then((rows) => rows[0]);
}

// ---------------------------------------------------------------------------
// Seller suppliers
// ---------------------------------------------------------------------------

export function listSuppliers(): Promise<SellerSupplier[]> {
  return rpc<SellerSupplier[]>("seller_list_suppliers");
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export function getMarketplaceOverview(): Promise<MarketplaceOverview> {
  return rpc<MarketplaceOverview[]>("admin_marketplace_overview").then((rows) => rows[0]);
}

/**
 * Approves a partner application, creating the vendor row in the same
 * transaction. Never update `partner_applications.status` to "approved" by hand:
 * that would mark the application done without ever creating a seller.
 */
export function approvePartnerApplication(applicationId: string, commissionRate?: number): Promise<Record<string, unknown>> {
  return rpc<Record<string, unknown>>("admin_approve_partner_application", {
    p_application_id: applicationId,
    p_commission_rate: commissionRate ?? null
  });
}

export function listPayouts(status: PayoutStatus | null = null): Promise<VendorPayout[]> {
  return rpc<VendorPayout[]>("admin_list_payouts", { p_status: status });
}

/** `paid` moves the money and marks the ledger paid; `cancelled` releases it. */
export function settlePayout(payoutId: string, status: "processing" | "paid" | "cancelled"): Promise<VendorPayout> {
  return rpc<VendorPayout>("admin_settle_payout", { p_payout_id: payoutId, p_status: status });
}

export async function listCommissionLedger(vendorId?: string): Promise<CommissionLedgerEntry[]> {
  if (!isSupabaseConfigured || !supabase) return notConfigured();
  let query = supabase
    .from("vendor_commission_ledger")
    .select("id, vendor_id, sub_order_id, order_id, kind, amount, rate, currency, status, created_at, reversed_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (vendorId) query = query.eq("vendor_id", vendorId);
  const { data, error } = await query;
  if (error) throw new Error(error.message || "An error occurred.");
  return (data ?? []) as CommissionLedgerEntry[];
}

function emptyDashboard(): SellerDashboard {
  return {
    product_count: 0,
    sub_order_count: 0,
    units_sold: 0,
    gross_revenue: 0,
    commission_paid: 0,
    commission_pending: 0,
    commission_reversed: 0,
    pending_payout_net: 0,
    active_payout_status: null
  };
}
