import { FoodVendor, Product, BusinessHours, FoodCategory } from "../../types";
import { isDemoMode, isSupabaseConfigured, supabase, initMockDb } from "./index";

type FoodVendorFields = Omit<FoodVendor, "id" | "created_at">;
type FoodCategoryFields = Omit<FoodCategory, "id" | "created_at">;

function isTableMissing(error: unknown): boolean {
  const err = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : String(error ?? "");
  const message = error && typeof error === "object" && "message" in error
    ? String((error as { message?: unknown }).message ?? "")
    : "";
  return (
    err === "PGRST205" ||
    err === "42P01" ||
    /Could not find the table/i.test(message) ||
    /relation .* does not exist/i.test(message) ||
    /table .* does not exist/i.test(message)
  );
}

function readMockFoodVendors(): FoodVendor[] {
  initMockDb();
  return JSON.parse(localStorage.getItem("dlxstore_food_vendors") || "[]") as FoodVendor[];
}

function writeMockFoodVendors(vendors: FoodVendor[]) {
  localStorage.setItem("dlxstore_food_vendors", JSON.stringify(vendors));
}

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
    if (error) {
      if (isTableMissing(error)) return [];
      throw new Error(error.message || "An error occurred.");
    }
    return (data || []) as FoodVendor[];
  }
  if (!isDemoMode) throw new Error("No production data source configured.");
  const vendors = readMockFoodVendors();
  return includeInactive ? vendors : vendors.filter((v) => v.active);
}

export async function getFoodVendorBySlug(slug: string): Promise<FoodVendor | null> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.from("food_vendors").select("*").eq("slug", slug).maybeSingle();
    if (error) {
      if (isTableMissing(error)) return null;
      throw new Error(error.message || "An error occurred.");
    }
    return (data as FoodVendor) ?? null;
  }
  if (!isDemoMode) throw new Error("No production data source configured.");
  return readMockFoodVendors().find((v) => v.slug === slug) ?? null;
}

export async function createFoodVendor(fields: Partial<FoodVendorFields>): Promise<FoodVendor> {
  const payload = {
    name: fields.name ?? "",
    slug: fields.slug ?? "",
    province: fields.province ?? "",
    city: fields.city ?? "",
    description: fields.description ?? null,
    phone: fields.phone ?? null,
    email: fields.email ?? null,
    image_url: fields.image_url ?? null,
    banner_image_url: fields.banner_image_url ?? null,
    is_24_7: fields.is_24_7 ?? false,
    hours: fields.hours ?? [],
    food_categories: fields.food_categories ?? [],
    is_featured: fields.is_featured ?? false,
    minimum_order_amount: fields.minimum_order_amount ?? 0,
    delivery_fee: fields.delivery_fee ?? 0,
    rating: fields.rating ?? null,
    preparation_time_minutes: fields.preparation_time_minutes ?? null,
    active: fields.active ?? false,
  };
  if (!payload.name.trim()) throw new Error("Vendor name is required.");
  if (!payload.slug.trim()) throw new Error("Slug is required.");
  if (!payload.province.trim()) throw new Error("Province is required.");
  if (!payload.city.trim()) throw new Error("City is required.");

  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.from("food_vendors").insert(payload).select().single();
    if (error) throw new Error(error.message || "An error occurred.");
    return data as FoodVendor;
  }
  if (!isDemoMode) throw new Error("No production data source configured.");
  const vendors = readMockFoodVendors();
  const vendor: FoodVendor = { 
    ...(payload as FoodVendor), 
    id: `food-vendor-${crypto.randomUUID()}`, 
    created_at: new Date().toISOString() 
  };
  writeMockFoodVendors([...vendors, vendor]);
  return vendor;
}

export async function updateFoodVendor(id: string, fields: Partial<FoodVendorFields>): Promise<FoodVendor> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.from("food_vendors").update(fields).eq("id", id).select().single();
    if (error) throw new Error(error.message || "An error occurred.");
    return data as FoodVendor;
  }
  if (!isDemoMode) throw new Error("No production data source configured.");
  const vendors = readMockFoodVendors();
  const index = vendors.findIndex((v) => v.id === id);
  if (index === -1) throw new Error("Food vendor not found.");
  vendors[index] = { ...vendors[index], ...fields };
  writeMockFoodVendors(vendors);
  return vendors[index];
}

