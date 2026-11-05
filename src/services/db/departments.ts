import { Category, FoodVendor, PartnerShop, Product } from "../../types";
import { getCategories, getProducts } from "./products";
import { getFoodVendors } from "./food";
import { getPartnerShops } from "./partner-shops";
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
  /** Single category for a `category` grid. */
  category_slug?: string;
  /** Categories a `category_grid` shows, in order. Empty = every category. */
  category_slugs?: string[];
  /** Where a `vendor_grid` gets its cards. */
  vendor_source?: "curated" | "food" | "partners";
  cta_label?: string;
  cta_href?: string;
  tone?: "emerald" | "amber" | "neutral" | "primary";
  /** Optional layout hint for product grids: cards per row on desktop. */
  columns?: 2 | 3 | 4;
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
 * One vendor card inside a `vendor_grid`.
 *
 * The two vendor systems in DLX (partner shops in `vendors`, restaurants in
 * `food_vendors`) are projected into this one shape by the resolver, so the
 * renderer never needs to know which table a card came from — and the Control
 * Center can curate either without a second editor.
 */
export interface DepartmentVendor {
  id: string;
  kind: "partner" | "food";
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  city: string | null;
  province: string | null;
  /** Where a visitor goes to see this vendor. */
  href: string;
  rating: number | null;
  is_featured: boolean;
  is_24_7: boolean;
  /** Per-department badge ("Nouveau partenaire", …). */
  label: string | null;
  tags: string[];
  preparation_time_minutes: number | null;
  delivery_fee: number | null;
}

