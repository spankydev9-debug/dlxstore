import { Product } from "../../types";
import { supabase, isSupabaseConfigured } from "./index";
import { getProducts } from "./products";

export async function getWishlist(userId: string): Promise<Product[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("wishlist")
      .select(`
        product_id,
        products (
          *,
          product_images (
            image_url,
            is_primary,
            display_order
          )
        )
      `)
      .eq("user_id", userId);

    if (error) throw error;
    
    return (data || []).map((w: any) => {
      const p = w.products;
      return {
        ...p,
        images: p.product_images
          ? p.product_images
              .sort((a: any, b: any) => a.display_order - b.display_order)
              .map((img: any) => img.image_url)
          : []
      };
    });
  }

  // Local Storage Fallback
  const key = `dlxstore_wishlist_${userId}`;
  const raw = localStorage.getItem(key);
  const ids: string[] = raw ? JSON.parse(raw) : [];
  
  const allProducts = await getProducts();
  return allProducts.filter(p => ids.includes(p.id));
}

export async function addToWishlist(userId: string, productId: string): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase
      .from("wishlist")
      .upsert([{ user_id: userId, product_id: productId }], { onConflict: "user_id, product_id", ignoreDuplicates: true });
    
    if (error) throw error;
    return;
  }

  // Local Storage Fallback
  const key = `dlxstore_wishlist_${userId}`;
  const raw = localStorage.getItem(key);
  const ids: string[] = raw ? JSON.parse(raw) : [];
  
  if (!ids.includes(productId)) {
    ids.push(productId);
    localStorage.setItem(key, JSON.stringify(ids));
  }
}

export async function removeFromWishlist(userId: string, productId: string): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase
      .from("wishlist")
      .delete()
      .eq("user_id", userId)
      .eq("product_id", productId);

    if (error) throw error;
    return;
  }

  // Local Storage Fallback
  const key = `dlxstore_wishlist_${userId}`;
  const raw = localStorage.getItem(key);
  if (raw) {
    let ids: string[] = JSON.parse(raw);
    ids = ids.filter(id => id !== productId);
    localStorage.setItem(key, JSON.stringify(ids));
  }
}

export async function isInWishlist(userId: string, productId: string): Promise<boolean> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("wishlist")
      .select("id")
      .eq("user_id", userId)
      .eq("product_id", productId)
      .maybeSingle();

    if (error) throw error;
    return !!data;
  }

  // Local Storage Fallback
  const key = `dlxstore_wishlist_${userId}`;
  const raw = localStorage.getItem(key);
  if (!raw) return false;
  const ids: string[] = JSON.parse(raw);
  return ids.includes(productId);
}
