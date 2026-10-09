"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { getCategories } from "../../services/db/products";
import type { Category } from "../../types";
import { useLanguage } from "../../context/LanguageContext";

export function CategoryRail() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useLanguage();
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getCategories()
      .then((rows) => {
        if (!cancelled) {
          setCategories(rows.filter((cat) => cat.is_active !== false));
        }
      })
      .catch(() => {
        if (!cancelled) setCategories([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const currentCategorySlug = useMemo(() => searchParams.get("category") || "", [searchParams]);
  const isShopPage = pathname === "/shop" || pathname.startsWith("/shop/");
  const isProductPage = pathname.startsWith("/product/");
  const shouldShow = isShopPage || isProductPage || pathname === "/discover";

  if (!shouldShow || isLoading || categories.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-2 pt-2 md:mx-0 md:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Link
          href="/shop"
          className={`flex shrink-0 snap-start items-center rounded-full px-4 py-2 text-sm font-medium transition-colors ${
            !currentCategorySlug
              ? "bg-primary text-primary-foreground shadow-sm"
              : "border border-border bg-card text-muted-foreground hover:text-foreground"
          }`}
        >
          {t.allCategories}
        </Link>
        {categories.map((category) => {
          const isActive = currentCategorySlug === category.slug;
          return (
            <Link
              key={category.id}
              href={`/shop?category=${encodeURIComponent(category.slug)}`}
              className={`flex shrink-0 snap-start items-center rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "border border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {category.name}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
