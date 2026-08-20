import type { Metadata } from "next";
import type { Category, Product } from "../types";
import { resolveProductImageUrl } from "./product-image";
import { getSiteUrl } from "./site-url";

export function isPublicProduct(product: Product): boolean {
  return product.is_active !== false && product.is_archived !== true;
}

export function absoluteUrl(path: string): string {
  const base = getSiteUrl();
  if (!path || path === "/") return base;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function truncate(text: string, max = 160): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1).trimEnd()}…`;
}

export function productMetadata(product: Product): Metadata {
  const title = product.name;
  const description = truncate(
    product.description || `${product.name} disponible sur DLXSTORE à Goma, République démocratique du Congo.`
  );
  const canonical = `/product/${product.slug}`;
  const image = resolveProductImageUrl(product.images[0]);
  const imageUrl = image.startsWith("http") ? image : absoluteUrl(image);

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      type: "website",
      images: [{ url: imageUrl, alt: product.name }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
  };
}

export function categoryMetadata(category: Category): Metadata {
  const title = category.name;
  const description = truncate(
    category.description || `Produits ${category.name} sur DLXSTORE, marketplace à Goma (RDC).`
  );
  const canonical = `/shop?category=${encodeURIComponent(category.slug)}`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, type: "website" },
    twitter: { card: "summary", title, description },
  };
}

export function buildProductJsonLd(product: Product) {
  const image = resolveProductImageUrl(product.images[0]);
  const imageUrl = image.startsWith("http") ? image : absoluteUrl(image);
  const price = product.discount_price ?? product.price;

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description || product.name,
    sku: product.sku || undefined,
    brand: product.brand ? { "@type": "Brand", name: product.brand } : undefined,
    image: imageUrl,
    url: absoluteUrl(`/product/${product.slug}`),
    offers: {
      "@type": "Offer",
      url: absoluteUrl(`/product/${product.slug}`),
      priceCurrency: "USD",
      price: String(price),
      availability: product.stock_quantity > 0
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      itemCondition: "https://schema.org/NewCondition",
    },
  };
}

export function buildOrganizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "DLXSTORE",
    url: getSiteUrl(),
    description: "Marketplace numérique pour Goma et la République démocratique du Congo. Paiement à la livraison.",
    areaServed: { "@type": "City", name: "Goma" },
  };
}
