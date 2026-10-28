"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { getProducts, getCategories } from "../../services/db/products";
import { getSessionBySlug, getProductsForSession } from "../../services/db/sessions";
import { Product, Category } from "../../types";
import { Star, Search, SlidersHorizontal, RotateCcw, PackageX } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { ProductImage } from "../../components/shared/ProductImage";
import { SocialRecommendationsRail } from "../../components/product/SocialRecommendationsRail";
import { matchesProductQuery } from "../../lib/product-search";

/**
 * Loading placeholder that reproduces the real /shop layout: title, filter
 * sidebar and a grid of card placeholders. Every dimension comes from the same
 * classes the catalog uses (`aspect-square` media, `p-4` body, the same grid
 * tracks), so replacing it with the real grid cannot shift the page.
 */
function ShopSkeleton({ title, intro, filtersLabel }: { title: string; intro: string; filtersLabel: string }) {
  const placeholderLight = "rounded bg-muted";
  return (
    <div className="space-y-8" aria-busy="true" aria-live="polite">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground/60">{title}</h1>
        <p className="text-sm text-muted-foreground">{intro}</p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-4">
        <aside className="space-y-6 rounded-2xl border border-border/50 bg-card p-5 shadow-sm h-fit">
          <div className="flex items-center justify-between border-b border-border/40 pb-3">
            <h3 className="flex items-center gap-2 text-base font-bold text-foreground/60">
              <SlidersHorizontal className="h-4.5 w-4.5" aria-hidden />
              {filtersLabel}
            </h3>
            <span className="h-3 w-12 animate-pulse rounded bg-muted" />
          </div>
          {Array.from({ length: 4 }).map((_, group) => (
            <div key={group} className="space-y-3">
              <span className={`block h-3 w-20 animate-pulse ${placeholderLight}`} />
              <span className="block h-9 w-full animate-pulse rounded-lg bg-muted" />
            </div>
          ))}
        </aside>

        <div className="lg:col-span-3">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 9 }).map((_, index) => (
              <div key={index} className="flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-card">
                <div className="aspect-square w-full animate-pulse bg-muted" />
                <div className="flex flex-1 flex-col gap-2 p-4">
                  <span className={`h-3 w-16 animate-pulse ${placeholderLight}`} />
                  <span className={`h-4 w-3/4 animate-pulse ${placeholderLight}`} />
                  <span className={`h-3.5 w-12 animate-pulse ${placeholderLight}`} />
                  <span className={`mt-auto h-5 w-24 animate-pulse ${placeholderLight}`} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ShopContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { t } = useLanguage();

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filter States
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedSession, setSelectedSession] = useState("");
  const [selectedSessionName, setSelectedSessionName] = useState("");
  const [sessionProductIds, setSessionProductIds] = useState<string[]>([]);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [inStockOnly, setInStockOnly] = useState(false);
  const [sortBy, setSortBy] = useState("recent");

  // Read URL params
  useEffect(() => {
    const urlSearch = searchParams.get("search") || "";
    const urlCat = searchParams.get("category") || "";
    const urlSession = searchParams.get("session") || "";
    setSearch(urlSearch);
    setSelectedCategory(urlCat);
    setSelectedSession(urlSession);
  }, [searchParams]);

  useEffect(() => {
    async function loadData() {
      try {
        const [cats, prods] = await Promise.all([getCategories(), getProducts()]);
        setCategories(
          cats.filter((cat) =>
            prods.some(
              (p) =>
                p.is_active !== false &&
                p.is_archived !== true &&
                p.category_id === cat.id &&
                (!inStockOnly ? true : p.stock_quantity > 0)
            )
          )
        );
        setProducts(prods);
      } catch (err) {
        console.error("Error loading shop data:", err);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, []);

  // Resolve session membership (used when ?session=slug is set)
  useEffect(() => {
    let cancelled = false;
    async function resolveSession() {
      if (!selectedSession) {
        setSessionProductIds([]);
        setSelectedSessionName("");
        return;
      }
      try {
        const session = await getSessionBySlug(selectedSession);
        if (!session) {
          if (!cancelled) { setSessionProductIds([]); setSelectedSessionName(""); }
          return;
        }
        setSelectedSessionName(session.name);
        const sessionProducts = await getProductsForSession(session.id);
        if (!cancelled) setSessionProductIds(sessionProducts.map((p) => p.id));
      } catch (err) {
        console.error("Error resolving session:", err);
        if (!cancelled) { setSessionProductIds([]); setSelectedSessionName(""); }
      }
    }
    resolveSession();
    return () => { cancelled = true; };
  }, [selectedSession]);

  const handleClearFilters = () => {
    setSearch("");
    setSelectedCategory("");
    setSelectedSession("");
    setSessionProductIds([]);
    setMinPrice("");
    setMaxPrice("");
    setInStockOnly(false);
    setSortBy("recent");
    router.push("/shop");
  };

  // Filter & Sort Logic
  const filteredProducts = products
    .filter(p => {
      // 1. Search Query — one shared matcher (name, brand, SKU, category, tags,
      //    description) with partial + typo tolerance, so the results page and
      //    the header/mobile autocomplete always agree.
      if (search.trim()) {
        if (!matchesProductQuery(p, search, categories)) return false;
      }
      
      // 2. Category
      if (selectedCategory) {
        // Find category object slug
        const cat = categories.find(c => c.slug === selectedCategory);
        if (cat && p.category_id !== cat.id) return false;
      }

      // 2b. Session (product must belong to the filtered session, if any)
      if (selectedSession && !sessionProductIds.includes(p.id)) {
        return false;
      }

      // 3. Min Price
      if (minPrice.trim()) {
        const finalPrice = p.discount_price ?? p.price;
        if (finalPrice < parseFloat(minPrice)) return false;
      }

      // 4. Max Price
      if (maxPrice.trim()) {
        const finalPrice = p.discount_price ?? p.price;
        if (finalPrice > parseFloat(maxPrice)) return false;
      }

      // 5. In Stock Only
      if (inStockOnly && p.stock_quantity <= 0) {
        return false;
      }

      return true;
    })
    .sort((a, b) => {
      const priceA = a.discount_price ?? a.price;
      const priceB = b.discount_price ?? b.price;

      if (sortBy === "price-asc") {
        return priceA - priceB;
      }
      if (sortBy === "price-desc") {
        return priceB - priceA;
      }
      if (sortBy === "rating") {
        return b.rating - a.rating;
      }
      // "recent"
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  if (isLoading) {
    // The catalog streams in after the products fetch resolves. A centered
    // `min-h-[60vh]` spinner holds none of the real page's height, so when the
    // grid swapped in it pushed the footer (and every painted pixel below the
    // header) down ~670px — the last measurable layout shift on /shop. The
    // skeleton mirrors the real page chrome and reserves the same grid rows of
    // aspect-square cards, so the swap cannot move anything. It never reserves
    // more than the catalog itself would occupy.
    return <ShopSkeleton title={t.shopTitle} intro={t.shopIntro} filtersLabel={t.filters} />;
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Social recommendations. Hidden entirely when there is no social signal,
          and never shown alongside an active search or filter, where it would
          contradict what the customer actually asked for. */}
      {!search && !selectedCategory && !selectedSession && !minPrice && !maxPrice ? (
        <SocialRecommendationsRail />
      ) : null}

      {/* Title */}
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">{t.shopTitle}</h1>
        {selectedSession && selectedSessionName ? (
          <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-4 py-1.5 text-sm font-semibold text-foreground">
            <span className="h-2 w-2 rounded-full bg-primary" aria-hidden />
            Collection : {selectedSessionName}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t.shopIntro}</p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-4">
        
        {/* FILTERS PANEL (Sidebar) */}
        <aside className="space-y-6 rounded-2xl border border-border/50 bg-card p-5 shadow-sm h-fit">
          <div className="flex items-center justify-between border-b border-border/40 pb-3">
            <h3 className="font-bold text-base flex items-center gap-2">
              <SlidersHorizontal className="h-4.5 w-4.5" />
              {t.filters}
            </h3>
            <button
              onClick={handleClearFilters}
              className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
            >
              <RotateCcw className="h-3 w-3" />
              {t.reset}
            </button>
          </div>

          {/* Search Input */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t.search}</label>
            <div className="relative">
              <Search className="absolute top-2.5 left-3 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder={t.searchPlaceholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full h-9 rounded-lg border border-border bg-background pl-9 pr-3 text-xs outline-none focus:border-foreground"
              />
            </div>
          </div>

          {/* Category Dropdown */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t.category}</label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs outline-none focus:border-foreground"
            >
              <option value="">{t.allCategories}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.slug}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Price Range inputs */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t.price}</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                placeholder={t.min}
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value)}
                className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs outline-none focus:border-foreground"
              />
              <span className="text-muted-foreground text-xs">{t.to}</span>
              <input
                type="number"
                placeholder={t.max}
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
                className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs outline-none focus:border-foreground"
              />
            </div>
          </div>

          {/* Availability Toggle */}
          <div className="flex items-center justify-between py-2 border-t border-b border-border/40">
            <span className="text-xs font-semibold text-foreground">{t.inStockOnly}</span>
            <input
              type="checkbox"
              checked={inStockOnly}
              onChange={(e) => setInStockOnly(e.target.checked)}
              className="h-4.5 w-4.5 rounded border-border text-primary focus:ring-ring"
            />
          </div>

          {/* Sort selection */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t.sortBy}</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs outline-none focus:border-foreground"
            >
              <option value="recent">{t.recent}</option><option value="price-asc">{t.priceAsc}</option><option value="price-desc">{t.priceDesc}</option><option value="rating">{t.topRated}</option>
            </select>
          </div>
        </aside>

        {/* PRODUCTS GRID */}
        <div className="lg:col-span-3">
          {filteredProducts.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-16 px-4 text-center space-y-4">
              <PackageX className="h-12 w-12 text-muted-foreground" />
              <h3 className="text-lg font-bold">{t.noProducts}</h3>
              <p className="text-xs sm:text-sm text-muted-foreground max-w-xs">
                {t.noProductsBody}
              </p>
              <button
                onClick={handleClearFilters}
                className="rounded-full bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/95 transition-colors"
              >
                {t.resetFilters}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {filteredProducts.map((product) => {
                const finalPrice = product.discount_price ?? product.price;
                const hasDiscount = !!product.discount_price;
                return (
                  <Link
                    key={product.id}
                    href={`/product/${product.slug}`}
                    className="group flex flex-col rounded-2xl border border-border/60 bg-card overflow-hidden transition-all hover:shadow-md"
                  >
                    <div className="relative aspect-square overflow-hidden bg-muted">
                      <ProductImage
                        src={product.images[0]}
                        alt={product.name}
                        fill
                        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                        className="object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                      {hasDiscount && (
                        <span className="absolute top-3 left-3 rounded-full bg-destructive px-2.5 py-1 text-[10px] font-bold text-destructive-foreground">
                          {t.promotion}
                        </span>
                      )}
                      {product.stock_quantity <= 3 && (
                        <span className="absolute top-3 right-3 rounded-full bg-amber-500 px-2.5 py-1 text-[10px] font-bold text-white">
                          {t.lowStock}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-col flex-1 p-4 space-y-2">
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                        {product.brand}
                      </span>
                      <h3 className="font-bold text-sm text-foreground line-clamp-1 group-hover:underline">
                        {product.name}
                      </h3>

                      {/* Rating */}
                      <div className="flex items-center gap-1">
                        <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                        <span className="text-xs font-semibold text-foreground">{product.rating}</span>
                      </div>

                      {/* Price */}
                      <div className="flex items-baseline gap-2 pt-1 mt-auto">
                        <span className="text-base font-extrabold text-foreground">{finalPrice} $</span>
                        {hasDiscount && (
                          <span className="text-xs text-muted-foreground line-through">{product.price} $</span>
                        )}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

export default function ShopPage() {
  return (
    <Suspense fallback={<ShopSkeleton title="" intro="" filtersLabel="" />}>
      <ShopContent />
    </Suspense>
  );
}
