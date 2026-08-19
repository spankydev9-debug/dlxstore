import { Category, InventoryHistoryEntry, Product } from "../../types";
import { createNotification } from "./notifications";
import { initMockDb, isSupabaseConfigured, supabase } from "./index";

type ProductImageRow = { image_url: string; is_primary: boolean; display_order: number };
type ProductWithImageRows = Omit<Product, "images"> & { product_images?: ProductImageRow[] | null };
type ProductFields = Omit<Product, "id" | "created_at" | "images" | "reviews">;
type ProductUpdate = Partial<ProductFields> & { images?: string[] };
type CategoryFields = Pick<Category, "name" | "slug"> & Partial<Pick<Category, "description" | "image_url" | "is_active" | "display_order">>;

function mapProduct(row: ProductWithImageRows): Product {
  const { product_images, ...product } = row;
  return {
    ...product,
    images: [...(product_images ?? [])]
      .sort((left, right) => left.display_order - right.display_order)
      .map((image) => image.image_url),
  };
}

function normalizeImageUrls(images: string[]) {
  return images.map((url) => url.trim()).filter(Boolean);
}

export async function getCategories(options: { includeInactive?: boolean } = {}): Promise<Category[]> {
  if (isSupabaseConfigured && supabase) {
    let query = supabase.from("categories").select("*").order("display_order", { ascending: true }).order("name", { ascending: true });
    if (!options.includeInactive) query = query.eq("is_active", true);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as Category[];
  }

  initMockDb();
  const raw = localStorage.getItem("dlxstore_categories");
  const categories = raw ? JSON.parse(raw) as Category[] : [];
  return options.includeInactive ? categories : categories.filter((category) => category.is_active !== false);
}

export async function createCategory(fields: CategoryFields): Promise<Category> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.from("categories").insert({
      ...fields,
      is_active: fields.is_active ?? true,
      display_order: fields.display_order ?? 0,
    }).select().single();
    if (error) throw error;
    return data as Category;
  }

  initMockDb();
  const categories = await getCategories({ includeInactive: true });
  const category: Category = {
    id: `category-${crypto.randomUUID()}`,
    name: fields.name,
    slug: fields.slug,
    description: fields.description,
    image_url: fields.image_url,
    is_active: fields.is_active ?? true,
    display_order: fields.display_order ?? categories.length,
    created_at: new Date().toISOString(),
  };
  localStorage.setItem("dlxstore_categories", JSON.stringify([...categories, category]));
  return category;
}

export async function updateCategory(id: string, fields: Partial<CategoryFields>): Promise<Category> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.from("categories").update(fields).eq("id", id).select().single();
    if (error) throw error;
    return data as Category;
  }

  initMockDb();
  const categories = await getCategories({ includeInactive: true });
  const index = categories.findIndex((category) => category.id === id);
  if (index === -1) throw new Error("Category not found.");
  categories[index] = { ...categories[index], ...fields };
  localStorage.setItem("dlxstore_categories", JSON.stringify(categories));
  return categories[index];
}

export async function deleteCategory(id: string): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) throw error;
    return;
  }

  initMockDb();
  const categories = await getCategories({ includeInactive: true });
  localStorage.setItem("dlxstore_categories", JSON.stringify(categories.filter((category) => category.id !== id)));
}

export async function reorderCategories(categoryIds: string[]): Promise<void> {
  const client = supabase;
  if (isSupabaseConfigured && client) {
    const results = await Promise.all(categoryIds.map((id, index) => client.from("categories").update({ display_order: index }).eq("id", id)));
    const failure = results.find((result) => result.error)?.error;
    if (failure) throw failure;
    return;
  }

  initMockDb();
  const categories = await getCategories({ includeInactive: true });
  const order = new Map(categoryIds.map((id, index) => [id, index]));
  const updated = categories.map((category) => ({ ...category, display_order: order.get(category.id) ?? category.display_order ?? categories.length }));
  localStorage.setItem("dlxstore_categories", JSON.stringify(updated));
}

export async function getProducts(options: { includeInactive?: boolean } = {}): Promise<Product[]> {
  if (isSupabaseConfigured && supabase) {
    let query = supabase.from("products").select(`
      *,
      product_images (image_url, is_primary, display_order)
    `).order("created_at", { ascending: false });
    if (!options.includeInactive) query = query.eq("is_active", true).eq("is_archived", false);
    const { data, error } = await query;
    if (error) throw error;
    return ((data ?? []) as ProductWithImageRows[]).map(mapProduct);
  }

  initMockDb();
  const raw = localStorage.getItem("dlxstore_products");
  const products = raw ? JSON.parse(raw) as Product[] : [];
  return options.includeInactive ? products : products.filter((product) => product.is_active !== false && product.is_archived !== true);
}

async function getProductWithImagesByField(field: "id" | "slug", value: string): Promise<Product | null> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.from("products").select(`
      *,
      product_images (image_url, is_primary, display_order)
    `).eq(field, value).maybeSingle();
    if (error) throw error;
    return data ? mapProduct(data as ProductWithImageRows) : null;
  }
  const products = await getProducts({ includeInactive: true });
  return products.find((product) => product[field] === value) ?? null;
}

export function getProductBySlug(slug: string) {
  return getProductWithImagesByField("slug", slug);
}

export function getProductById(id: string) {
  return getProductWithImagesByField("id", id);
}

