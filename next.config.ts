import type { NextConfig } from "next";

function getSupabaseHost() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

const supabaseHost = getSupabaseHost();

const nextConfig: NextConfig = {
  images: {
    // Vercel's optimizer returns 402 (OPTIMIZED_IMAGE_REQUEST_PAYMENT_REQUIRED)
    // once the free-tier quota is exhausted, which broke product media. The
    // custom loader serves origin URLs (Supabase public storage / Unsplash /
    // local) so images no longer depend on that quota.
    loader: "custom",
    loaderFile: "./src/lib/image-loader.ts",
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/**",
      },
      ...(supabaseHost ? [{
        protocol: "https" as const,
        hostname: supabaseHost,
        pathname: "/storage/v1/object/public/product-images/**",
      }] : []),
    ],
  },
  async headers() {
    return [
      {
        // A service worker served from HTTP cache can never be replaced, which
        // silently strands users on an old version of the app shell.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
