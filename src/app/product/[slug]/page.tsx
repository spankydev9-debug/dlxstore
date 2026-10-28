import type { Metadata } from "next";
import { getProductBySlug } from "../../../services/db/products";
import { absoluteUrl } from "../../../lib/site";
import { translate } from "../../../lib/i18n";
import { getRequestLocale } from "../../../lib/locale-server";
import ProductPage from "./ProductPage";

type Props = {
  params: Promise<{ slug: string }>;
  // The Studio sends the customer back with the variant they were wearing, so
  // the route reads it here (server) and hands it to the client page as props —
  // no `useSearchParams` in the tree, no Suspense gap in the product HTML.
  searchParams: Promise<{ size?: string | string[]; color?: string | string[] }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  try {
    const product = await getProductBySlug(slug);
    if (product) {
      const images = product.images?.filter(Boolean) ?? [];
      return {
        title: product.name,
        description: product.description,
        alternates: { canonical: absoluteUrl(`/product/${product.slug}`) },
        openGraph: {
          title: product.name,
          description: product.description,
          url: absoluteUrl(`/product/${product.slug}`),
          images: images.length > 0 ? [images[0]] : undefined,
        },
      };
    }
  } catch (error) {
    console.error("generateMetadata product error:", error);
  }
  return {
    title: "Produit",
    description: "Article disponible sur DLXSTORE à Goma.",
    alternates: { canonical: absoluteUrl(`/product/${slug}`) },
  };
}

export default async function ProductRoute({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const size = typeof sp.size === "string" && sp.size.length > 0 ? sp.size : undefined;
  const color = typeof sp.color === "string" && sp.color.length > 0 ? sp.color : undefined;

  // Product + Breadcrumb structured data is emitted here, on the server, so it
  // is present in the HTML a crawler receives without executing JavaScript. The
  // client page is `"use client"`, so anything it rendered would only appear
  // after hydration. `getProductBySlug` is already used by `generateMetadata`
  // above, so this adds no new fetch. Only fields the catalogue actually holds
  // are emitted — no synthesized rating, no invented price validity.
  let productJsonLd: Record<string, unknown> | null = null;
  let breadcrumbJsonLd: Record<string, unknown> | null = null;
  try {
    // Breadcrumb labels follow the customer's chosen locale (mirror cookie);
    // catalogue fields (name/brand/price) are locale-independent data.
    const t = translate(await getRequestLocale());
    const product = await getProductBySlug(slug);
    if (product) {
      const finalPrice = product.discount_price ?? product.price;
      productJsonLd = {
        "@context": "https://schema.org",
        "@type": "Product",
        name: product.name,
        description: product.description,
        image: product.images?.filter(Boolean) ?? [],
        brand: { "@type": "Brand", name: product.brand },
        sku: product.sku,
        offers: {
          "@type": "Offer",
          url: absoluteUrl(`/product/${product.slug}`),
          priceCurrency: "USD",
          price: String(finalPrice),
          availability:
            product.stock_quantity > 0
              ? "https://schema.org/InStock"
              : "https://schema.org/OutOfStock",
        },
      };
      breadcrumbJsonLd = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: t.home, item: absoluteUrl("/") },
          { "@type": "ListItem", position: 2, name: t.shop, item: absoluteUrl("/shop") },
          {
            "@type": "ListItem",
            position: 3,
            name: product.name,
            item: absoluteUrl(`/product/${product.slug}`),
          },
        ],
      };
    }
  } catch (error) {
    console.error("productJsonLd error:", error);
  }

  return (
    <>
      {productJsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }}
        />
      ) : null}
      {breadcrumbJsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
        />
      ) : null}
      <ProductPage initialSize={size} initialColor={color} />
    </>
  );
}