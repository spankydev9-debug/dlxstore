import { supabase, isSupabaseConfigured, isDemoMode } from "./index";

const BUCKET = "product-images";
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function uploadProductImage(file: File): Promise<string> {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error("Only JPEG, PNG, and WebP product images are supported.");
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error("Product images must be 5 MB or smaller.");
  }

  if (!isSupabaseConfigured || !supabase) {
    if (!isDemoMode) throw new Error("Image upload requires Supabase Storage configuration.");
    return URL.createObjectURL(file);
  }

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `products/${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || undefined,
  });

  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  if (!data.publicUrl) throw new Error("Could not resolve uploaded image URL.");
  return data.publicUrl;
}

export async function removeProductImage(url: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const index = url.indexOf(marker);
  if (index === -1) return;
  const path = url.slice(index + marker.length);
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw new Error(error.message);
}
