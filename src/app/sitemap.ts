import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/site";
import { getProducts } from "../services/db/products";
import { getPartnerShops } from "../services/db/partner-shops";

const STATIC_PATHS = [
  { path: "", priority: 1, changeFrequency: "weekly" as const },
  { path: "/shop", priority: 0.8, changeFrequency: "daily" as const },
  { path: "/food", priority: 0.7, changeFrequency: "daily" as const },
  { path: "/partners", priority: 0.7, changeFrequency: "weekly" as const },
  { path: "/about", priority: 0.5, changeFrequency: "monthly" as const },
  { path: "/contact", priority: 0.5, changeFrequency: "monthly" as const },
  { path: "/partner", priority: 0.5, changeFrequency: "monthly" as const },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = STATIC_PATHS.map(({ path, priority, changeFrequency }) => ({
    url: `${SITE_URL}${path}`,
    lastModified: new Date(),
    changeFrequency,
    priority,
  }));

  // Dynamic public URLs from the real data source (best effort; never fail the sitemap).
  try {
    const [products, shops] = await Promise.all([getProducts(), getPartnerShops()]);
    for (const product of products) {
      entries.push({
        url: `${SITE_URL}/product/${product.slug}`,
        lastModified: new Date(product.created_at ?? Date.now()),
        changeFrequency: "weekly",
        priority: 0.7,
      });
    }
    for (const shop of shops) {
      entries.push({
        url: `${SITE_URL}/partners/${shop.slug}`,
        lastModified: new Date(shop.created_at ?? Date.now()),
        changeFrequency: "weekly",
        priority: 0.6,
      });
    }
  } catch (error) {
    console.error("Sitemap dynamic data unavailable:", error);
  }

  return entries;
}
