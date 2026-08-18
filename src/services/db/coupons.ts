import { Coupon } from "../../types";
import { isDemoMode, isSupabaseConfigured, supabase } from "./index";

export interface CouponValidation {
  coupon: Coupon;
  discount: number;
}

export async function getCoupons(includeInactive = false): Promise<Coupon[]> {
  if (isSupabaseConfigured && supabase) {
    let query = supabase.from("coupons").select("*").order("created_at", { ascending: false });
    if (!includeInactive) query = query.eq("active", true);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []) as Coupon[];
  }
  if (!isDemoMode) throw new Error("No production data source configured.");
  const raw = localStorage.getItem("dlxstore_coupons");
  const coupons: Coupon[] = raw ? JSON.parse(raw) : [];
  return includeInactive ? coupons : coupons.filter((c) => c.active);
}

export async function saveCoupon(coupon: Omit<Coupon, "id" | "used_count" | "created_at">): Promise<Coupon> {
  const payload = { ...coupon, code: coupon.code.toUpperCase().trim() };
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.from("coupons").insert([payload]).select().single();
    if (error) throw error;
    return data as Coupon;
  }
  if (!isDemoMode) throw new Error("No production data source configured.");
  const coupons = await getCoupons(true);
  const created: Coupon = {
    ...payload,
    id: `cpn-${Date.now()}`,
    used_count: 0,
    created_at: new Date().toISOString(),
  };
  localStorage.setItem("dlxstore_coupons", JSON.stringify([created, ...coupons]));
  return created;
}

export async function updateCoupon(id: string, fields: Partial<Coupon>): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.from("coupons").update(fields).eq("id", id);
    if (error) throw error;
    return;
  }
  if (!isDemoMode) throw new Error("No production data source configured.");
  const coupons = await getCoupons(true);
  localStorage.setItem(
    "dlxstore_coupons",
    JSON.stringify(coupons.map((c) => (c.id === id ? { ...c, ...fields } : c)))
  );
}

function computeDiscount(coupon: Coupon, subtotal: number): number {
  if (subtotal < coupon.min_order) return 0;
  if (coupon.type === "fixed") return Math.min(coupon.value, subtotal);
  return Math.min(subtotal, Math.round(subtotal * (coupon.value / 100) * 100) / 100);
}

export async function validateCoupon(code: string, subtotal: number, isReturning = false): Promise<CouponValidation | null> {
  const normalized = code.toUpperCase().trim();
  if (!normalized) return null;

  const coupons = await getCoupons(true);
  const coupon = coupons.find((c) => c.code.toUpperCase() === normalized);
  if (!coupon || !coupon.active) return null;

  if (coupon.expires_at && new Date(coupon.expires_at).getTime() < Date.now()) return null;
  if (coupon.max_uses != null && coupon.used_count >= coupon.max_uses) return null;
  if (coupon.audience === "returning" && !isReturning) return null;

  const discount = computeDiscount(coupon, subtotal);
  if (discount <= 0) return null;

  return { coupon, discount };
}

export async function incrementCouponUsage(code: string): Promise<void> {
  const coupons = await getCoupons(true);
  const coupon = coupons.find((c) => c.code.toUpperCase() === code.toUpperCase().trim());
  if (!coupon) return;

  if (isSupabaseConfigured && supabase) {
    await supabase
      .from("coupons")
      .update({ used_count: coupon.used_count + 1 })
      .eq("id", coupon.id);
    return;
  }
  if (!isDemoMode) return;
  await updateCoupon(coupon.id, { used_count: coupon.used_count + 1 });
}
