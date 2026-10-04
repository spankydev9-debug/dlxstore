import { ImageResponse } from "next/og";

export const runtime = "edge";

/**
 * The service worker hard-codes `/icons/icon-192x192.png` and
 * `/icons/badge-72x72.png` for push notifications, but no `public/icons/`
 * directory existed, so every notification rendered a broken image. Generating
 * them here keeps them in sync with `src/app/icon.tsx` instead of adding binary
 * assets that drift.
 *
 * The dynamic segment is `[file]`, not `[variant]`, so the `.png` extension stays
 * part of the match: an already-registered service worker requests these exact
 * paths and must keep resolving.
 */
function glyph(size: number, { maskable = false }: { maskable?: boolean } = {}) {
  // A maskable icon must keep its content inside the inner 80% safe zone, because
  // Android crops it to the device shape and anything near the edge is lost.
  const fontSize = Math.round(size * (maskable ? 0.3 : 0.34));
  const background = "#050505";
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background,
          padding: maskable ? Math.round(size * 0.1) : 0,
          color: "#d4af37",
          fontSize,
          fontWeight: 700,
          letterSpacing: -Math.round(fontSize * 0.07)
        }}
      >
        DLX
      </div>
    ),
    { width: size, height: size }
  );
}

const VARIANTS: Record<string, { size: number; maskable?: boolean }> = {
  "icon-192x192.png": { size: 192 },
  "icon-512x512.png": { size: 512 },
  "maskable-512x512.png": { size: 512, maskable: true },
  "badge-72x72.png": { size: 72 }
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> }
) {
  const { file } = await params;
  const variant = VARIANTS[file];
  if (!variant) return new Response("Not found", { status: 404 });
  const body = glyph(variant.size, { maskable: variant.maskable });
  return new Response(body.body, {
    headers: {
      "Content-Type": "image/png",
      // Content-addressed by name, so it is safe to cache hard at the edge.
      "Cache-Control": "public, max-age=31536000, immutable"
    }
  });
}