export async function createProduct(productData: ProductFields & { images: string[] }): Promise<Product> {
  const images = normalizeImageUrls(productData.images);
  if (isSupabaseConfigured && supabase) {
    const { images: _images, ...fields } = productData;
    const { data, error } = await supabase.from("products").insert(fields).select().single();
    if (error) throw error;
    if (images.length) {
      const { error: imageError } = await supabase.from("product_images").insert(images.map((imageUrl, index) => ({
        product_id: data.id,
        image_url: imageUrl,
        is_primary: index === 0,
        display_order: index,
      })));
      if (imageError) throw imageError;
    }
    return { ...(data as Omit<Product, "images">), images };
  }

  initMockDb();
  const products = await getProducts({ includeInactive: true });
  const product: Product = { ...productData, images, id: `prod-${crypto.randomUUID()}`, created_at: new Date().toISOString() };
  localStorage.setItem("dlxstore_products", JSON.stringify([product, ...products]));
  return product;
}

export async function updateProduct(id: string, productFields: ProductUpdate): Promise<Product> {
  const { images, stock_quantity: targetStock, ...fields } = productFields;
  const normalizedImages = images ? normalizeImageUrls(images) : undefined;

  if (isSupabaseConfigured && supabase) {
    const { data: current, error: currentError } = await supabase.from("products").select("stock_quantity").eq("id", id).single();
    if (currentError) throw currentError;
    const { data, error } = await supabase.from("products").update(fields).eq("id", id).select().single();
    if (error) throw error;

    if (normalizedImages) {
      const { error: deleteError } = await supabase.from("product_images").delete().eq("product_id", id);
      if (deleteError) throw deleteError;
      if (normalizedImages.length) {
        const { error: imageError } = await supabase.from("product_images").insert(normalizedImages.map((imageUrl, index) => ({
          product_id: id,
          image_url: imageUrl,
          is_primary: index === 0,
          display_order: index,
        })));
        if (imageError) throw imageError;
      }
    }

    if (targetStock !== undefined && targetStock !== current.stock_quantity) {
      await adjustInventory(id, targetStock - current.stock_quantity, "manual_adjustment", "Stock set from product editor.");
    }
    return { ...(data as Omit<Product, "images">), stock_quantity: targetStock ?? current.stock_quantity, images: normalizedImages ?? [] };
  }

  initMockDb();
  const products = await getProducts({ includeInactive: true });
  const index = products.findIndex((product) => product.id === id);
  if (index === -1) throw new Error("Product not found.");
  const current = products[index];
  products[index] = { ...current, ...fields, ...(normalizedImages ? { images: normalizedImages } : {}) };
  localStorage.setItem("dlxstore_products", JSON.stringify(products));
  if (targetStock !== undefined && targetStock !== current.stock_quantity) {
    await adjustInventory(id, targetStock - current.stock_quantity, "manual_adjustment", "Stock set from product editor.");
  }
  return { ...products[index], stock_quantity: targetStock ?? current.stock_quantity };
}

export function archiveProduct(id: string, archived: boolean) {
  return updateProduct(id, { is_archived: archived });
}

export function setProductVisibility(id: string, isActive: boolean) {
  return updateProduct(id, { is_active: isActive });
}

export async function deleteProduct(id: string): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) throw error;
    return;
  }

  initMockDb();
  const products = await getProducts({ includeInactive: true });
  localStorage.setItem("dlxstore_products", JSON.stringify(products.filter((product) => product.id !== id)));
}

export async function adjustInventory(productId: string, quantityChanged: number, type: InventoryHistoryEntry["type"], notes?: string): Promise<void> {
  if (quantityChanged === 0) return;
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.rpc("adjust_inventory", {
      p_product_id: productId,
      p_quantity_changed: quantityChanged,
      p_type: type,
      p_notes: notes ?? null,
    });
    if (error) throw error;
    return;
  }

  initMockDb();
  const products = await getProducts({ includeInactive: true });
  const index = products.findIndex((product) => product.id === productId);
  if (index === -1) throw new Error("Product not found.");
  const nextStock = products[index].stock_quantity + quantityChanged;
  if (nextStock < 0) throw new Error("Stock cannot be negative.");
  products[index] = { ...products[index], stock_quantity: nextStock };
  localStorage.setItem("dlxstore_products", JSON.stringify(products));

  if (nextStock <= (products[index].low_stock_threshold ?? 3) && quantityChanged < 0) {
    await createNotification("usr-admin", "Alerte de stock bas", `${products[index].name} has only ${nextStock} units left.`, "low_stock");
  }

  const historyRaw = localStorage.getItem("dlxstore_inventory_history");
  const history = historyRaw ? JSON.parse(historyRaw) as InventoryHistoryEntry[] : [];
  history.unshift({ id: `inv-${crypto.randomUUID()}`, product_id: productId, product_name: products[index].name, quantity_changed: quantityChanged, type, notes, created_at: new Date().toISOString() });
  localStorage.setItem("dlxstore_inventory_history", JSON.stringify(history));
}

export async function getInventoryHistory(): Promise<InventoryHistoryEntry[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.from("inventory_history").select("*, products(name)").order("created_at", { ascending: false });
    if (error) throw error;
    return ((data ?? []) as Array<InventoryHistoryEntry & { products?: { name?: string } | null }>).map((entry) => ({ ...entry, product_name: entry.products?.name ?? "Unknown product" }));
  }

  initMockDb();
  const raw = localStorage.getItem("dlxstore_inventory_history");
  return raw ? JSON.parse(raw) as InventoryHistoryEntry[] : [];
}
