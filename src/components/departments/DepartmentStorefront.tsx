import Link from "next/link";
import {
  ArrowRight,
  Clock3,
  PackageX,
  ShoppingBag,
  Sparkles,
  Star,
  Store,
  UtensilsCrossed,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Category } from "../../types";
import type {
  Department,
  DepartmentProductItem,
  DepartmentSection,
  DepartmentVendor,
  DepartmentStorefront as DepartmentStorefrontData,
} from "../../services/db/departments";
import { departmentHref, type DepartmentStorefrontLabels } from "../../lib/departments";
import { ProductImage } from "../shared/ProductImage";

/**
 * One renderer for every department.
 *
 * Everything below is driven by rows — `departments` for the theme/hero copy,
 * `department_sections` for which blocks appear and in what order,
 * `department_placements` for what is merchandised. There is intentionally no
 * `slug === "food"` branch anywhere: adding DLX Home, DLX Beauty or a partner
 * storefront is data, and adding a *kind* of block is one case in this switch.
 */

/** Generic name → icon map. A department stores an icon name, never a component. */
const DEPARTMENT_ICONS: Record<string, LucideIcon> = {
  shop: ShoppingBag,
  store: Store,
  utensils: UtensilsCrossed,
  zap: Zap,
  sparkles: Sparkles,
};

const PROMO_TONES: Record<string, { from: string; to: string }> = {
  emerald: { from: "#059669", to: "#0f766e" },
  amber: { from: "#d97706", to: "#b45309" },
  primary: { from: "#1d4ed8", to: "#1e3a8a" },
  neutral: { from: "#334155", to: "#0f172a" },
};

export interface DepartmentStorefrontProps {
  storefront: DepartmentStorefrontData;
  labels: DepartmentStorefrontLabels;
}

function heroStyle(department: Department) {
  return {
    backgroundImage: `linear-gradient(135deg, ${department.accent_from ?? "#0f172a"} 0%, ${
      department.accent_to ?? "#334155"
    } 100%)`,
  };
}

function sectionAnchor(section: DepartmentSection): string | undefined {
  return section.config.anchor;
}

/**
 * Desktop column count is a per-section setting, not a theme constant, so an
 * admin can decide that Energy shows two large cards and Shop shows three.
 */
function productGridClass(section: DepartmentSection): string {
  const columns = section.config.columns;
  const desktop =
    columns === 4
      ? "lg:grid-cols-4"
      : columns === 2
        ? "lg:grid-cols-2"
        : "lg:grid-cols-3";
  return `grid grid-cols-1 gap-4 sm:grid-cols-2 ${desktop}`;
}


function CtaLink({
  href,
  label,
  variant,
}: {
  href: string;
  label: string;
  variant: "solid" | "ghost";
}) {
  const className =
    variant === "solid"
      ? "inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-slate-900 shadow-sm transition hover:bg-white/90"
      : "inline-flex items-center gap-2 rounded-full border border-border bg-card px-5 py-2.5 text-sm font-bold text-foreground transition hover:bg-muted";
  // Anchors and route links are both stored as data; Link handles hash targets
  // without a navigation round-trip.
  return (
    <Link href={href} className={className}>
      {label}
      <ArrowRight className="h-4 w-4" aria-hidden />
    </Link>
  );
}

function Hero({
  department,
  section,
}: {
  department: Department;
  section: DepartmentSection | null;
}) {
  const Icon = DEPARTMENT_ICONS[department.icon ?? ""] ?? Sparkles;
  const ctaLabel = section?.config.cta_label;
  const ctaHref = section?.config.cta_href;

  return (
    <section
      className="relative overflow-hidden rounded-3xl px-6 py-10 text-white shadow-lg sm:px-10 sm:py-14"
      style={heroStyle(department)}
    >
      <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-3xl" aria-hidden />
      <div className="relative max-w-2xl space-y-4">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/15 px-3 py-1 text-xs font-bold">
          <Icon className="h-4 w-4" aria-hidden />
          {department.name}
        </span>
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-5xl">
          {section?.title ?? department.tagline ?? department.name}
        </h1>
        <p className="max-w-xl text-sm leading-relaxed text-white/90 sm:text-base">
          {section?.subtitle ?? department.description ?? ""}
        </p>
        {ctaLabel && ctaHref && (
          <div className="pt-1">
            <CtaLink href={ctaHref} label={ctaLabel} variant="solid" />
          </div>
        )}
      </div>
    </section>
  );
}