/** A curated vendor row, as stored in `department_vendors`. */
export interface DepartmentVendorRow {
  id: string;
  department_id: string;
  vendor_id: string | null;
  food_vendor_id: string | null;
  sort_order: number;
  is_featured: boolean;
  label: string | null;
  is_active: boolean;
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
  vendors: DepartmentVendor[];
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

/**
 * Resolve a department from the friendly URL an admin configured.
 *
 * `metadata.canonical_path` is content, so the mapping from `/beauty` to a
 * department has to come from the data. The list is small (one row per
 * storefront) and already filtered by RLS + `is_active`, so this scans it rather
 * than depending on a JSON-path operator the database may or may not expose
 * through PostgREST. Paths are compared normalised (leading slash, no trailing
 * slash) so `/beauty/` and `/beauty` are the same address.
 */
export async function getDepartmentByCanonicalPath(
  path: string
): Promise<Department | null> {
  const normalise = (value: string) => {
    const withSlash = value.startsWith("/") ? value : `/${value}`;
    return withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : withSlash;
  };
  const target = normalise(path);
  if (target === "/") return null;

  const departments = await getDepartments();
  return (
    departments.find((department) => {
      const configured = department.metadata?.canonical_path;
      return typeof configured === "string" && normalise(configured) === target;
    }) ?? null
  );
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
 * Curated vendor rows for a department, resolved into renderable cards.
 *
 * A `vendor_grid` with `config.vendor_source` set to `food` or `partners` skips
 * curation and uses the whole vendor table — useful before an admin has picked
 * favourites. The default (`curated`) is what the Control Center writes.
 */
export async function getDepartmentVendors(
  departmentId: string
): Promise<DepartmentVendorRow[]> {
  if (!isSupabaseConfigured || !supabase) return [];

  const { data, error } = await supabase
    .from("department_vendors")
    .select(
      "id, department_id, vendor_id, food_vendor_id, sort_order, is_featured, label, is_active"
    )
    .eq("department_id", departmentId)
    .order("sort_order", { ascending: true });

  if (error) {
    if (isTableMissing(error)) return [];
    throw new Error(error.message || "Unable to load this department's vendors.");
  }
  return (data ?? []) as DepartmentVendorRow[];
}

function toPartnerCard(vendor: PartnerShop, label: string | null, featured: boolean): DepartmentVendor {
  return {
    id: vendor.id,
    kind: "partner",
    name: vendor.display_name ?? vendor.shop_name ?? vendor.business_name,
    slug: vendor.slug,
    description: vendor.shop_description ?? vendor.description ?? null,
    image_url: vendor.shop_image_url ?? null,
    city: vendor.city ?? null,
    province: vendor.province ?? null,
    href: `/partners/${vendor.slug}`,
    rating: null,
    is_featured: vendor.is_featured || featured,
    is_24_7: false,
    label,
    tags: [],
    preparation_time_minutes: null,
    delivery_fee: null,
  };
}

function toFoodCard(vendor: FoodVendor, label: string | null, featured: boolean): DepartmentVendor {
  return {
    id: vendor.id,
    kind: "food",
    name: vendor.name,
    slug: vendor.slug,
    description: vendor.description ?? null,
    image_url: vendor.image_url ?? null,
    city: vendor.city ?? null,
    province: vendor.province ?? null,
    href: `/food#vendors`,
    rating: vendor.rating ?? null,
    is_featured: vendor.is_featured || featured,
    is_24_7: vendor.is_24_7,
    label,
    tags: vendor.food_categories ?? [],
    preparation_time_minutes: vendor.preparation_time_minutes ?? null,
    delivery_fee: vendor.delivery_fee ?? null,
  };
}

/**
 * Resolve a department's vendor cards.
 *
 * `curated` preserves the admin's order and per-department labels; the two
 * table-wide sources exist so a brand-new department is not empty before
 * curation, and both keep featuring as the first sort key.
 */
async function resolveDepartmentVendors(
  departmentId: string,
  sections: DepartmentSection[]
): Promise<DepartmentVendor[]> {
  const vendorSection = sections.find((section) => section.kind === "vendor_grid");
  if (!vendorSection) return [];

  const source = vendorSection.config.vendor_source ?? "curated";
  const limit =
    typeof vendorSection.config.limit === "number" && vendorSection.config.limit > 0
      ? vendorSection.config.limit
      : 12;

  if (source === "food") {
    const vendors = await getFoodVendors();
    return vendors
      .sort((a, b) => Number(b.is_featured) - Number(a.is_featured))
      .slice(0, limit)
      .map((vendor) => toFoodCard(vendor, null, vendor.is_featured));
  }

  if (source === "partners") {
    const shops = await getPartnerShops();
    return shops
      .sort((a, b) => Number(b.is_featured) - Number(a.is_featured))
      .slice(0, limit)
      .map((shop) => toPartnerCard(shop, null, shop.is_featured));
  }

  const rows = (await getDepartmentVendors(departmentId)).filter((row) => row.is_active);
  if (rows.length === 0) return [];

  const needsFood = rows.some((row) => row.food_vendor_id);
  const needsPartners = rows.some((row) => row.vendor_id);
  const [foodVendors, partnerShops] = await Promise.all([
    needsFood ? getFoodVendors(true) : Promise.resolve<FoodVendor[]>([]),
    // The public projection, not the base table: `vendors` has no anon read
    // policy (it holds payout and contact columns), so asking for
    // `includeInactive` here returns no rows for a storefront rendered as a
    // visitor and the curated partner card silently disappears. The card view
    // returns the same `id`, so the placement still resolves; a shop that is
    // not active simply is not merchandised publicly, which is the truth this
    // page should show.
    needsPartners ? getPartnerShops() : Promise.resolve<PartnerShop[]>([]),
  ]);

  const foodById = new Map(foodVendors.map((vendor) => [vendor.id, vendor]));
  const partnerById = new Map(partnerShops.map((shop) => [shop.id, shop]));

  const cards: DepartmentVendor[] = [];
  for (const row of rows) {
    if (row.food_vendor_id) {
      const vendor = foodById.get(row.food_vendor_id);
      if (vendor) cards.push(toFoodCard(vendor, row.label, row.is_featured));
      continue;
    }
    if (row.vendor_id) {
      const shop = partnerById.get(row.vendor_id);
      if (shop) cards.push(toPartnerCard(shop, row.label, row.is_featured));
    }
  }

  return cards
    .sort((a, b) => Number(b.is_featured) - Number(a.is_featured))
    .slice(0, limit);
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
  slug: string,
  options: { includeInactive?: boolean } = {}
): Promise<DepartmentStorefront | null> {
  const department = await getDepartmentBySlug(slug, {
    includeInactive: options.includeInactive,
  });
  if (!department) return null;

  const [sections, navigation, placements, categories, allDepartments] = await Promise.all([
    getDepartmentSections(department.id),
    getDepartmentNavigation(department.id),
    getDepartmentPlacements(department.id),
    getCategories(),
    getDepartments({ includeInactive: options.includeInactive }),
  ]);

  const productSections = sections.filter(
    (section) => section.kind === "product_grid"
  );
  const wantsCatalogue = productSections.some(
    (section) => (section.config.source ?? "placements") !== "placements"
  );

  // One catalogue read serves every product grid, whatever the source.
  const [catalogue, vendors] = await Promise.all([
    wantsCatalogue ? getProducts() : Promise.resolve<Product[]>([]),
    resolveDepartmentVendors(department.id, sections),
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

/* ==========================================================================
 * Control Center writes
 *
 * These are plain table writes, not RPCs, because the authorization decision
 * lives in the database: RLS decides *which rows* the caller may touch and
 * `protect_department_columns()` decides *which columns* a partner may change.
 * That means the same functions serve the admin dashboard and a partner's own
 * storefront editor, and neither surface can widen its own authority by calling
 * a different function.
 * ======================================================================== */

function client() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("No production data source configured.");
  }
  return supabase;
}

function fail(error: { message?: string } | null, fallback: string): never {
  throw new Error(error?.message || fallback);
}

export interface DepartmentInput {
  slug: string;
  name: string;
  tagline?: string | null;
  description?: string | null;
  hero_image_url?: string | null;
  accent_from?: string | null;
  accent_to?: string | null;
  accent_color?: string | null;
  icon?: string | null;
  sort_order?: number;
  is_active?: boolean;
  show_in_navigation?: boolean;
  seo_title?: string | null;
  seo_description?: string | null;
  owner_vendor_id?: string | null;
  metadata?: Record<string, unknown>;
}

export async function createDepartment(input: DepartmentInput): Promise<Department> {
  const { data, error } = await client()
    .from("departments")
    .insert({
      ...input,
      metadata: input.metadata ?? {},
    })
    .select("*")
    .single();
  if (error) fail(error, "Unable to create this department.");
  return data as Department;
}

/**
 * Partial update. `undefined` fields are stripped so a form that only edits the
 * hero copy does not wipe the SEO fields; `null` is kept because clearing a
 * field is a real intent.
 */
export async function updateDepartment(
  id: string,
  patch: Partial<DepartmentInput>
): Promise<Department> {
  const payload = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined)
  );
  const { data, error } = await client()
    .from("departments")
    .update(payload)
    .eq("id", id)
    .select("*")
    .single();
  if (error) fail(error, "Unable to save this department.");
  return data as Department;
}

export async function deleteDepartment(id: string): Promise<void> {
  const { error } = await client().from("departments").delete().eq("id", id);
  if (error) fail(error, "Unable to delete this department.");
}

/** Rewrites `sort_order` from an ordered id list (index × 10). */
export async function reorderDepartments(orderedIds: string[]): Promise<void> {
  const db = client();
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      db.from("departments").update({ sort_order: (index + 1) * 10 }).eq("id", id)
    )
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) fail(failed.error, "Unable to reorder departments.");
}

