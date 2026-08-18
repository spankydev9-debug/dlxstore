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
};

export default nextConfig;
