import { Category, Product, InventoryHistoryEntry } from "../../types";
import { supabase, isSupabaseConfigured, initMockDb } from "./index";
import { createNotification } from "./notifications";

export async function getCategories(): Promise<Category[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("categories")
      .select("*")
      .order("name", { ascending: true });
    
    if (error) throw error;
    return data || [];
  }

  // Local Storage Fallback
  initMockDb();
  const raw = localStorage.getItem("dlxstore_categories");
  return raw ? JSON.parse(raw) : [];
}

export async function getProducts(): Promise<Product[]> {
  if (isSupabaseConfigured && supabase) {
    // Select products and join images
    const { data: productsData, error: productsError } = await supabase
      .from("products")
      .select(`
        *,
        product_images (
          image_url,
          is_primary,
          display_order
        )
      `)
      .order("created_at", { ascending: false });

    if (productsError) throw productsError;

    return (productsData || []).map((p: any) => ({
      ...p,
      images: p.product_images
        ? p.product_images
            .sort((a: any, b: any) => a.display_order - b.display_order)
            .map((img: any) => img.image_url)
        : []
    }));
  }

  // Local Storage Fallback
  initMockDb();
  const raw = localStorage.getItem("dlxstore_products");
  return raw ? JSON.parse(raw) : [];
}

export async function getProductBySlug(slug: string): Promise<Product | null> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("products")
      .select(`
        *,
        product_images (
          image_url,
          is_primary,
          display_order
        )
      `)
      .eq("slug", slug)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null; // Not found
      throw error;
    }

    if (!data) return null;

    return {
      ...data,
      images: data.product_images
        ? data.product_images
            .sort((a: any, b: any) => a.display_order - b.display_order)
            .map((img: any) => img.image_url)
        : []
    };
  }

  // Local Storage Fallback
  const products = await getProducts();
  return products.find(p => p.slug === slug) || null;
}

export async function getProductById(id: string): Promise<Product | null> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("products")
      .select(`
        *,
        product_images (
          image_url,
          is_primary,
          display_order
        )
      `)
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null;
      throw error;
    }
    if (!data) return null;

    return {
      ...data,
      images: data.product_images
        ? data.product_images
            .sort((a: any, b: any) => a.display_order - b.display_order)
            .map((img: any) => img.image_url)
        : []
    };
  }

  const products = await getProducts();
  return products.find(p => p.id === id) || null;
}

export async function createProduct(productData: Omit<Product, "id" | "created_at">): Promise<Product> {
  if (isSupabaseConfigured && supabase) {
    // 1. Insert product
    const { images, ...productFields } = productData as any;
    const { data, error } = await supabase
      .from("products")
      .insert([productFields])
      .select()
      .single();

    if (error) throw error;

    // 2. Insert product images
    if (images && images.length > 0) {
      const imgInserts = images.map((url: string, index: number) => ({
        product_id: data.id,
        image_url: url,
        is_primary: index === 0,
        display_order: index
      }));
      const { error: imgError } = await supabase.from("product_images").insert(imgInserts);
      if (imgError) throw imgError;
    }

    return { ...data, images: images || [] };
  }

  // Local Storage Fallback
  initMockDb();
  const products = await getProducts();
  const newProduct: Product = {
    ...productData,
    id: `prod-${Math.random().toString(36).substr(2, 9)}`,
    created_at: new Date().toISOString()
  };
  products.unshift(newProduct);
  localStorage.setItem("dlxstore_products", JSON.stringify(products));

  // Log inventory adjustment
  await adjustInventory(newProduct.id, newProduct.stock_quantity, "restock", "Création initiale du produit");

  return newProduct;
}