/**
 * Departments the signed-in partner owns, for their own editor.
 *
 * One query, not one per department: the caller's vendor id is resolved once
 * through `get_my_vendor()` (SECURITY DEFINER) and used as a filter. Returns []
 * for a customer rather than throwing — "you own nothing" is a normal state.
 */
export async function getMyDepartments(): Promise<Department[]> {
  if (!isSupabaseConfigured || !supabase) return [];

  const { data: vendor, error: vendorError } = await supabase.rpc("get_my_vendor");
  if (vendorError || !vendor) return [];
  const vendorId = (vendor as { id?: string }).id;
  if (!vendorId) return [];

  const { data, error } = await supabase
    .from("departments")
    .select("*")
    .eq("owner_vendor_id", vendorId)
    .order("sort_order", { ascending: true });
  if (error) {
    if (isTableMissing(error)) return [];
    throw new Error(error.message || "Unable to load your storefronts.");
  }
  return (data ?? []) as Department[];
}

/**
 * Does the signed-in user own this department?
 *
 * Mirrors the SQL predicate so the UI can decide whether to offer editing; the
 * database remains authoritative either way.
 */
export async function ownsDepartment(departmentId: string): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  const { data, error } = await supabase.rpc("owns_department", {
    p_department_id: departmentId,
  });
  if (error) {
    // Before the P3 migration is applied the function does not exist; a partner
    // simply has no editable storefront, which is the safe answer.
    return false;
  }
  return data === true;
}

