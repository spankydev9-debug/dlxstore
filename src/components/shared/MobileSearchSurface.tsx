"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Clock3, Search, X } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { useOverlay } from "../../context/OverlayContext";
import { getCategories, getProducts } from "../../services/db/products";
import {
  buildSearchHref,
  clearRecentSearches,
  matchProducts,
  readRecentSearches,
  rememberSearch,
} from "../../lib/product-search";
import type { Category, Product } from "../../types";
import { ProductImage } from "./ProductImage";

/**
 * Full-screen mobile search surface.
 *
 * Search is a *destination* of the mobile layout (a tab), not a field hidden
 * inside an overflow drawer. The previous drawer field had no autocomplete at
 * all, which made phone search strictly worse than desktop.
 *
 * It provides parity with the desktop field — autocomplete over the same
 * matcher via `src/lib/product-search.ts` — plus recents and category shortcuts
 * so a customer can start without typing.
 */
export function MobileSearchSurface() {
  const { t } = useLanguage();
  const { closeOverlay } = useOverlay();
  const router = useRouter();

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [query, setQuery] = useState("");
  const [recents, setRecents] = useState<string[]>([]);

  useEffect(() => {
    setRecents(readRecentSearches());
    let cancelled = false;
    getProducts()
      .then((rows) => {
        if (!cancelled) setProducts(rows);
      })
      .catch(() => {
        if (!cancelled) setProducts([]);
      });
    getCategories()
      .then((rows) => {
        if (!cancelled) setCategories(rows);
      })
      .catch(() => {
        if (!cancelled) setCategories([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const results = useMemo(() => matchProducts(products, query, 8), [products, query]);
  const totalMatches = useMemo(
    () => (query.trim() ? matchProducts(products, query, products.length).length : 0),
    [products, query]
  );

  const submit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setRecents(rememberSearch(trimmed));
    closeOverlay();
    router.push(buildSearchHref(trimmed));
  };

  const chooseResult = (slug: string) => {
    if (query.trim()) setRecents(rememberSearch(query.trim()));
    closeOverlay();
    router.push(`/product/${slug}`);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Field */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit(query);
          }}
          className="relative min-w-0 flex-1"
        >
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3.5 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.searchPlaceholder}
            aria-label={t.searchPlaceholder}
            className="h-12 w-full rounded-xl border border-border bg-muted/50 pl-10 pr-4 text-base outline-none transition-colors focus:border-primary focus:bg-background"
          />
        </form>
        <button
          type="button"
          onClick={closeOverlay}
          className="flex h-12 shrink-0 items-center gap-1 rounded-xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden />
          {t.searchClose}
        </button>
      </div>

      {/* Results */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[calc(env(safe-area-inset-bottom)+5rem)]">
        {query.trim() ? (
          results.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
              <Search className="h-7 w-7 text-muted-foreground/50" aria-hidden />
              <p className="text-sm font-medium">{t.searchNoResults}</p>
              <button
                type="button"
                onClick={() => submit(query)}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 px-4 text-sm font-semibold text-primary transition-colors hover:bg-primary/10"
              >
                {t.seeAllResults}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => submit(query)}
                className="mt-3 flex min-h-11 w-full items-center justify-between rounded-xl border border-primary/40 bg-primary/5 px-4 text-left text-sm font-semibold text-primary transition-colors hover:bg-primary/10"
              >
                {t.seeAllResults}
                <span className="text-xs font-normal opacity-80">
                  {t.resultCount.replace("{count}", String(totalMatches))}
                </span>
              </button>
              <ul className="mt-3 space-y-1">
                {results.map((product) => (
                  <li key={product.id}>
                    <button
                      type="button"
                      onClick={() => chooseResult(product.slug)}
                      className="flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-muted"
                    >
                      <ProductImage
                        src={product.images[0]}
                        alt={product.name}
                        width={40}
                        height={40}
                        className="h-10 w-10 shrink-0 rounded-lg object-cover"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{product.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {product.brand}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold">
                        {product.discount_price ?? product.price} $
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )
        ) : (
          <>
            {recents.length > 0 ? (
              <section className="pt-4">
                <div className="flex items-center justify-between px-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t.recentSearches}
                  </h2>
                  <button
                    type="button"
                    onClick={() => {
                      clearRecentSearches();
                      setRecents([]);
                    }}
                    className="min-h-11 px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {t.clearSearches}
                  </button>
                </div>
                <ul className="mt-1">
                  {recents.map((entry) => (
                    <li key={entry}>
                      <button
                        type="button"
                        onClick={() => submit(entry)}
                        className="flex min-h-11 w-full items-center gap-3 rounded-xl px-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <Clock3 className="h-4 w-4 shrink-0" aria-hidden />
                        <span className="truncate">{entry}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className="pt-5">
              <h2 className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t.browseCategories}
              </h2>
              <ul className="mt-2 grid grid-cols-2 gap-2">
                {categories.map((category) => (
                  <li key={category.id}>
                    <Link
                      href={`/shop?category=${encodeURIComponent(category.slug)}`}
                      onClick={closeOverlay}
                      className="flex min-h-11 items-center rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium transition-colors hover:border-primary/50 hover:text-primary"
                    >
                      <span className="truncate">{category.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
