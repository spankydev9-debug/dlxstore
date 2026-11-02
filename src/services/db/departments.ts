import { Category, FoodVendor, Product } from "../../types";
import { getCategories, getProducts } from "./products";
import { getFoodVendors } from "./food";
import { isSupabaseConfigured, supabase } from "./index";

/**
 * Departments (DLX Shop / Food / Energy / …) are data, not code.
 *
 * Everything a storefront needs — copy, theme, ordering, the blocks it renders,
 * its navigation and which products appear in it — is read from the database.
 * Adding a department is a row; adding a kind of block is a new `kind` value plus
 * one renderer case, never a new per-department component.
 */

export type DepartmentSectionKind =
  | "hero"
  | "product_grid"
  | "vendor_grid"
  | "category_grid"
  | "promo"
  | "text";

export interface Department {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  hero_image_url: string | null;
  accent_color: string | null;
  accent_from: string | null;
  accent_to: string | null;
  icon: string | null;
  sort_order: number;
  is_active: boolean;
  show_in_navigation: boolean;
  seo_title: string | null;
  seo_description: string | null;
  owner_vendor_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DepartmentSection {
  id: string;
  department_id: string;
  kind: DepartmentSectionKind;
  title: string | null;
  subtitle: string | null;
  body: string | null;
  config: DepartmentSectionConfig;
  sort_order: number;
  is_active: boolean;
}

/** Section settings the Control Center edits. All optional, all data. */
export interface DepartmentSectionConfig {
  /** Stable DOM id so `#anchor` navigation rows can point at a section. */
  anchor?: string;
  limit?: number;
  /** Where a product grid gets its items. */
  source?: "placements" | "featured" | "category";
  category_slug?: string;
  cta_label?: string;
  cta_href?: string;
  tone?: "emerald" | "amber" | "neutral" | "primary";
}

export interface DepartmentNavigationItem {
  id: string;
  department_id: string;
  label: string;
  href: string;
  sort_order: number;
  is_active: boolean;
}

/**
 * One product inside a `product_grid`, plus the department-specific badge an
 * admin gave it in `department_placements.label`. Keeping the label on the item
 * lets the same product read "Best-seller" in Energy and nothing in Shop.
 */
export interface DepartmentProductItem {
  product: Product;
  label: string | null;
}

export interface DepartmentPlacement {
  department_id: string;
  product_id: string;
  is_primary: boolean;
  is_featured: boolean;
  sort_order: number;
  label: string | null;
  is_active: boolean;
  product: Product | null;
}

/**
 * Everything needed to render one storefront, resolved server-side so the page
 * ships real HTML (SEO + no loading spinner) and the renderer stays dumb.
 */
export interface DepartmentStorefront {
  department: Department;
  sections: DepartmentSection[];
  navigation: DepartmentNavigationItem[];
  placements: DepartmentPlacement[];
  /**
   * Products already resolved for each `product_grid` section, keyed by section
   * id. Resolving `source` rules here (not in the renderer) is what keeps the
   * renderer free of per-department logic.
   */
  sectionProducts: Record<string, DepartmentProductItem[]>;
  categories: Category[];
  vendors: FoodVendor[];
  /** Other departments the visitor can jump to, ordered for display. */
  otherDepartments: Department[];
}

function isTableMissing(error: unknown): boolean {
  const err =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : String(error ?? "");
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";
  return (
    err === "PGRST205" ||
    err === "42P01" ||
    /Could not find the table/i.test(message) ||
    /relation .* does not exist/i.test(message)
  );
}

/**
 * Departments in display order.
 *
 * `includeInactive` is what the Admin Control Center will use to list drafts and
 * disabled departments; RLS already returns them only to staff/admins, so a
 * customer asking for them still gets the active set.
 */
export async function getDepartments(
  options: { includeInactive?: boolean } = {}
): Promise<Department[]> {
  if (!isSupabaseConfigured || !supabase) return [];

  let query = supabase
    .from("departments")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (!options.includeInactive) query = query.eq("is_active", true);

  const { data, error } = await query;
  if (error) {
    // The storefront must not break before the migration is approved in production.
    if (isTableMissing(error)) return [];
    throw new Error(error.message || "Unable to load departments.");
  }
  return (data ?? []) as Department[];
}

export async function getDepartmentBySlug(
  slug: string,
  options: { includeInactive?: boolean } = {}
): Promise<Department | null> {
  if (!isSupabaseConfigured || !supabase) return null;

  let query = supabase.from("departments").select("*").eq("slug", slug);
  if (!options.includeInactive) query = query.eq("is_active", true);

  const { data, error } = await query.maybeSingle();
  if (error) {
    if (isTableMissing(error)) return null;
    throw new Error(error.message || "Unable to load this department.");
  }
  return (data as Department | null) ?? null;
}

export async function getDepartmentSections(
  departmentId: string
): Promise<DepartmentSection[]> {
  if (!isSupabaseConfigured || !supabase) return [];

  const { data, error } = await supabase
    .from("department_sections")
    .select("*")
    .eq("department_id", departmentId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) {
    if (isTableMissing(error)) return [];
    throw new Error(error.message || "Unable to load this department.");
  }
  return ((data ?? []) as DepartmentSection[]).map((section) => ({
    ...section,
    config: (section.config ?? {}) as DepartmentSectionConfig,
  }));
}

export async function getDepartmentNavigation(
  departmentId: string
): Promise<DepartmentNavigationItem[]> {
  if (!isSupabaseConfigured || !supabase) return [];

  const { data, error } = await supabase
    .from("department_navigation")
    .select("id, department_id, label, href, sort_order, is_active")
    .eq("department_id", departmentId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) {
    if (isTableMissing(error)) return [];
    throw new Error(error.message || "Unable to load this department.");
  }
  return (data ?? []) as DepartmentNavigationItem[];
}

/**
 * Products placed in a department.
 *
 * The product row is fetched once and reused — a product placed in three
 * departments is three placement rows pointing at one product, never three
 * copies.
 */
export async function getDepartmentPlacements(
  departmentId: string
): Promise<DepartmentPlacement[]> {
  if (!isSupabaseConfigured || !supabase) return [];

  const { data, error } = await supabase
    .from("department_placements")
    .select(
      "department_id, product_id, is_primary, is_featured, sort_order, label, is_active"
    )
    .eq("department_id", departmentId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) {
    if (isTableMissing(error)) return [];
    throw new Error(error.message || "Unable to load this department.");
  }

  const placements = (data ?? []) as Omit<DepartmentPlacement, "product">[];
  if (placements.length === 0) return [];

  const products = await getProducts();
  const byId = new Map(products.map((product) => [product.id, product]));
  return placements.map((placement) => ({
    ...placement,
    product: byId.get(placement.product_id) ?? null,
  }));
}

/**
 * Which products a `product_grid` section should show.
 *
 * The three sources are the whole contract the Control Center can choose from:
 *   placements — what an admin placed in *this* department (ordered, badged)
 *   featured   — the catalogue's featured items (a curated fallback)
 *   category   — everything in one category, for departments that are really a
 *                category shelf
 *
 * Resolving here rather than in the renderer is what keeps the renderer generic.
 */
function resolveSectionProducts(
  section: DepartmentSection,
  context: {
    placements: DepartmentPlacement[];
    catalogue: Product[];
    categories: Category[];
  }
): DepartmentProductItem[] {
  const limit =
    typeof section.config.limit === "number" && section.config.limit > 0
      ? section.config.limit
      : 8;

  const source = section.config.source ?? "placements";

  if (source === "placements") {
    return context.placements
      .filter((placement): placement is DepartmentPlacement & { product: Product } =>
        Boolean(placement.product)
      )
      .slice(0, limit)
      .map((placement) => ({ product: placement.product, label: placement.label }));
  }

  if (source === "category") {
    const slug = section.config.category_slug;
    if (!slug) return [];
    const category = context.categories.find((item) => item.slug === slug);
    if (!category) return [];
    return context.catalogue
      .filter((product) => product.category_id === category.id)
      .slice(0, limit)
      .map((product) => ({ product, label: null }));
  }

  return context.catalogue
    .filter((product) => product.is_featured)
    .slice(0, limit)
    .map((product) => ({ product, label: null }));
}

/**
 * Resolve a storefront in one pass. Every department goes through this exact
 * path — there is no per-slug branch anywhere.
 */
export async function getDepartmentStorefront(
  slug: string
): Promise<DepartmentStorefront | null> {
  const department = await getDepartmentBySlug(slug);
  if (!department) return null;

  const [sections, navigation, placements, categories, allDepartments] = await Promise.all([
    getDepartmentSections(department.id),
    getDepartmentNavigation(department.id),
    getDepartmentPlacements(department.id),
    getCategories(),
    getDepartments(),
  ]);

  const productSections = sections.filter(
    (section) => section.kind === "product_grid"
  );
  const wantsCatalogue = productSections.some(
    (section) => (section.config.source ?? "placements") !== "placements"
  );
  const wantsVendors = sections.some((section) => section.kind === "vendor_grid");

  // One catalogue read serves every product grid, whatever the source.
  const [catalogue, vendors] = await Promise.all([
    wantsCatalogue ? getProducts() : Promise.resolve<Product[]>([]),
    wantsVendors ? getFoodVendors() : Promise.resolve<FoodVendor[]>([]),
  ]);

  const sectionProducts: Record<string, DepartmentProductItem[]> = {};
  for (const section of productSections) {
    sectionProducts[section.id] = resolveSectionProducts(section, {
      placements,
      catalogue,
      categories,
    });
  }

  return {
    department,
    sections,
    navigation,
    placements,
    sectionProducts,
    categories,
    vendors,
    otherDepartments: allDepartments.filter(
      (other) => other.show_in_navigation && other.slug !== department.slug
    ),
  };
}

/**
 * Public departments for the site navigation. The header can therefore follow
 * what an admin enables instead of a hardcoded list.
 */
export async function getNavigationDepartments(): Promise<Department[]> {
  const departments = await getDepartments();
  return departments.filter((department) => department.show_in_navigation);
}