/* ---------------------------------------------------------------- sections */

export interface DepartmentSectionInput {
  department_id: string;
  kind: DepartmentSectionKind;
  title?: string | null;
  subtitle?: string | null;
  body?: string | null;
  config?: DepartmentSectionConfig;
  sort_order?: number;
  is_active?: boolean;
}

export async function createDepartmentSection(
  input: DepartmentSectionInput
): Promise<DepartmentSection> {
  const { data, error } = await client()
    .from("department_sections")
    .insert({ ...input, config: input.config ?? {} })
    .select("*")
    .single();
  if (error) fail(error, "Unable to add this section.");
  return data as DepartmentSection;
}

export async function updateDepartmentSection(
  id: string,
  patch: Partial<Omit<DepartmentSectionInput, "department_id">>
): Promise<DepartmentSection> {
  const payload = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined)
  );
  const { data, error } = await client()
    .from("department_sections")
    .update(payload)
    .eq("id", id)
    .select("*")
    .single();
  if (error) fail(error, "Unable to save this section.");
  return data as DepartmentSection;
}

export async function deleteDepartmentSection(id: string): Promise<void> {
  const { error } = await client().from("department_sections").delete().eq("id", id);
  if (error) fail(error, "Unable to delete this section.");
}

export async function reorderDepartmentSections(
  orderedIds: string[]
): Promise<void> {
  const db = client();
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      db.from("department_sections").update({ sort_order: (index + 1) * 10 }).eq("id", id)
    )
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) fail(failed.error, "Unable to reorder sections.");
}

/** Every section, including hidden ones — the Control Center edits drafts too. */
export async function getDepartmentSectionsForAdmin(
  departmentId: string
): Promise<DepartmentSection[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data, error } = await supabase
    .from("department_sections")
    .select("*")
    .eq("department_id", departmentId)
    .order("sort_order", { ascending: true });
  if (error) {
    if (isTableMissing(error)) return [];
    throw new Error(error.message || "Unable to load sections.");
  }
  return ((data ?? []) as DepartmentSection[]).map((section) => ({
    ...section,
    config: (section.config ?? {}) as DepartmentSectionConfig,
  }));
}

/* -------------------------------------------------------------- navigation */

export interface DepartmentNavigationInput {
  department_id: string;
  label: string;
  href: string;
  sort_order?: number;
  is_active?: boolean;
}

export async function createDepartmentNavigation(
  input: DepartmentNavigationInput
): Promise<DepartmentNavigationItem> {
  const { data, error } = await client()
    .from("department_navigation")
    .insert(input)
    .select("id, department_id, label, href, sort_order, is_active")
    .single();
  if (error) fail(error, "Unable to add this navigation item.");
  return data as DepartmentNavigationItem;
}

export async function updateDepartmentNavigation(
  id: string,
  patch: Partial<Omit<DepartmentNavigationInput, "department_id">>
): Promise<void> {
  const payload = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined)
  );
  const { error } = await client()
    .from("department_navigation")
    .update(payload)
    .eq("id", id);
  if (error) fail(error, "Unable to save this navigation item.");
}

export async function deleteDepartmentNavigation(id: string): Promise<void> {
  const { error } = await client()
    .from("department_navigation")
    .delete()
    .eq("id", id);
  if (error) fail(error, "Unable to delete this navigation item.");
}

export async function reorderDepartmentNavigation(
  orderedIds: string[]
): Promise<void> {
  const db = client();
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      db.from("department_navigation").update({ sort_order: (index + 1) * 10 }).eq("id", id)
    )
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) fail(failed.error, "Unable to reorder navigation.");
}

