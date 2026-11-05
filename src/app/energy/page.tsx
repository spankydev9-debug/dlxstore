import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { absoluteUrl } from "../../lib/site";
import { getRequestLocale } from "../../lib/locale-server";
import { departmentStorefrontLabels } from "../../lib/departments";
import { getDepartmentBySlug, getDepartmentStorefront } from "../../services/db/departments";
import DepartmentStorefront from "../../components/departments/DepartmentStorefront";

/**
 * `/energy` is a Friendly URL for the `energy` department, using the same
 * generic renderer as `/d/energy`. There is no Energy-specific component: the
 * hero copy, sections, navigation and products all come from the database.
 *
 * Until the department exists this is a real 404 rather than a fabricated page.
 */

export async function generateMetadata(): Promise<Metadata> {
  const department = await getDepartmentBySlug("energy");
  const canonical = "/energy";

  if (!department) {
    return { title: "DLX Energy | DLXSTORE", alternates: { canonical: absoluteUrl(canonical) } };
  }

  const title = department.seo_title ?? `${department.name} | DLXSTORE`;
  const description =
    department.seo_description ?? department.description ?? department.tagline ?? "";

  return {
    // Absolute, like the other two department routes: `seo_title` is the full
    // title the admin wrote, and the root layout template would append
    // "| DLXSTORE" to it a second time.
    title: { absolute: title },
    description,
    alternates: { canonical: absoluteUrl(canonical) },
    openGraph: { title, description, url: absoluteUrl(canonical) },
  };
}

export default async function EnergyRoute() {
  const locale = await getRequestLocale();
  const storefront = await getDepartmentStorefront("energy");
  if (!storefront) notFound();

  return (
    <DepartmentStorefront
      storefront={storefront}
      labels={departmentStorefrontLabels(locale)}
    />
  );
}
