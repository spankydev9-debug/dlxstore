import { PartnerShop, ShopProduct, ShopStats } from "../../types";
import { initMockDb, isDemoMode, isSupabaseConfigured, supabase } from "./index";

type PartnerShopFields = Omit<PartnerShop, "id" | "created_at" | "updated_at">;

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

function readMockPartnerShops(): PartnerShop[] {
  initMockDb();
  return JSON.parse(localStorage.getItem("dlxstore_partner_shops") || "[]") as PartnerShop[];
}

function writeMockPartnerShops(shops: PartnerShop[]) {
  localStorage.setItem("dlxstore_partner_shops", JSON.stringify(shops));
}

function readMockShopProducts(): ShopProduct[] {
  initMockDb();
  return JSON.parse(localStorage.getItem("dlxstore_shop_products") || "[]") as ShopProduct[];
}

function writeMockShopProducts(products: ShopProduct[]) {
  localStorage.setItem("dlxstore_shop_products", JSON.stringify(products));
}

// --------------------------------------------------------------------------
// Partner Shops (unified vendor/shop table)
// --------------------------------------------------------------------------

export async function getPartnerShops(options: { includeInactive?: boolean } = {}): Promise<PartnerShop[]> {
  if (isSupabaseConfigured && supabase) {
    let query = supabase.from("vendors").select("*").order("created_at", { ascending: false });
    if (!options.includeInactive) query = query.eq("status", "active");
    const { data, error } = await query;
    if (error) {
      if (isTableMissing(error)) return [];
      throw new Error(error.message || "An error occurred.");
    }
    return (data ?? []) as PartnerShop[];
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  const shops = readMockPartnerShops();
  return options.includeInactive ? shops : shops.filter((s) => s.status === "active");
}

export async function getPartnerShopBySlug(slug: string): Promise<PartnerShop | null> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.from("vendors").select("*").eq("slug", slug).maybeSingle();
    if (error) {
      if (isTableMissing(error)) return null;
      throw new Error(error.message || "An error occurred.");
    }
    return (data as PartnerShop) ?? null;
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  return readMockPartnerShops().find((s) => s.slug === slug) ?? null;
}

export async function createPartnerShop(fields: Partial<PartnerShopFields>): Promise<PartnerShop> {
  const payload = {
    business_name: fields.business_name ?? "",
    slug: fields.slug ?? "",
    description: fields.description ?? null,
    shop_name: fields.shop_name ?? null,
    shop_description: fields.shop_description ?? null,
    shop_image_url: fields.shop_image_url ?? null,
    banner_image_url: fields.banner_image_url ?? null,
    province: fields.province ?? "",
    city: fields.city ?? null,
    status: fields.status ?? "pending",
    is_featured: fields.is_featured ?? false,
    commission_rate: fields.commission_rate ?? null,
    payment_info: fields.payment_info ?? null,
    business_hours: fields.business_hours ?? null,
  };
  if (!payload.business_name.trim()) throw new Error("Business name is required.");
  if (!payload.slug.trim()) throw new Error("Slug is required.");
  if (!payload.province.trim()) throw new Error("Province is required.");

  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.from("vendors").insert(payload).select().single();
    if (error) throw new Error(error.message || "An error occurred.");
    return data as PartnerShop;
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  const shops = readMockPartnerShops();
  const shop: PartnerShop = { 
    ...(payload as PartnerShop), 
    id: `shop-${crypto.randomUUID()}`, 
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  writeMockPartnerShops([...shops, shop]);
  return shop;
}

export async function updatePartnerShop(id: string, fields: Partial<PartnerShopFields>): Promise<PartnerShop> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.from("vendors").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id).select().single();
    if (error) throw new Error(error.message || "An error occurred.");
    return data as PartnerShop;
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  const shops = readMockPartnerShops();
  const index = shops.findIndex((s) => s.id === id);
  if (index === -1) throw new Error("Partner shop not found.");
  shops[index] = { ...shops[index], ...fields, updated_at: new Date().toISOString() };
  writeMockPartnerShops(shops);
  return shops[index];
}

export async function deletePartnerShop(id: string): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.from("vendors").delete().eq("id", id);
    if (error) throw new Error(error.message || "An error occurred.");
    return;
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  writeMockPartnerShops(readMockPartnerShops().filter((s) => s.id !== id));
}

