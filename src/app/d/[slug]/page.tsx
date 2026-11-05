import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getDepartmentBySlug,
  getDepartmentStorefront,
} from "../../../services/db/departments";
import { absoluteUrl } from "../../../lib/site";
import { getRequestLocale } from "../../../lib/locale-server";
import { departmentHref, departmentStorefrontLabels } from "../../../lib/departments";
import DepartmentStorefront from "../../../components/departments/DepartmentStorefront";

/**
 * Generic department route: `/d/<slug>`.
 *
 * Every department renders through the same data-driven page. Dedicated routes
 * (`/food`, `/energy`) are thin wrappers over the very same renderer, and a
 * department points at its canonical URL through `metadata.canonical_path`.
 *
 * When the row does not exist (e.g. production before the migration is
 * approved, or a slug an admin has not created yet) this is a real 404 — never
 * a fabricated empty storefront.
 */

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const department = await getDepartmentBySlug(slug);
  if (!department) {
    return { title: "DLXSTORE", robots: { index: false, follow: false } };
  }

  // `/d/food` and `/food` render the same storefront, so the friendly URL an
  // admin configured is the canonical one.
  const canonical = departmentHref(department);

  const title = department.seo_title ?? `${department.name} | DLXSTORE`;
  const description =
    department.seo_description ?? department.description ?? department.tagline ?? "";

  return {
    // Absolute for the same reason as the friendly route: `seo_title` already
    // carries the brand and the layout template would append it twice.
    title: { absolute: title },
    description,
    alternates: { canonical: absoluteUrl(canonical) },
    openGraph: {
      title,
      description,
      url: absoluteUrl(canonical),
      ...(department.hero_image_url ? { images: [{ url: department.hero_image_url }] } : {}),
    },
  };
}

export default async function DepartmentRoute({ params }: Props) {
  const { slug } = await params;
  // The locale read keeps this route dynamic, so an admin edit in the Control
  // Center appears on the next request instead of after a rebuild.
  const locale = await getRequestLocale();
  const storefront = await getDepartmentStorefront(slug);
  if (!storefront) notFound();

  return (
    <DepartmentStorefront
      storefront={storefront}
      labels={departmentStorefrontLabels(locale)}
    />
  );
}
