import type { Metadata } from "next";
import { getProductBySlug } from "../../../services/db/products";
import { absoluteUrl } from "../../../lib/site";
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
  await params;
  const sp = await searchParams;
  const size = typeof sp.size === "string" && sp.size.length > 0 ? sp.size : undefined;
  const color = typeof sp.color === "string" && sp.color.length > 0 ? sp.color : undefined;
  return <ProductPage initialSize={size} initialColor={color} />;
}