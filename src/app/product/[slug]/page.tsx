import type { Metadata } from "next";
import { getProductBySlug } from "../../../services/db/products";
import { absoluteUrl } from "../../../lib/site";
import ProductPage from "./ProductPage";

type Props = { params: Promise<{ slug: string }> };

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

export default async function ProductRoute({ params }: Props) {
  await params;
  return <ProductPage />;
}