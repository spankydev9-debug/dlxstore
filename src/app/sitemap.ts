import type { MetadataRoute } from "next";
import { getCategories, getProducts } from "../services/db/products";
import { getSiteUrl } from "../lib/site-url";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getSiteUrl();
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: base, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${base}/shop`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/contact`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/partner`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
    { url: `${base}/food`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
  ];

  try {
    const [categories, products] = await Promise.all([getCategories(), getProducts()]);
    const categoryRoutes = categories.map((category) => ({
      url: `${base}/shop?category=${encodeURIComponent(category.slug)}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    }));
    const productRoutes = products
      .filter((product) => product.slug)
      .map((product) => ({
        url: `${base}/product/${product.slug}`,
        lastModified: product.created_at ? new Date(product.created_at) : now,
        changeFrequency: "weekly" as const,
        priority: 0.8,
      }));
    return [...staticRoutes, ...categoryRoutes, ...productRoutes];
  } catch {
    return staticRoutes;
  }
}