export async function deleteFoodVendor(id: string): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.from("food_vendors").delete().eq("id", id);
    if (error) throw new Error(error.message || "An error occurred.");
    return;
  }
  if (!isDemoMode) throw new Error("No production data source configured.");
  writeMockFoodVendors(readMockFoodVendors().filter((v) => v.id !== id));
}

export async function setFoodVendorStatus(id: string, active: boolean): Promise<FoodVendor> {
  return updateFoodVendor(id, { active });
}

export async function getFoodProducts(): Promise<Product[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("products")
      .select(`*, product_images (image_url, is_primary, display_order)`)
      .eq("product_type", "food")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message || "An error occurred.");
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

export async function getFoodProductsByVendor(vendorId: string): Promise<Product[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("products")
      .select(`*, product_images (image_url, is_primary, display_order)`)
      .eq("food_vendor_id", vendorId)
      .eq("product_type", "food")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message || "An error occurred.");
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
  return products.filter((p) => p.product_type === "food" && p.food_vendor_id === vendorId);
}

// --------------------------------------------------------------------------
// Food Categories
// --------------------------------------------------------------------------

function readMockFoodCategories(): FoodCategory[] {
  initMockDb();
  return JSON.parse(localStorage.getItem("dlxstore_food_categories") || "[]") as FoodCategory[];
}

function writeMockFoodCategories(categories: FoodCategory[]) {
  localStorage.setItem("dlxstore_food_categories", JSON.stringify(categories));
}

export async function getFoodCategories(options: { includeInactive?: boolean } = {}): Promise<FoodCategory[]> {
  if (isSupabaseConfigured && supabase) {
    let query = supabase.from("food_categories").select("*").order("display_order", { ascending: true }).order("name", { ascending: true });
    if (!options.includeInactive) query = query.eq("is_active", true);
    const { data, error } = await query;
    if (error) {
      if (isTableMissing(error)) return [];
      throw new Error(error.message || "An error occurred.");
    }
    return (data ?? []) as FoodCategory[];
  }
  if (!isDemoMode) throw new Error("No production data source configured.");
  const categories = readMockFoodCategories();
  return options.includeInactive ? categories : categories.filter((c) => c.is_active);
}

export async function createFoodCategory(fields: Partial<FoodCategoryFields>): Promise<FoodCategory> {
  const payload = {
    name: fields.name ?? "",
    slug: fields.slug ?? "",
    description: fields.description ?? null,
    icon_emoji: fields.icon_emoji ?? null,
    is_active: fields.is_active ?? true,
    display_order: fields.display_order ?? 0,
  };
  if (!payload.name.trim()) throw new Error("Category name is required.");
  if (!payload.slug.trim()) throw new Error("Slug is required.");

  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.from("food_categories").insert(payload).select().single();
    if (error) throw new Error(error.message || "An error occurred.");
    return data as FoodCategory;
  }
  if (!isDemoMode) throw new Error("No production data source configured.");
  const categories = readMockFoodCategories();
  const category: FoodCategory = { 
    ...(payload as FoodCategory), 
    id: `food-cat-${crypto.randomUUID()}`, 
    created_at: new Date().toISOString() 
  };
  writeMockFoodCategories([...categories, category]);
  return category;
}

export async function updateFoodCategory(id: string, fields: Partial<FoodCategoryFields>): Promise<FoodCategory> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.from("food_categories").update(fields).eq("id", id).select().single();
    if (error) throw new Error(error.message || "An error occurred.");
    return data as FoodCategory;
  }
  if (!isDemoMode) throw new Error("No production data source configured.");
  const categories = readMockFoodCategories();
  const index = categories.findIndex((c) => c.id === id);
  if (index === -1) throw new Error("Food category not found.");
  categories[index] = { ...categories[index], ...fields };
  writeMockFoodCategories(categories);
  return categories[index];
}

export async function deleteFoodCategory(id: string): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.from("food_categories").delete().eq("id", id);
    if (error) throw new Error(error.message || "An error occurred.");
    return;
  }
  if (!isDemoMode) throw new Error("No production data source configured.");
  writeMockFoodCategories(readMockFoodCategories().filter((c) => c.id !== id));
}
