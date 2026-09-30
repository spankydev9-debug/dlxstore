import { supabase, isSupabaseConfigured, isDemoMode } from "./index";

const BUCKET = "product-images";
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_UPLOAD_DIMENSION = 2560;

async function loadBrowserImage(file: File): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("The image could not be processed."));
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Downscales oversized browser uploads before they leave the device. It preserves
 * the original file when no resize is needed or a canvas result would be larger.
 */
async function optimizeProductImageForUpload(file: File): Promise<File> {
  if (typeof window === "undefined") return file;

  let image: HTMLImageElement;
  try {
    image = await loadBrowserImage(file);
  } catch {
    return file;
  }

  const scale = Math.min(1, MAX_UPLOAD_DIMENSION / image.naturalWidth, MAX_UPLOAD_DIMENSION / image.naturalHeight);
  if (scale === 1) return file;

  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return file;
  context.drawImage(image, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, file.type, file.type === "image/png" ? undefined : 0.88);
  });
  if (!blob || blob.size >= file.size) return file;

  return new File([blob], file.name, { type: file.type, lastModified: file.lastModified });
}

export async function uploadProductImage(file: File): Promise<string> {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error("Only JPEG, PNG, and WebP product images are supported.");
  }
  const optimizedFile = await optimizeProductImageForUpload(file);
  if (optimizedFile.size > MAX_FILE_SIZE_BYTES) {
    throw new Error("Product images must be 5 MB or smaller.");
  }

  if (!isSupabaseConfigured || !supabase) {
    if (!isDemoMode) throw new Error("Image upload requires Supabase Storage configuration.");
    return URL.createObjectURL(optimizedFile);
  }

  const ext = optimizedFile.type === "image/png" ? "png" : optimizedFile.type === "image/webp" ? "webp" : "jpg";
  const path = `products/${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, optimizedFile, {
    cacheControl: "3600",
    upsert: false,
    contentType: optimizedFile.type || undefined,
  });

  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  if (!data.publicUrl) throw new Error("Could not resolve uploaded image URL.");
  return data.publicUrl;
}

/** Extracts the storage object path for a DLX-owned product image URL, or null for external/unknown URLs. */
export function getStorageObjectPathFromUrl(url: string): string | null {
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const index = url.indexOf(marker);
  if (index === -1) return null;
  const path = url.slice(index + marker.length).split("?")[0];
  return path || null;
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
