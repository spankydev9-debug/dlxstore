import type { Metadata } from "next";
import { getPartnerShopBySlug } from "../../../services/db/partner-shops";
import { absoluteUrl } from "../../../lib/site";
import { translate } from "../../../lib/i18n";
import { getRequestLocale } from "../../../lib/locale-server";
import PartnerShopPage from "./PartnerShopPage";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  try {
    const shop = await getPartnerShopBySlug(slug);
    if (shop && shop.status === "active") {
      // `display_name` first: the public view carries COALESCE(shop_name,
      // business_name) and no `shop_name` column, so reading `shop_name` here
      // always returned undefined and silently published the legal name instead.
      const displayName = shop.display_name?.trim() || shop.business_name;
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
  const { slug } = await params;

  // Breadcrumbs are emitted on the server so they are in the HTML a crawler
  // receives without running JavaScript — `PartnerShopPage` is `"use client"`,
  // so a breadcrumb rendered there would only appear after hydration. The shop
  // is already loaded by `generateMetadata`, so this adds no extra fetch.
  let breadcrumbJsonLd: Record<string, unknown> | null = null;
  try {
    // Breadcrumb labels follow the customer's chosen locale (mirror cookie); the
    // shop name is locale-independent data.
    const t = translate(await getRequestLocale());
    const shop = await getPartnerShopBySlug(slug);
    if (shop && shop.status === "active") {
      const displayName = shop.display_name?.trim() || shop.business_name;
      breadcrumbJsonLd = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: t.home, item: absoluteUrl("/") },
          { "@type": "ListItem", position: 2, name: t.shops, item: absoluteUrl("/partners") },
          { "@type": "ListItem", position: 3, name: displayName, item: absoluteUrl(`/partners/${shop.slug}`) },
        ],
      };
    }
  } catch (error) {
    console.error("partner breadcrumbJsonLd error:", error);
  }

  return (
    <>
      {breadcrumbJsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
        />
      ) : null}
      <PartnerShopPage />
    </>
  );
}