export async function setPartnerShopStatus(id: string, status: PartnerShop["status"]): Promise<PartnerShop> {
  return updatePartnerShop(id, { status });
}

export async function setPartnerShopFeatured(id: string, isFeatured: boolean): Promise<PartnerShop> {
  return updatePartnerShop(id, { is_featured: isFeatured });
}

// --------------------------------------------------------------------------
// Shop Products (product-shop relationships)
// --------------------------------------------------------------------------

export async function getShopProducts(shopId: string): Promise<ShopProduct[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("shop_products")
      .select("*")
      .eq("shop_id", shopId)
      .order("display_order", { ascending: true });
    if (error) {
      if (isTableMissing(error)) return [];
      throw new Error(error.message || "An error occurred.");
    }
    return (data ?? []) as ShopProduct[];
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  return readMockShopProducts().filter((sp) => sp.shop_id === shopId).sort((a, b) => a.display_order - b.display_order);
}

export async function addProductToShop(shopId: string, productId: string, displayOrder?: number): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.from("shop_products").upsert(
      { shop_id: shopId, product_id: productId, display_order: displayOrder ?? 0, is_visible: true },
    );
    if (error) throw new Error(error.message || "An error occurred.");
    return;
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  const products = readMockShopProducts();
  const existing = products.find((p) => p.shop_id === shopId && p.product_id === productId);
  if (existing) return;
  const next = [...products, { 
    id: `shop-prod-${crypto.randomUUID()}`, 
    shop_id: shopId, 
    product_id: productId, 
    display_order: displayOrder ?? products.length, 
    is_visible: true, 
    created_at: new Date().toISOString() 
  }];
  writeMockShopProducts(next);
}

export async function removeProductFromShop(shopId: string, productId: string): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.from("shop_products").delete().eq("shop_id", shopId).eq("product_id", productId);
    if (error) throw new Error(error.message || "An error occurred.");
    return;
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  writeMockShopProducts(readMockShopProducts().filter((sp) => !(sp.shop_id === shopId && sp.product_id === productId)));
}

export async function setShopProductVisibility(shopId: string, productId: string, isVisible: boolean): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.from("shop_products").update({ is_visible: isVisible }).eq("shop_id", shopId).eq("product_id", productId);
    if (error) throw new Error(error.message || "An error occurred.");
    return;
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  const products = readMockShopProducts();
  const index = products.findIndex((sp) => sp.shop_id === shopId && sp.product_id === productId);
  if (index === -1) return;
  products[index].is_visible = isVisible;
  writeMockShopProducts(products);
}

export async function reorderShopProducts(shopId: string, productIds: string[]): Promise<void> {
  const client = supabase;
  if (isSupabaseConfigured && client) {
    const results = await Promise.all(productIds.map((productId, index) =>
      client.from("shop_products").update({ display_order: index }).eq("shop_id", shopId).eq("product_id", productId)
    ));
    const failure = results.find((r) => r.error)?.error;
    if (failure) throw failure;
    return;
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  const products = readMockShopProducts().filter((sp) => sp.shop_id === shopId);
  const order = new Map(productIds.map((id, index) => [id, index]));
  const updated = products.map((sp) => ({ ...sp, display_order: order.get(sp.product_id) ?? sp.display_order }));
  const otherProducts = readMockShopProducts().filter((sp) => sp.shop_id !== shopId);
  writeMockShopProducts([...otherProducts, ...updated]);
}

// --------------------------------------------------------------------------
// Shop Statistics
// --------------------------------------------------------------------------

export async function getShopStats(shopId: string): Promise<ShopStats> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("get_shop_stats", { shop_id: shopId });
    if (error) {
      if (isTableMissing(error)) return { product_count: 0, total_orders: 0, total_revenue: 0 };
      throw new Error(error.message || "An error occurred.");
    }
    const result = (data as any)?.[0];
    return {
      product_count: Number(result?.product_count ?? 0),
      total_orders: Number(result?.total_orders ?? 0),
      total_revenue: Number(result?.total_revenue ?? 0),
    };
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  const shopProducts = readMockShopProducts().filter((sp) => sp.shop_id === shopId);
  return {
    product_count: shopProducts.length,
    total_orders: 0,
    total_revenue: 0,
  };
}