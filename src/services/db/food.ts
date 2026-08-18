import { FoodVendor, Product } from "../../types";
import { isDemoMode, isSupabaseConfigured, supabase } from "./index";

export function isVendorOpenNow(vendor: FoodVendor, now = new Date()): boolean {
  if (!vendor.active) return false;
  if (vendor.is_24_7) return true;

  const day = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const today = vendor.hours.find((h) => h.day === day);
  if (!today || today.closed) return false;

  const [openH, openM] = today.open.split(":").map(Number);
  const [closeH, closeM] = today.close.split(":").map(Number);
  const openMinutes = openH * 60 + openM;
  const closeMinutes = closeH * 60 + closeM;
  return minutes >= openMinutes && minutes <= closeMinutes;
}

export async function getFoodVendors(includeInactive = false): Promise<FoodVendor[]> {
  if (isSupabaseConfigured && supabase) {
    let query = supabase.from("food_vendors").select("*").order("name");
    if (!includeInactive) query = query.eq("active", true);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []) as FoodVendor[];
  }
  if (!isDemoMode) throw new Error("No production data source configured.");
  const raw = localStorage.getItem("dlxstore_food_vendors");
  const vendors: FoodVendor[] = raw ? JSON.parse(raw) : [];
  return includeInactive ? vendors : vendors.filter((v) => v.active);
}

export async function getFoodProducts(): Promise<Product[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("products")
      .select(`*, product_images (image_url, is_primary, display_order)`)
      .eq("product_type", "food")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map((p: Record<string, unknown>) => ({
      ...p,
      images: Array.isArray(p.product_images)
        ? (p.product_images as { image_url: string }[])
            .sort((a, b) => (a as { display_order?: number }).display_order! - (b as { display_order?: number }).display_order!)
            .map((img) => img.image_url)
        : [],
    })) as Product[];
  }
  if (!isDemoMode) throw new Error("No production data source configured.");
  const raw = localStorage.getItem("dlxstore_products");
  const products: Product[] = raw ? JSON.parse(raw) : [];
  return products.filter((p) => p.product_type === "food");
}
