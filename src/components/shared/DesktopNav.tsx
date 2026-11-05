"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ChevronDown, LayoutGrid, Shirt } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useLanguage } from "../../context/LanguageContext";
import { useDepartmentsNav } from "../../hooks/useDepartmentsNav";
import { getCategories } from "../../services/db/products";
import { departmentHref } from "../../lib/departments";
import { departmentIcon } from "../../lib/department-icons";
import type { Category } from "../../types";
import { AvatarBadge } from "../account/AvatarBadge";
import { OverlayLink } from "./OverlayLink";

/**
 * Desktop primary navigation — one of the two *intentionally designed* layouts
 * in this pass (the other is `MobileTabBar`). It is not a breakpoint variant of
 * the mobile bar: desktop has a pointer and width, so it gets a journey-ordered
 * row with a Categories mega-menu instead of a thumb bar.
 *
 * Ordering follows the shopping journey, not the route table:
 *
 *   <departments> · Categories · Discover · Studio · Chat
 *
 * The storefront entries come from `departments` (`show_in_navigation`, ordered
 * by `sort_order`), not from this file: publishing DLX Beauty or handing a
 * partner their own storefront must not require a deploy. Roles that never
 * change — Categories, Discover, Studio, Chat — stay here because they are
 * platform chrome, not merchandise.
 *
 * `About` / `Contact` / `Become a partner` are deliberately absent: they are
 * utility destinations that live in the account menu and footer, and were the
 * clearest symptom of navigation built by accumulating routes.
 *
 * Every item carries `aria-current` from `usePathname()` — the previous header
 * had no active state anywhere, so the site never told you where you were.
 */
export function DesktopNav() {
  const pathname = usePathname();
  const { user } = useAuth();
  const { t } = useLanguage();
  const { departments } = useDepartmentsNav();
  const [categories, setCategories] = useState<Category[]>([]);
  const [megaOpen, setMegaOpen] = useState(false);
  const megaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    getCategories()
      .then((rows) => {
        if (!cancelled) setCategories(rows);
      })
      .catch(() => {
        // A missing category list degrades to no mega-menu, never to a broken
        // primary nav row.
        if (!cancelled) setCategories([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!megaOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (megaRef.current && !megaRef.current.contains(event.target as Node)) setMegaOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMegaOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [megaOpen]);

  /** `aria-current="page"` for direct routes, `"true"` for a section prefix. */
  const current = (href: string): "page" | "true" | undefined => {
    if (pathname === href) return "page";
    if (href !== "/" && pathname.startsWith(`${href}/`)) return "true";
    return undefined;
  };

  /** A department is current at either of its two addresses. */
  const departmentCurrent = (
    href: string,
    slug: string
  ): "page" | "true" | undefined => {
    if (pathname === href || pathname === `/d/${slug}`) return "page";
    if (href !== "/" && pathname.startsWith(`${href}/`)) return "true";
    return undefined;
  };

  const navClass =
    "rounded-lg px-2 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
  const linkClass = (href: string) =>
    `${navClass} ${
      current(href)
        ? "text-foreground"
        : "text-muted-foreground hover:text-foreground"
    }`;

  const categoriesActive =
    current("/shop") !== undefined ||
    categories.some((category) => pathname.startsWith(`/shop?category=${category.slug}`));

  return (
    <nav
      aria-label={t.menu}
      className="hidden items-center gap-1 text-sm font-medium md:flex"
    >
      {/* Storefronts. While the list loads — or before departments exist in this
          environment — the row keeps a working Shop entry rather than collapsing. */}
      {departments.length === 0 ? (
        <OverlayLink
          href="/shop"
          aria-current={current("/shop")}
          className={linkClass("/shop")}
        >
          {t.shop}
        </OverlayLink>
      ) : (
        departments.map((department) => {
          const href = departmentHref(department);
          const active = departmentCurrent(href, department.slug);
          const Icon = departmentIcon(department.icon);
          return (
            <OverlayLink
              key={department.id}
              href={href}
              aria-current={active}
              className={`${navClass} inline-flex items-center gap-1.5 ${
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {department.name}
            </OverlayLink>
          );
        })
      )}

      {/* Categories — a mega-menu built from the real `categories` table, so the
          entry point reflects what the catalogue actually contains. Gives way
          to utilities on constrained rows (container < 53.75rem). */}
      <div ref={megaRef} className="relative @max-[53.75rem]/header:hidden">
        <button
          type="button"
          onClick={() => setMegaOpen((open) => !open)}
          aria-expanded={megaOpen}
          aria-haspopup="menu"
          className={`${navClass} ${
            categoriesActive || megaOpen ? "text-foreground" : "text-muted-foreground hover:text-foreground"
          } inline-flex items-center gap-1`}
        >
          <LayoutGrid className="h-4 w-4" aria-hidden />
          {t.categories}
          <ChevronDown
            aria-hidden
            className={`h-3.5 w-3.5 transition-transform ${megaOpen ? "rotate-180" : ""}`}
          />
        </button>

        {megaOpen && (
          <div
            role="menu"
            className="absolute left-0 top-full z-50 mt-1 w-[min(34rem,calc(100vw-2rem))] rounded-xl border border-border/70 bg-card p-3 shadow-2xl animate-fade-in"
          >
            <OverlayLink
              href="/shop"
              onClick={() => setMegaOpen(false)}
              role="menuitem"
              className="mb-1 flex min-h-11 items-center justify-between rounded-lg bg-primary/10 px-3 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/15"
            >
              {t.browseCategories}
            </OverlayLink>
            <div className="grid grid-cols-2 gap-1">
              {categories.map((category) => (
                <OverlayLink
                  key={category.id}
                  href={`/shop?category=${encodeURIComponent(category.slug)}`}
                  onClick={() => setMegaOpen(false)}
                  role="menuitem"
                  className="min-h-11 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {category.name}
                </OverlayLink>
              ))}
            </div>
          </div>
        )}
      </div>

      <OverlayLink
        href="/discover"
        aria-current={current("/discover")}
        className={`${linkClass("/discover")} @max-[58.75rem]/header:hidden`}
      >
        {t.discoverTab}
      </OverlayLink>

      {/* Studio gets identity rather than being a sixth arbitrary text link: a
          signed-in customer sees their own mannequin; a visitor sees the CTA. */}
      <OverlayLink
        href="/studio"
        aria-current={current("/studio")}
        title={user ? t.studio : t.navStudioCreate}
        className={`${navClass} ${
          current("/studio") ? "text-foreground" : "text-muted-foreground hover:text-foreground"
        } inline-flex items-center gap-1.5 rounded-full border ${
          current("/studio")
            ? "border-[#d4af37]/60 bg-[#d4af37]/15"
            : "border-[#d4af37]/30 bg-[#d4af37]/[0.07] hover:border-[#d4af37]/50"
        }`}
      >
        <Shirt className="h-4 w-4 text-[#d4af37]" aria-hidden />
        {user ? (
          <>
            <AvatarBadge user={user} className="h-6 w-6" linked={false} />
            <span className="hidden lg:inline">{t.studio}</span>
          </>
        ) : (
          <span className="hidden lg:inline">{t.navStudioCreate}</span>
        )}
      </OverlayLink>

      <OverlayLink
        href="/chat"
        aria-current={current("/chat")}
        className={`${linkClass("/chat")} @max-[58.75rem]/header:hidden`}
      >
        {t.messages}
      </OverlayLink>
    </nav>
  );
}
