"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Banknote,
  Boxes,
  Check,
  Handshake,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Star,
  Store,
  Trash2,
  Truck
} from "lucide-react";
import {
  MyVendor,
  PayoutMethod,
  PayoutStatus,
  SellerDashboard as SellerDashboardData,
  SellerProduct,
  SellerSupplier,
  SubOrder,
  SubOrderStatus,
  VendorWarehouse
} from "../../types";
import {
  deleteWarehouse,
  getMyVendor,
  getSellerDashboard,
  getSellerSubOrders,
  listMyProducts,
  listSuppliers,
  listWarehouses,
  requestPayout,
  saveVendorOnboarding,
  saveWarehouse,
  setSubOrderStatus,
  setWarehouseStock
} from "../../services/db/marketplace";
import { useLanguage } from "../../context/LanguageContext";
import type { TranslationKeys } from "../../lib/i18n";
import { formatMoney } from "../../lib/format";

type Tab = "overview" | "orders" | "payouts" | "warehouses" | "suppliers" | "profile";

const EMPTY_DASHBOARD: SellerDashboardData = {
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

/**
 * The seller-facing half of the marketplace.
 *
 * Two rules shape everything here. A seller can never confirm their own delivery,
 * because COD money is only owed once DLX staff verify arrival -- the server
 * refuses `delivered` regardless of what this UI sends. And a seller can never
 * set their own commission rate or status: every write goes through an audited
 * RPC, and the rate shown here is read-only by design.
 */
export function SellerDashboard() {
  const { t } = useLanguage();
  const [tab, setTab] = useState<Tab>("overview");
  const [isSeller, setIsSeller] = useState<boolean | null>(null);
  const [vendor, setVendor] = useState<MyVendor | null>(null);
  const [dash, setDash] = useState<SellerDashboardData>(EMPTY_DASHBOARD);
  const [subOrders, setSubOrders] = useState<SubOrder[]>([]);
  const [warehouses, setWarehouses] = useState<VendorWarehouse[]>([]);
  const [suppliers, setSuppliers] = useState<SellerSupplier[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setError("");
    try {
      const vendor = await getMyVendor();
      if (!vendor) {
        setIsSeller(false);
        return;
      }
      setIsSeller(true);
      setVendor(vendor);
      const [d, s, w, sup] = await Promise.all([
        getSellerDashboard(),
        getSellerSubOrders(null),
        listWarehouses(),
        listSuppliers()
      ]);
      setDash(d);
      setSubOrders(s);
      setWarehouses(w);
      setSuppliers(sup);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.sellerLoadError);
    } finally {
      setIsLoading(false);
    }
  }, [t.sellerLoadError]);

  useEffect(() => { void load(); }, [load]);

  const act = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(success);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.sellerActionError);
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isSeller === false) {
    return (
      <section className="mx-auto max-w-2xl py-16 text-center">
        <Store className="mx-auto h-12 w-12 text-muted-foreground" />
        <h1 className="mt-5 text-3xl font-bold tracking-tight">{t.sellerNoAccountTitle}</h1>
        <p className="mt-3 text-muted-foreground">{t.sellerNoAccountBody}</p>
        <Link href="/partner"
          className="mt-7 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground">
          {t.sellerApplyCta}
        </Link>
      </section>
    );
  }

  const tabs: { key: Tab; label: string; icon: typeof Store }[] = [
    { key: "overview", label: t.sellerOverview, icon: Store },
    { key: "orders", label: t.sellerOrders, icon: Truck },
    { key: "payouts", label: t.sellerPayouts, icon: Banknote },
    { key: "warehouses", label: t.sellerWarehouses, icon: Boxes },
    { key: "suppliers", label: t.sellerSuppliers, icon: Handshake },
    { key: "profile", label: t.sellerShopProfile, icon: Check }
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-primary">{t.sellerBadge}</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">{t.sellerDashboardTitle}</h1>
          <p className="mt-2 text-muted-foreground">{t.sellerDashboardSubtitle}</p>
        </div>
        <button type="button" onClick={() => { setIsLoading(true); void load(); }}
          className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-semibold">
          <RefreshCw className="h-4 w-4" /> {t.sellerRefresh}
        </button>
      </div>

      {notice && <p className="rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>}
      {error && <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap gap-1 rounded-full border border-border p-1">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button key={key} type="button" onClick={() => setTab(key)}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold transition ${
              tab === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {tab === "overview" && <Overview dash={dash} t={t} />}
      {tab === "orders" && (
        <Orders
          subOrders={subOrders}
          busy={busy}
          t={t}
          onAdvance={(order, status) => act(
            () => setSubOrderStatus(order.id, status),
            t.sellerStatusUpdated)}
        />
      )}
      {tab === "payouts" && (
        <Payouts
          dash={dash}
          busy={busy}
          t={t}
          onRequest={(method, ref) => act(
            () => requestPayout(method, ref),
            t.sellerPayoutRequested)}
        />
      )}
      {tab === "warehouses" && (
        <Warehouses
          warehouses={warehouses}
          busy={busy}
          t={t}
          onSave={(input) => act(() => saveWarehouse(input), t.sellerWarehouseSaved)}
          onDelete={(id) => act(() => deleteWarehouse(id), t.sellerWarehouseDeleted)}
          onStock={(productId, warehouseId, qty) => act(
            () => setWarehouseStock(productId, warehouseId, qty),
            t.sellerStockSaved)}
        />
      )}
      {tab === "suppliers" && <Suppliers suppliers={suppliers} t={t} />}
      {tab === "profile" && <ProfileForm busy={busy} t={t} vendor={vendor}
        onSave={(input) => act(() => saveVendorOnboarding(input), t.sellerProfileSaved)} />}
    </div>
  );
}

type T = TranslationKeys;

/**
 * Commission is shown as "what DLX takes", never as the seller's own revenue.
 * Conflating the two is how marketplaces end up paying a seller their own money
 * back, so the labels are explicit about whose figure this is.
 */
function Overview({ dash, t }: { dash: SellerDashboardData; t: T }) {
  const cells = [
    { label: t.sellerStatProducts, value: String(dash.product_count) },
    { label: t.sellerStatSubOrders, value: String(dash.sub_order_count) },
    { label: t.sellerStatUnitsSold, value: String(dash.units_sold) },
    { label: t.sellerStatGrossRevenue, value: formatMoney(dash.gross_revenue) },
    { label: t.sellerCommissionPending, value: formatMoney(dash.commission_pending) },
    { label: t.sellerCommissionPaid, value: formatMoney(dash.commission_paid) },
    { label: t.sellerCommissionReversed, value: formatMoney(dash.commission_reversed) },
    { label: t.sellerPendingPayoutNet, value: formatMoney(dash.pending_payout_net) }
  ];
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {cells.map((cell) => (
        <div key={cell.label} className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
          <p className="text-xs font-semibold text-muted-foreground">{cell.label}</p>
          <p className="mt-1 break-words text-2xl font-bold">{cell.value}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * Statuses a seller may set, and only while the sub-order is still open.
 * `delivered` is absent by design: DLX staff confirm COD arrival, and
 * `seller_update_sub_order_status` refuses it for anyone who is not an admin.
 */
const SELLER_STATUSES: SubOrderStatus[] = ["preparing", "confirmed", "ready", "out_for_delivery"];
const TERMINAL_STATUSES: SubOrderStatus[] = ["delivered", "cancelled", "refunded"];

/**
 * Exhaustive label maps rather than `t[\`sellerStatus_${x}\`]`: a template-literal
 * index silently widens to `string`, which drops the key from `TranslationKeys`
 * and lets a typo or a renamed locale key reach the UI untranslated.
 */
type StatusLabelKey = `sellerStatus_${SubOrderStatus}`;
const STATUS_LABEL_KEYS: Record<SubOrderStatus, StatusLabelKey> = {
  pending: "sellerStatus_pending",
  preparing: "sellerStatus_preparing",
  confirmed: "sellerStatus_confirmed",
  ready: "sellerStatus_ready",
  out_for_delivery: "sellerStatus_out_for_delivery",
  delivered: "sellerStatus_delivered",
  cancelled: "sellerStatus_cancelled",
  refunded: "sellerStatus_refunded"
};

type PayoutLabelKey = `sellerPayout_${PayoutStatus}`;
const PAYOUT_LABEL_KEYS: Record<PayoutStatus, PayoutLabelKey> = {
  requested: "sellerPayout_requested",
  processing: "sellerPayout_processing",
  paid: "sellerPayout_paid",
  cancelled: "sellerPayout_cancelled"
};

function Orders({ subOrders, busy, t, onAdvance }: {
  subOrders: SubOrder[];
  busy: boolean;
  t: T;
  onAdvance: (order: SubOrder, status: SubOrderStatus) => void;
}) {
  const statusLabel = (status: SubOrderStatus) => t[STATUS_LABEL_KEYS[status]];
  return (
    <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
      <h2 className="text-lg font-bold">{t.sellerOrdersTitle}</h2>
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        {t.sellerDeliveryNote}
      </p>
      <div className="mt-4 divide-y divide-border">
        {subOrders.length ? subOrders.map((order) => (
          <article key={order.id} className="flex flex-wrap items-center justify-between gap-4 py-4">
            <div className="min-w-0">
              <p className="font-semibold">
                {order.order_reference ?? order.order_id.slice(0, 8)}
                <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">
                  {statusLabel(order.status)}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                {t.sellerOrderSubtotal} {formatMoney(order.subtotal)} ·{" "}
                {t.sellerOrderCommission} {formatMoney(order.commission_amount)} ·{" "}
                {t.sellerOrderNet} {formatMoney(order.vendor_net_amount)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {TERMINAL_STATUSES.includes(order.status) ? null : (
                SELLER_STATUSES.filter((s) => s !== order.status).map((status) => (
                  <button key={status} type="button" disabled={busy}
                    onClick={() => onAdvance(order, status)}
                    className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
                    {statusLabel(status)}
                  </button>
                ))
              )}
            </div>
          </article>
        )) : <p className="py-5 text-sm text-muted-foreground">{t.sellerNoSubOrders}</p>}
      </div>
    </section>
  );
}

function Payouts({ dash, busy, t, onRequest }: {
  dash: SellerDashboardData;
  busy: boolean;
  t: T;
  onRequest: (method: PayoutMethod, ref: string) => void;
}) {
  const [method, setMethod] = useState<PayoutMethod>("mobile_money");
  const [ref, setRef] = useState("");
  const open = dash.active_payout_status;

  return (
    <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
      <h2 className="text-lg font-bold">{t.sellerPayoutsTitle}</h2>
      <p className="text-sm text-muted-foreground">{t.sellerPayoutsBody}</p>

      {open ? (
        <div className="mt-4 rounded-xl border border-border bg-muted/30 p-4">
          <p className="font-semibold">{t[PAYOUT_LABEL_KEYS[open]]}</p>
          <p className="text-sm text-muted-foreground">
            {t.sellerPendingPayoutNet} {formatMoney(dash.pending_payout_net)}
          </p>
        </div>
      ) : (
        <form className="mt-4 grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => { e.preventDefault(); onRequest(method, ref.trim()); setRef(""); }}>
          <label className="text-sm font-medium">
            {t.sellerPayoutMethod}
            <select value={method} onChange={(e) => setMethod(e.target.value as PayoutMethod)}
              className="mt-1 block w-full rounded-lg border border-border bg-background p-2.5">
              <option value="mobile_money">{t.sellerMethodMobileMoney}</option>
              <option value="bank_transfer">{t.sellerMethodBank}</option>
              <option value="cash">{t.sellerMethodCash}</option>
            </select>
          </label>
          <label className="text-sm font-medium">
            {t.sellerPayoutDestination}
            <input value={ref} onChange={(e) => setRef(e.target.value)} required
              placeholder="+243 991 234 567"
              className="mt-1 block w-full rounded-lg border border-border bg-background p-2.5" />
          </label>
          <p className="text-xs text-muted-foreground sm:col-span-2">{t.sellerPayoutDestinationHint}</p>
          <button type="submit" disabled={busy}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60 sm:col-span-2">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />}
            {t.sellerRequestPayout}
          </button>
        </form>
      )}
    </section>
  );
}

/**
 * Read-only supplier list. `seller_list_suppliers` is the only supplier RPC in
 * P14, so suppliers cannot be created or edited from the seller console yet --
 * admin does that. This panel is deliberately read-only rather than offering
 * buttons the server would reject.
 */
function Suppliers({ suppliers, t }: { suppliers: SellerSupplier[]; t: T }) {
  return (
    <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
      <h2 className="text-lg font-bold">{t.sellerSuppliers}</h2>
      <p className="text-sm text-muted-foreground">{t.sellerSuppliersBody}</p>
      <div className="mt-4 divide-y divide-border">
        {suppliers.length ? suppliers.map((supplier) => (
          <article key={supplier.supplier_id} className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="min-w-0">
              <p className="font-semibold">{supplier.name}</p>
              <p className="text-xs text-muted-foreground">
                {[supplier.contact_name, supplier.city].filter(Boolean).join(" · ")}
              </p>
              {(supplier.email || supplier.phone) && (
                <p className="text-xs text-muted-foreground">
                  {[supplier.email, supplier.phone].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold">
                {t.sellerSupplierProducts} {supplier.product_count}
              </span>
              {!supplier.active && (
                <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
                  {t.sellerSupplierInactive}
                </span>
              )}
            </div>
          </article>
        )) : (
          <p className="py-5 text-sm text-muted-foreground">{t.sellerNoSuppliers}</p>
        )}
      </div>
    </section>
  );
}

function Warehouses({ warehouses, busy, t, onSave, onDelete, onStock }: {
  warehouses: VendorWarehouse[];
  busy: boolean;
  t: T;
  onSave: (input: { warehouse_id?: string | null; name: string; city?: string; province?: string; address?: string; is_default?: boolean }) => void;
  onDelete: (id: string) => void;
  onStock: (productId: string, warehouseId: string, quantity: number) => void;
}) {
  const [products, setProducts] = useState<SellerProduct[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [province, setProvince] = useState("");
  const [address, setAddress] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [alloc, setAlloc] = useState<Record<string, string>>({});

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setCity("");
    setProvince("");
    setAddress("");
    setIsDefault(false);
  };

  const editWarehouse = (warehouse: VendorWarehouse) => {
    setEditingId(warehouse.id);
    setName(warehouse.name);
    setCity(warehouse.city ?? "");
    setProvince(warehouse.province ?? "");
    setAddress(warehouse.address ?? "");
    setIsDefault(warehouse.is_default);
  };

  useEffect(() => {
    let cancelled = false;
    listMyProducts()
      .then((rows) => { if (!cancelled) setProducts(rows); })
      .catch(() => { if (!cancelled) setProducts([]); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
        <h2 className="text-lg font-bold">{editingId ? t.sellerWarehouseEditTitle : t.sellerAddWarehouse}</h2>
        <p className="text-sm text-muted-foreground">{t.sellerWarehousesBody}</p>
        <form className="mt-4 grid gap-4 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            // The very first warehouse is always the default: a seller with zero
            // warehouses would otherwise have no pickup point at all.
            onSave({
              warehouse_id: editingId,
              name: name.trim(),
              city: city.trim(),
              province: province.trim(),
              address: address.trim(),
              is_default: isDefault || warehouses.length === 0
            });
            resetForm();
          }}>
          <label className="text-sm font-medium">
            {t.sellerWarehouseName}
            <input value={name} onChange={(e) => setName(e.target.value)} required
              className="mt-1 block w-full rounded-lg border border-border bg-background p-2.5" />
          </label>
          <label className="text-sm font-medium">
            {t.sellerWarehouseCity}
            <input value={city} onChange={(e) => setCity(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-border bg-background p-2.5" />
          </label>
          <label className="text-sm font-medium">
            {t.sellerWarehouseProvince}
            <input value={province} onChange={(e) => setProvince(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-border bg-background p-2.5" />
          </label>
          <label className="text-sm font-medium sm:col-span-3">
            {t.sellerWarehouseAddress}
            <input value={address} onChange={(e) => setAddress(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-border bg-background p-2.5" />
          </label>
          <label className="flex items-center gap-2 text-sm font-medium sm:col-span-3">
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)}
              className="h-4 w-4 rounded border-border" />
            {t.sellerWarehouseDefault}
          </label>
          <div className="flex flex-wrap gap-3 sm:col-span-3">
            <button type="submit" disabled={busy}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
              <Plus className="h-4 w-4" /> {editingId ? t.sellerSaveProfile : t.sellerAddWarehouse}
            </button>
            {editingId && (
              <button type="button" onClick={resetForm}
                className="rounded-full border border-border px-5 py-2.5 text-sm font-semibold">
                {t.sellerWarehouseCancelEdit}
              </button>
            )}
          </div>
        </form>
      </section>

      {warehouses.length ? warehouses.map((warehouse) => (
        <section key={warehouse.id} className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-bold">{warehouse.name}</h3>
              <p className="text-xs text-muted-foreground">
                {[warehouse.address, warehouse.city, warehouse.province].filter(Boolean).join(", ")}
                {warehouse.is_default ? ` · ${t.sellerWarehouseDefault}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={busy}
                onClick={() => editWarehouse(warehouse)}
                className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
                <Pencil className="h-3.5 w-3.5" /> {t.sellerWarehouseEdit}
              </button>
              {!warehouse.is_default && (
                <button type="button" disabled={busy}
                  onClick={() => onSave({
                    warehouse_id: warehouse.id,
                    name: warehouse.name,
                    city: warehouse.city ?? "",
                    province: warehouse.province ?? "",
                    address: warehouse.address ?? "",
                    is_default: true
                  })}
                  className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
                  <Star className="h-3.5 w-3.5" /> {t.sellerWarehouseMakeDefault}
                </button>
              )}
              <button type="button" disabled={busy}
                onClick={() => { if (window.confirm(t.sellerDeleteWarehouseConfirm)) { onDelete(warehouse.id); if (editingId === warehouse.id) resetForm(); } }}
                className="inline-flex items-center gap-1 rounded-full border border-destructive/30 px-3 py-1.5 text-xs font-semibold text-destructive disabled:opacity-50">
                <Trash2 className="h-3.5 w-3.5" /> {t.sellerDeleteWarehouse}
              </button>
            </div>
          </div>

          <div className="mt-4 divide-y divide-border">
            {products.map((product) => (
              <div key={product.product_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{product.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.sellerStockTotal} {product.stock_quantity}
                  </p>
                </div>
                <form className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const qty = Number(alloc[product.product_id] ?? "0");
                    if (Number.isFinite(qty)) onStock(product.product_id, warehouse.id, qty);
                  }}>
                  <input value={alloc[product.product_id] ?? ""} onChange={(e) => setAlloc((prev) => ({ ...prev, [product.product_id]: e.target.value }))}
                    inputMode="numeric" placeholder="0"
                    className="w-20 rounded-lg border border-border bg-background px-2 py-1.5 text-sm" />
                  <button type="submit" disabled={busy}
                    className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
                    {t.sellerSaveStock}
                  </button>
                </form>
              </div>
            ))}
          </div>
        </section>
      )) : (
        <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {t.sellerNoWarehouses}
        </p>
      )}
    </div>
  );
}

function ProfileForm({ busy, t, vendor, onSave }: {
  busy: boolean;
  t: T;
  vendor: MyVendor | null;
  onSave: (input: {
    legal_name: string;
    contact_email: string;
    contact_phone: string;
    payout_method: PayoutMethod;
    payout_account_ref: string;
    shop_description: string;
  }) => void;
}) {
  // Seeded from the seller row rather than left blank: these fields are written
  // with COALESCE(NULLIF(...)) server-side, so an empty box keeps the stored
  // value. Without a prefill the seller sees a blank form for data DLX already
  // holds and cannot tell what is actually on file.
  const [legalName, setLegalName] = useState(vendor?.legal_name ?? "");
  const [email, setEmail] = useState(vendor?.contact_email ?? "");
  const [phone, setPhone] = useState(vendor?.contact_phone ?? "");
  const [method, setMethod] = useState<PayoutMethod>(vendor?.payout_method ?? "mobile_money");
  const [ref, setRef] = useState(vendor?.payout_account_ref ?? "");
  const [description, setDescription] = useState(vendor?.description ?? vendor?.shop_description ?? "");

  return (
    <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
      <h2 className="text-lg font-bold">{t.sellerShopProfile}</h2>
      <p className="text-sm text-muted-foreground">{t.sellerProfileBody}</p>
      <form className="mt-4 grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            legal_name: legalName.trim(),
            contact_email: email.trim(),
            contact_phone: phone.trim(),
            payout_method: method,
            payout_account_ref: ref.trim(),
            shop_description: description.trim()
          });
        }}>
        <label className="text-sm font-medium">
          {t.sellerLegalName}
          <input value={legalName} onChange={(e) => setLegalName(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-border bg-background p-2.5" />
        </label>
        <label className="text-sm font-medium">
          {t.sellerContactEmail}
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-border bg-background p-2.5" />
        </label>
        <label className="text-sm font-medium">
          {t.sellerContactPhone}
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+243 991 234 567"
            className="mt-1 block w-full rounded-lg border border-border bg-background p-2.5" />
        </label>
        <label className="text-sm font-medium">
          {t.sellerPayoutMethod}
          <select value={method} onChange={(e) => setMethod(e.target.value as PayoutMethod)}
            className="mt-1 block w-full rounded-lg border border-border bg-background p-2.5">
            <option value="mobile_money">{t.sellerMethodMobileMoney}</option>
            <option value="bank_transfer">{t.sellerMethodBank}</option>
            <option value="cash">{t.sellerMethodCash}</option>
          </select>
        </label>
        <label className="text-sm font-medium sm:col-span-2">
          {t.sellerPayoutDestination}
          <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="+243 991 234 567"
            className="mt-1 block w-full rounded-lg border border-border bg-background p-2.5" />
        </label>
        <label className="text-sm font-medium sm:col-span-2">
          {t.sellerShopDescription}
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
            className="mt-1 block w-full rounded-lg border border-border bg-background p-2.5" />
        </label>
        <button type="submit" disabled={busy}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60 sm:col-span-2">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {t.sellerSaveProfile}
        </button>
      </form>
    </section>
  );
}
