import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Prefixes, not directories: `Disallow: /checkout/` never matched the real
      // route `/checkout`, so every private page below was still crawlable.
      disallow: ["/admin", "/dashboard", "/auth", "/checkout", "/cart", "/order-tracking"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