export async function getDepartmentNavigationForAdmin(
  departmentId: string
): Promise<DepartmentNavigationItem[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data, error } = await supabase
    .from("department_navigation")
    .select("id, department_id, label, href, sort_order, is_active")
    .eq("department_id", departmentId)
    .order("sort_order", { ascending: true });
  if (error) {
    if (isTableMissing(error)) return [];
    throw new Error(error.message || "Unable to load navigation.");
  }
  return (data ?? []) as DepartmentNavigationItem[];
}

/* -------------------------------------------------------------- placements */

export interface DepartmentPlacementInput {
  department_id: string;
  product_id: string;
  is_primary?: boolean;
  is_featured?: boolean;
  sort_order?: number;
  label?: string | null;
  is_active?: boolean;
}

export async function addDepartmentPlacement(
  input: DepartmentPlacementInput
): Promise<void> {
  const { error } = await client()
    .from("department_placements")
    .upsert(input, { onConflict: "department_id,product_id" });
  if (error) fail(error, "Unable to place this product in the department.");
}

export async function updateDepartmentPlacement(
  departmentId: string,
  productId: string,
  patch: Partial<Omit<DepartmentPlacementInput, "department_id" | "product_id">>
): Promise<void> {
  const payload = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined)
  );
  const { error } = await client()
    .from("department_placements")
    .update(payload)
    .eq("department_id", departmentId)
    .eq("product_id", productId);
  if (error) fail(error, "Unable to update this placement.");
}

export async function removeDepartmentPlacement(
  departmentId: string,
  productId: string
): Promise<void> {
  const { error } = await client()
    .from("department_placements")
    .delete()
    .eq("department_id", departmentId)
    .eq("product_id", productId);
  if (error) fail(error, "Unable to remove this placement.");
}

export async function reorderDepartmentPlacements(
  departmentId: string,
  orderedProductIds: string[]
): Promise<void> {
  const db = client();
  const results = await Promise.all(
    orderedProductIds.map((productId, index) =>
      db
        .from("department_placements")
        .update({ sort_order: (index + 1) * 10 })
        .eq("department_id", departmentId)
        .eq("product_id", productId)
    )
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) fail(failed.error, "Unable to reorder placements.");
}

/** Every placement (including hidden) with its product row, for the editor. */
export async function getDepartmentPlacementsForAdmin(
  departmentId: string
): Promise<DepartmentPlacement[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data, error } = await supabase
    .from("department_placements")
    .select(
      "department_id, product_id, is_primary, is_featured, sort_order, label, is_active"
    )
    .eq("department_id", departmentId)
    .order("sort_order", { ascending: true });
  if (error) {
    if (isTableMissing(error)) return [];
    throw new Error(error.message || "Unable to load placements.");
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

/* ------------------------------------------------------- curated vendors */

export interface DepartmentVendorInput {
  department_id: string;
  vendor_id?: string | null;
  food_vendor_id?: string | null;
  sort_order?: number;
  is_featured?: boolean;
  label?: string | null;
  is_active?: boolean;
}

export async function addDepartmentVendor(
  input: DepartmentVendorInput
): Promise<void> {
  const { error } = await client().from("department_vendors").insert({
    ...input,
    vendor_id: input.vendor_id ?? null,
    food_vendor_id: input.food_vendor_id ?? null,
  });
  if (error) fail(error, "Unable to add this vendor to the department.");
}

export async function updateDepartmentVendor(
  id: string,
  patch: Partial<Omit<DepartmentVendorInput, "department_id" | "vendor_id" | "food_vendor_id">>
): Promise<void> {
  const payload = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined)
  );
  const { error } = await client()
    .from("department_vendors")
    .update(payload)
    .eq("id", id);
  if (error) fail(error, "Unable to update this vendor.");
}

export async function removeDepartmentVendor(id: string): Promise<void> {
  const { error } = await client().from("department_vendors").delete().eq("id", id);
  if (error) fail(error, "Unable to remove this vendor.");
}

export async function reorderDepartmentVendors(
  orderedIds: string[]
): Promise<void> {
  const db = client();
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      db.from("department_vendors").update({ sort_order: (index + 1) * 10 }).eq("id", id)
    )
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) fail(failed.error, "Unable to reorder vendors.");
}
