import type { ImageLoaderProps } from "next/image";

/**
 * Custom image loader that bypasses Vercel's on-demand image optimizer.
 *
 * Production evidence (2026-10-12): every `/_next/image` request for a product
 * image answered **HTTP 402** with
 * `x-vercel-error: OPTIMIZED_IMAGE_REQUEST_PAYMENT_REQUIRED` once the Hobby
 * plan's monthly optimization quota was exhausted. The optimizer's 402 reached
 * the browser as an `<img>` error, so `ProductImage` rendered its
 * "Image unavailable" fallback on cover and gallery images alike.
 *
 * DLXSTORE cannot enable a paid image plan, so the optimizer is removed from the
 * path entirely: Supabase Storage already serves the original (and already
 * web-sized) product images with public cache headers, and Unsplash exposes a
 * free, URL-based transform. Local assets are returned untouched.
 */
export default function dlxImageLoader({ src, width, quality }: ImageLoaderProps): string {
  const q = quality ?? 75;

  // Local/static assets: nothing to rewrite, and no external service involved.
  if (src.startsWith("/")) return src;

  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return src;
  }

  if (url.hostname === "images.unsplash.com") {
    url.searchParams.set("auto", "format");
    url.searchParams.set("fit", "crop");
    url.searchParams.set("w", String(width));
    url.searchParams.set("q", String(q));
    return url.toString();
  }

  // Supabase Storage (public product media). Free-tier image *transformations*
  // are a separate paid add-on, so the original object is served as-is; the
  // stored files are already sized for the storefront.
  return src;
}