export async function updateProduct(id: string, productFields: Partial<Product>): Promise<Product> {
  if (isSupabaseConfigured && supabase) {
    const { images, ...fields } = productFields as any;
    const { data, error } = await supabase
      .from("products")
      .update(fields)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    // If images are provided, update them (for simplicity, delete and recreate)
    if (images) {
      await supabase.from("product_images").delete().eq("product_id", id);
      const imgInserts = images.map((url: string, index: number) => ({
        product_id: id,
        image_url: url,
        is_primary: index === 0,
        display_order: index
      }));
      await supabase.from("product_images").insert(imgInserts);
    }

    return { ...data, images: images || productFields.images || [] };
  }

  // Local Storage Fallback
  const products = await getProducts();
  const index = products.findIndex(p => p.id === id);
  if (index === -1) throw new Error("Product not found");

  const originalStock = products[index].stock_quantity;
  const updatedProduct = {
    ...products[index],
    ...productFields
  };

  products[index] = updatedProduct;
  localStorage.setItem("dlxstore_products", JSON.stringify(products));

  // Log stock adjustments if modified
  if (productFields.stock_quantity !== undefined && productFields.stock_quantity !== originalStock) {
    const diff = productFields.stock_quantity - originalStock;
    await adjustInventory(id, diff, "manual_adjustment", `Ajustement manuel du stock (ancien: ${originalStock}, nouveau: ${productFields.stock_quantity})`);
  }

  return updatedProduct;
}

export async function deleteProduct(id: string): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) throw error;
    return;
  }

  // Local Storage Fallback
  const products = await getProducts();
  const filtered = products.filter(p => p.id !== id);
  localStorage.setItem("dlxstore_products", JSON.stringify(filtered));
}

export async function adjustInventory(
  productId: string,
  quantityChanged: number,
  type: "sale" | "restock" | "manual_adjustment",
  notes?: string
): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    // This is handled by a PostgreSQL database trigger in live schema (schema.sql), 
    // but we can log history entries explicitly if desired or update stock.
    const { error: updateError } = await supabase.rpc("adjust_stock", {
      p_id: productId,
      qty: quantityChanged
    });

    // Or do manual updates if rpc not setup yet
    const { data: prod } = await supabase.from("products").select("stock_quantity").eq("id", productId).single();
    if (prod) {
      await supabase.from("products").update({ stock_quantity: prod.stock_quantity + quantityChanged }).eq("id", productId);
    }

    await supabase.from("inventory_history").insert({
      product_id: productId,
      quantity_changed: quantityChanged,
      type,
      notes
    });
    return;
  }

  // Local Storage Fallback
  initMockDb();
  
  // 1. Update product stock
  const products = await getProducts();
  const prodIdx = products.findIndex(p => p.id === productId);
  if (prodIdx !== -1) {
    products[prodIdx].stock_quantity = Math.max(0, products[prodIdx].stock_quantity + quantityChanged);
    localStorage.setItem("dlxstore_products", JSON.stringify(products));
    
    // Check for low stock alerts
    if (products[prodIdx].stock_quantity <= 3 && quantityChanged < 0) {
      await createNotification(
        "usr-admin",
        "Alerte de Stock Bas ⚠️",
        `Le produit '${products[prodIdx].name}' n'a plus que ${products[prodIdx].stock_quantity} unités en stock. Réapprovisionnez au plus vite.`,
        "low_stock"
      );
    }
  }

  // 2. Add history entry
  const historyRaw = localStorage.getItem("dlxstore_inventory_history");
  const history: InventoryHistoryEntry[] = historyRaw ? JSON.parse(historyRaw) : [];
  
  const product = products.find(p => p.id === productId);
  
  const newEntry: InventoryHistoryEntry = {
    id: `inv-${Math.random().toString(36).substr(2, 9)}`,
    product_id: productId,
    product_name: product ? product.name : "Produit Inconnu",
    quantity_changed: quantityChanged,
    type,
    notes,
    created_at: new Date().toISOString()
  };
  
  history.unshift(newEntry);
  localStorage.setItem("dlxstore_inventory_history", JSON.stringify(history));
}

export async function getInventoryHistory(): Promise<InventoryHistoryEntry[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("inventory_history")
      .select(`
        *,
        products (
          name
        )
      `)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return (data || []).map((h: any) => ({
      ...h,
      product_name: h.products ? h.products.name : "Produit Inconnu"
    }));
  }

  // Local Storage Fallback
  initMockDb();
  const raw = localStorage.getItem("dlxstore_inventory_history");
  return raw ? JSON.parse(raw) : [];
}
