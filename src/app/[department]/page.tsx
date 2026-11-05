import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { absoluteUrl } from "../../lib/site";
import { getRequestLocale } from "../../lib/locale-server";
import { departmentHref, departmentStorefrontLabels } from "../../lib/departments";
import {
  getDepartmentStorefront,
  getDepartmentByCanonicalPath,
} from "../../services/db/departments";
import DepartmentStorefront from "../../components/departments/DepartmentStorefront";

/**
 * Friendly URLs for departments: `/<canonical_path>`.
 *
 * A department's address is content — `metadata.canonical_path` in its row — so
 * an admin can serve DLX Beauty at `/beauty` without anyone editing the route
 * tree. Dedicated static routes (`/shop`, `/food`, `/energy`, `/cart`, …) win
 * over this segment because Next resolves literal routes first, and anything
 * that is not a department's declared path is a real 404 rather than a
 * catch-all page.
 *
 * `/d/<slug>` remains the permanent, always-correct address for every
 * department and is used as the canonical URL when no friendly path is set.
 */

type Props = {
  params: Promise<{ department: string }>;
};

/**
 * Resolve a friendly path without ever throwing.
 *
 * This route matches every root segment that a literal route did not, so a
 * database hiccup must not turn an unknown URL into a 500: "no such page" is
 * the honest, cacheable answer, and a real department page is one reload away.
 */
async function resolveFriendly(segment: string) {
  try {
    return await getDepartmentByCanonicalPath(`/${segment}`);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { department: segment } = await params;
  const resolved = await resolveFriendly(segment);
  if (!resolved) {
    return { title: "DLXSTORE", robots: { index: false, follow: false } };
  }

  const canonical = departmentHref(resolved);
  // `seo_title` is the full title the admin wrote (the field even suggests
  // "DLX Beauté | DLXSTORE"), so it is used absolute: the root layout appends
  // "| DLXSTORE" to every plain title and would otherwise render the brand
  // twice.
  const title = resolved.seo_title ?? `${resolved.name} | DLXSTORE`;
  const description =
    resolved.seo_description ?? resolved.description ?? resolved.tagline ?? "";

  return {
    title: { absolute: title },
    description,
    alternates: { canonical: absoluteUrl(canonical) },
    openGraph: {
      title,
      description,
      url: absoluteUrl(canonical),
      ...(resolved.hero_image_url ? { images: [{ url: resolved.hero_image_url }] } : {}),
    },
  };
}

export default async function FriendlyDepartmentRoute({ params }: Props) {
  const { department: segment } = await params;
  const resolved = await resolveFriendly(segment);
  if (!resolved) notFound();

  const locale = await getRequestLocale();
  const storefront = await getDepartmentStorefront(resolved.slug);
  if (!storefront) notFound();

  return (
    <DepartmentStorefront
      storefront={storefront}
      labels={departmentStorefrontLabels(locale)}
    />
  );
}