function ProductGrid({
  section,
  items,
  labels,
}: {
  section: DepartmentSection;
  items: DepartmentProductItem[];
  labels: DepartmentStorefrontLabels;
}) {
  return (
    <section id={sectionAnchor(section)} className="space-y-4 scroll-mt-24">
      <header className="space-y-1">
        <h2 className="text-xl font-bold tracking-tight">{section.title}</h2>
        {section.subtitle && (
          <p className="text-sm text-muted-foreground">{section.subtitle}</p>
        )}
      </header>
      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          {labels.empty}
        </p>
      ) : (
        <div className={productGridClass(section)}>
          {items.map(({ product, label }) => (
            <Link
              key={product.id}
              href={`/product/${product.slug}`}
              className="group flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-card transition-all hover:shadow-md"
            >
              <div className="relative aspect-square overflow-hidden bg-muted">
                <ProductImage
                  src={product.images?.[0]}
                  alt={product.name}
                  fill
                  sizes="(max-width: 768px) 100vw, 33vw"
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                />
                {label ? (
                  <span className="absolute left-3 top-3 rounded-full bg-slate-900/90 px-2.5 py-1 text-[10px] font-bold text-white">
                    {label}
                  </span>
                ) : product.discount_price ? (
                  <span className="absolute left-3 top-3 rounded-full bg-destructive px-2.5 py-1 text-[10px] font-bold text-destructive-foreground">
                    Promo
                  </span>
                ) : null}
              </div>
              <div className="flex flex-1 flex-col gap-1 p-4">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {product.brand}
                </span>
                <h3 className="line-clamp-1 text-sm font-bold group-hover:underline">
                  {product.name}
                </h3>
                <div className="flex items-baseline gap-2 pt-1">
                  <span className="text-base font-extrabold">
                    {product.discount_price ?? product.price} $
                  </span>
                  {product.discount_price ? (
                    <span className="text-xs text-muted-foreground line-through">
                      {product.price} $
                    </span>
                  ) : null}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function VendorGrid({
  section,
  vendors,
  labels,
}: {
  section: DepartmentSection;
  vendors: DepartmentVendor[];
  labels: DepartmentStorefrontLabels;
}) {
  return (
    <section id={sectionAnchor(section)} className="space-y-4 scroll-mt-24">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="space-y-1">
          <h2 className="text-xl font-bold tracking-tight">{section.title}</h2>
          {section.subtitle && (
            <p className="text-sm text-muted-foreground">{section.subtitle}</p>
          )}
        </div>
        <span className="text-sm text-muted-foreground">
          {vendors.length} {labels.vendorCount}
        </span>
      </header>
      {vendors.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          {labels.empty}
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {vendors.map((vendor) => (
            <Link
              key={`${vendor.kind}-${vendor.id}`}
              href={vendor.href}
              className="group flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:border-foreground/30 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-bold group-hover:underline">{vendor.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {[vendor.city, vendor.province].filter(Boolean).join(", ")}
                  </p>
                </div>
                {vendor.label ? (
                  <span className="shrink-0 rounded-full bg-foreground px-2.5 py-1 text-[10px] font-bold text-background">
                    {vendor.label}
                  </span>
                ) : vendor.is_24_7 ? (
                  <span className="shrink-0 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-600">
                    24/7
                  </span>
                ) : (
                  <Clock3 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
              </div>
              {vendor.description && (
                <p className="line-clamp-3 text-sm text-muted-foreground">{vendor.description}</p>
              )}
              {vendor.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {vendor.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-auto flex items-center gap-3 text-xs text-muted-foreground">
                {typeof vendor.rating === "number" && (
                  <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden />
                    {vendor.rating}
                  </span>
                )}
                {typeof vendor.preparation_time_minutes === "number" && (
                  <span>{vendor.preparation_time_minutes} min</span>
                )}
                {vendor.delivery_fee === 0 && <span>Livraison gratuite</span>}
                <span className="ml-auto inline-flex items-center gap-1 font-semibold text-foreground">
                  {labels.viewVendor}
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function CategoryGrid({
  section,
  categories,
}: {
  section: DepartmentSection;
  categories: Category[];
}) {
  const limit =
    typeof section.config.limit === "number" && section.config.limit > 0
      ? section.config.limit
      : 8;
  // An admin-picked list wins and keeps its order; otherwise the department
  // shows the catalogue's own order.
  const picked = section.config.category_slugs ?? [];
  const ordered =
    picked.length > 0
      ? picked
          .map((slug) => categories.find((category) => category.slug === slug))
          .filter((category): category is Category => Boolean(category))
      : categories;
  const visible = ordered.slice(0, limit);
  if (visible.length === 0) return null;

  return (
    <section id={sectionAnchor(section)} className="space-y-4 scroll-mt-24">
      <header className="space-y-1">
        <h2 className="text-xl font-bold tracking-tight">{section.title}</h2>
        {section.subtitle && (
          <p className="text-sm text-muted-foreground">{section.subtitle}</p>
        )}
      </header>
      <div className="flex flex-wrap gap-2">
        {visible.map((category) => (
          <Link
            key={category.id}
            href={`/shop?category=${category.slug}`}
            className="rounded-full border border-border bg-card px-4 py-2 text-sm font-medium transition hover:border-foreground/40 hover:bg-muted"
          >
            {category.name}
          </Link>
        ))}
      </div>
    </section>
  );
}

function Promo({ section }: { section: DepartmentSection }) {
  const tone = PROMO_TONES[section.config.tone ?? "neutral"] ?? PROMO_TONES.neutral;
  const ctaLabel = section.config.cta_label;
  const ctaHref = section.config.cta_href;

  return (
    <section
      id={sectionAnchor(section)}
      className="relative overflow-hidden rounded-3xl px-6 py-8 text-white shadow-md sm:px-10 sm:py-10 scroll-mt-24"
      style={{ backgroundImage: `linear-gradient(135deg, ${tone.from} 0%, ${tone.to} 100%)` }}
    >
      <div className="absolute -bottom-20 -right-10 h-56 w-56 rounded-full bg-white/10 blur-3xl" aria-hidden />
      <div className="relative max-w-2xl space-y-3">
        <h2 className="text-xl font-extrabold tracking-tight sm:text-2xl">{section.title}</h2>
        {section.subtitle && (
          <p className="text-sm font-semibold text-white/80">{section.subtitle}</p>
        )}
        {section.body && <p className="text-sm leading-relaxed text-white/90">{section.body}</p>}
        {ctaLabel && ctaHref && (
          <div className="pt-1">
            <CtaLink href={ctaHref} label={ctaLabel} variant="solid" />
          </div>
        )}
      </div>
    </section>
  );
}

function TextBlock({ section }: { section: DepartmentSection }) {
  const ctaLabel = section.config.cta_label;
  const ctaHref = section.config.cta_href;

  return (
    <section
      id={sectionAnchor(section)}
      className="rounded-3xl border border-border bg-card px-6 py-8 shadow-sm sm:px-10 scroll-mt-24"
    >
      <div className="max-w-2xl space-y-3">
        <h2 className="text-xl font-bold tracking-tight">{section.title}</h2>
        {section.subtitle && (
          <p className="text-sm font-semibold text-muted-foreground">{section.subtitle}</p>
        )}
        {section.body && <p className="text-sm leading-relaxed text-muted-foreground">{section.body}</p>}
        {ctaLabel && ctaHref && (
          <div className="pt-1">
            <CtaLink href={ctaHref} label={ctaLabel} variant="ghost" />
          </div>
        )}
      </div>
    </section>
  );
}

function Section({
  section,
  storefront,
  labels,
}: {
  section: DepartmentSection;
  storefront: DepartmentStorefrontData;
  labels: DepartmentStorefrontLabels;
}) {
  switch (section.kind) {
    case "hero":
      return <Hero department={storefront.department} section={section} />;
    case "product_grid":
      return (
        <ProductGrid
          section={section}
          items={storefront.sectionProducts[section.id] ?? []}
          labels={labels}
        />
      );
    case "vendor_grid":
      return <VendorGrid section={section} vendors={storefront.vendors} labels={labels} />;
    case "category_grid":
      return <CategoryGrid section={section} categories={storefront.categories} />;
    case "promo":
      return <Promo section={section} />;
    case "text":
      return <TextBlock section={section} />;
    // An unknown kind renders nothing rather than breaking the page: the
    // database CHECK already prevents typos, and a newer Control Center may
    // introduce a kind before this renderer ships.
    default:
      return null;
  }
}

export default function DepartmentStorefront({
  storefront,
  labels,
}: DepartmentStorefrontProps) {
  const { department, navigation, sections, otherDepartments } = storefront;
  const hasHeroSection = sections.some((section) => section.kind === "hero");

  return (
    <div className="mx-auto max-w-6xl space-y-10 py-2 sm:py-4">
      {/* No hero row = the department still gets its identity block. */}
      {!hasHeroSection && <Hero department={department} section={null} />}

      {navigation.length > 0 && (
        <nav aria-label={department.name} className="flex flex-wrap gap-2">
          {navigation.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className="rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold transition hover:border-foreground/40 hover:bg-muted"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      )}

      {sections.map((section) => (
        <Section key={section.id} section={section} storefront={storefront} labels={labels} />
      ))}

      {otherDepartments.length > 0 && (
        <section className="space-y-4 border-t border-border/60 pt-8">
          <h2 className="text-lg font-bold tracking-tight">{labels.other}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {otherDepartments.map((other) => {
              const Icon = DEPARTMENT_ICONS[other.icon ?? ""] ?? Sparkles;
              const href = departmentHref(other);
              return (
                <Link
                  key={other.id}
                  href={href}
                  className="group flex items-center gap-3 rounded-2xl border border-border bg-card p-4 transition hover:border-foreground/30 hover:shadow-sm"
                >
                  <span
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white"
                    style={heroStyle(other)}
                  >
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-bold group-hover:underline">
                      {other.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {other.tagline ?? ""}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {sections.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-4 py-14 text-center">
          <PackageX className="h-10 w-10 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">{labels.empty}</p>
        </div>
      )}
    </div>
  );
}
