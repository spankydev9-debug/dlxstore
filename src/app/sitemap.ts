import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/site";
import { getProducts } from "../services/db/products";
import { getPartnerShops } from "../services/db/partner-shops";
import { getNavigationDepartments } from "../services/db/departments";
import { departmentHref } from "../lib/departments";

const STATIC_PATHS = [
  { path: "", priority: 1, changeFrequency: "weekly" as const },
  { path: "/shop", priority: 0.8, changeFrequency: "daily" as const },
  { path: "/discover", priority: 0.7, changeFrequency: "daily" as const },
  { path: "/food", priority: 0.7, changeFrequency: "daily" as const },
  { path: "/partners", priority: 0.7, changeFrequency: "weekly" as const },
  { path: "/about", priority: 0.5, changeFrequency: "monthly" as const },
  { path: "/contact", priority: 0.5, changeFrequency: "monthly" as const },
  { path: "/feedback", priority: 0.4, changeFrequency: "yearly" as const },
  { path: "/partner", priority: 0.5, changeFrequency: "monthly" as const },
];

/**
 * Cached for five minutes rather than until the next build: the URLs below come
 * from the database, and publishing a department, product or partner shop is a
 * Control Center action that must not require a deploy to become discoverable.
 * Long enough that a crawler never hits the database on every request, short
 * enough that new content appears without a release.
 */
export const revalidate = 300;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = STATIC_PATHS.map(({ path, priority, changeFrequency }) => ({
    url: `${SITE_URL}${path}`,
    lastModified: new Date(),
    changeFrequency,
    priority,
  }));

  // A department can serve a path that is also in STATIC_PATHS (`/food`,
  // `/shop`), and the sitemap must not list the same URL twice.
  const seen = new Set(entries.map((entry) => entry.url));

  // Dynamic public URLs from the real data source (best effort; never fail the sitemap).
  try {
    const [products, shops, departments] = await Promise.all([
      getProducts(),
      getPartnerShops(),
      getNavigationDepartments(),
    ]);
    // Departments are public storefronts: each is listed once at the address it
    // actually serves (its friendly URL when configured, `/d/<slug>` otherwise).
    for (const department of departments) {
      const url = `${SITE_URL}${departmentHref(department)}`;
      if (seen.has(url)) continue;
      seen.add(url);
      entries.push({
        url,
        lastModified: new Date(department.updated_at ?? Date.now()),
        changeFrequency: "weekly",
        priority: 0.8,
      });
    }
    for (const product of products) {
      const url = `${SITE_URL}/product/${product.slug}`;
      if (seen.has(url)) continue;
      seen.add(url);
      entries.push({
        url,
        lastModified: new Date(product.created_at ?? Date.now()),
        changeFrequency: "weekly",
        priority: 0.7,
      });
    }
    for (const shop of shops) {
      const url = `${SITE_URL}/partners/${shop.slug}`;
      if (seen.has(url)) continue;
      seen.add(url);
      entries.push({
        url,
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
