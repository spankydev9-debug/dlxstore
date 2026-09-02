import type { Metadata } from "next";
import { getPartnerShopBySlug } from "../../../services/db/partner-shops";
import { absoluteUrl } from "../../../lib/site";
import PartnerShopPage from "./PartnerShopPage";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  try {
    const shop = await getPartnerShopBySlug(slug);
    if (shop && shop.status === "active") {
      const displayName = shop.shop_name?.trim() || shop.business_name;
      const displayDescription = shop.shop_description?.trim() || shop.description;
      const images = [shop.shop_image_url, shop.banner_image_url].filter(Boolean) as string[];
      return {
        title: displayName,
        description: displayDescription,
        alternates: { canonical: absoluteUrl(`/partners/${shop.slug}`) },
        openGraph: {
          title: displayName,
          description: displayDescription,
          url: absoluteUrl(`/partners/${shop.slug}`),
          images: images.length > 0 ? [images[0]] : undefined,
        },
      };
    }
  } catch (error) {
    console.error("generateMetadata partner shop error:", error);
  }
  return {
    title: "Boutique partenaire",
    description: "Boutique partenaire DLXSTORE à Goma.",
    alternates: { canonical: absoluteUrl(`/partners/${slug}`) },
  };
}

export default async function PartnerShopRoute({ params }: Props) {
  await params;
  return <PartnerShopPage />;
}