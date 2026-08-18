const PLACEHOLDER = "/globe.svg";
const SUPABASE_PUBLIC_IMAGE_PATH = "/storage/v1/object/public/product-images/";

/** Returns a safe image URL for rendering, with placeholder fallback. */
export function resolveProductImageUrl(url?: string | null): string {
  if (!url || !url.trim()) return PLACEHOLDER;
  const candidate = url.trim();
  if (candidate.startsWith("/")) return candidate;

  try {
    const parsed = new URL(candidate);
    const isUnsplash = parsed.protocol === "https:" && parsed.hostname === "images.unsplash.com";
    const isPublicSupabaseImage = parsed.protocol === "https:"
      && parsed.hostname.endsWith(".supabase.co")
      && parsed.pathname.startsWith(SUPABASE_PUBLIC_IMAGE_PATH);
    return isUnsplash || isPublicSupabaseImage ? candidate : PLACEHOLDER;
  } catch {
    return PLACEHOLDER;
  }
}

/** Whether the URL host is allowed for next/image optimization. */
export function isOptimizableImageUrl(url: string): boolean {
  return resolveProductImageUrl(url) === url;
}

export function getProductImageFallback(): string {
  return PLACEHOLDER;
}
