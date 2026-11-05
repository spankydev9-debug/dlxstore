import type { Language } from "./i18n";
import { translate } from "./i18n";
import type { Department } from "../services/db/departments";

/** Generic labels the storefront renderer accepts, translated per request. */
export interface DepartmentStorefrontLabels {
  other: string;
  empty: string;
  vendorCount: string;
  viewVendor: string;
}

/**
 * Small helpers shared by the department routes. They keep the rendered labels
 * and the department URLs in one place, so a new storefront route cannot drift
 * from `/d/<slug>`.
 */

/**
 * Where a department is served from.
 *
 * `/d/<slug>` is always available. A department can declare a friendlier URL
 * (`/food`, `/energy`) in `metadata.canonical_path` — that is content decided
 * by the Control Center, not a branch in the code.
 */
export function departmentHref(department: Department): string {
  const configured = department.metadata?.canonical_path;
  return typeof configured === "string" && configured.startsWith("/")
    ? configured
    : `/d/${department.slug}`;
}

/** The generic labels the storefront renderer needs, translated for `locale`. */
export function departmentStorefrontLabels(locale: Language): DepartmentStorefrontLabels {
  const t = translate(locale);
  return {
    other: t.departmentsOther,
    empty: t.departmentsEmpty,
    vendorCount: t.foodVendorsUnit,
    viewVendor: t.departmentsViewVendor,
  };
}
