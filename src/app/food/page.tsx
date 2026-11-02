import type { Metadata } from "next";
import { absoluteUrl } from "../../lib/site";
import { getRequestLocale } from "../../lib/locale-server";
import { departmentStorefrontLabels } from "../../lib/departments";
import { getDepartmentBySlug, getDepartmentStorefront } from "../../services/db/departments";
import DepartmentStorefront from "../../components/departments/DepartmentStorefront";
import FoodPage from "./FoodPage";

/**
 * `/food` is a Friendly URL for the `food` department.
 *
 * It renders the same generic storefront as `/d/food` — the only thing that is
 * Food-specific here is the legacy fallback below, which keeps the current
 * experience working until the department row exists (production is still
 * pre-migration). Once an admin creates the `food` department, the fallback is
 * unreachable and this page is pure department data.
 */

export async function generateMetadata(): Promise<Metadata> {
  const department = await getDepartmentBySlug("food");

  if (department) {
    const canonical = "/food";
    const title = department.seo_title ?? `${department.name} | DLXSTORE`;
    const description =
      department.seo_description ?? department.description ?? department.tagline ?? "";
    return {
      title,
      description,
      alternates: { canonical: absoluteUrl(canonical) },
      openGraph: { title, description, url: absoluteUrl(canonical) },
    };
  }

  return {
    title: "DLX Food",
    description:
      "Restaurants et fast-foods disponibles sur le marketplace DLX à Goma. Livraison gratuite et paiement à la livraison.",
    alternates: { canonical: absoluteUrl("/food") },
    openGraph: {
      title: "DLX Food | DLXSTORE",
      description: "Restaurants et fast-foods à Goma — livraison gratuite, paiement à la livraison.",
      url: absoluteUrl("/food"),
    },
  };
}

export default async function FoodRoute() {
  const locale = await getRequestLocale();
  const storefront = await getDepartmentStorefront("food");

  if (!storefront) return <FoodPage />;

  return (
    <DepartmentStorefront
      storefront={storefront}
      labels={departmentStorefrontLabels(locale)}
    />
  );
}
