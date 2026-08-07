import { Review } from "../../types";
import { supabase, isSupabaseConfigured, initMockDb } from "./index";

export async function getProductReviews(productId: string): Promise<Review[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("reviews")
      .select(`
        *,
        profiles (
          full_name
        )
      `)
      .eq("product_id", productId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    
    return (data || []).map((r: any) => ({
      ...r,
      user_name: r.profiles ? r.profiles.full_name : "Anonyme"
    }));
  }

  // Local Storage Fallback
  initMockDb();
  const raw = localStorage.getItem("dlxstore_reviews");
  const reviews: Review[] = raw ? JSON.parse(raw) : [];
  return reviews.filter(r => r.product_id === productId);
}

export async function addReview(
  productId: string,
  userId: string,
  userName: string,
  rating: number,
  comment?: string
): Promise<Review> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("reviews")
      .insert([{ product_id: productId, user_id: userId, rating, comment }])
      .select()
      .single();

    if (error) throw error;
    
    // update rating on product in live database
    const { data: reviews } = await supabase.from("reviews").select("rating").eq("product_id", productId);
    if (reviews && reviews.length > 0) {
      const avg = reviews.reduce((acc, curr) => acc + curr.rating, 0) / reviews.length;
      await supabase.from("products").update({ rating: parseFloat(avg.toFixed(1)) }).eq("id", productId);
    }

    return {
      ...data,
      user_name: userName
    };
  }

  // Local Storage Fallback
  initMockDb();
  const raw = localStorage.getItem("dlxstore_reviews");
  const reviews: Review[] = raw ? JSON.parse(raw) : [];

  const newReview: Review = {
    id: `rev-${Math.random().toString(36).substr(2, 9)}`,
    product_id: productId,
    user_id: userId,
    user_name: userName,
    rating,
    comment,
    created_at: new Date().toISOString()
  };

  reviews.unshift(newReview);
  localStorage.setItem("dlxstore_reviews", JSON.stringify(reviews));

  // Update product average rating
  const prodRaw = localStorage.getItem("dlxstore_products");
  if (prodRaw) {
    const products = JSON.parse(prodRaw);
    const index = products.findIndex((p: any) => p.id === productId);
    if (index !== -1) {
      const prodReviews = reviews.filter(r => r.product_id === productId);
      const avg = prodReviews.reduce((sum, r) => sum + r.rating, 0) / prodReviews.length;
      products[index].rating = parseFloat(avg.toFixed(1));
      localStorage.setItem("dlxstore_products", JSON.stringify(products));
    }
  }

  return newReview;
}
