"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Clock, Compass, Flame, Loader2, Shirt, UtensilsCrossed } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useLanguage } from "../../context/LanguageContext";
import { getRecentlyViewed, getTrending } from "../../services/db/discover";
import type { DiscoverItem } from "../../types";
import { ProductImage } from "../../components/shared/ProductImage";

/**
 * DLX Discover (master roadmap area 14).
 *
 * The one place a returning customer can pick up where they left off and see what
 * is actually moving, instead of re-searching the catalogue for something they
 * already looked at.
 *
 * Every rail degrades independently: no social graph, an unapplied migration or a
 * network failure removes one rail, never the page. A rail with nothing to show
 * renders nothing rather than an empty shelf.
 */
export default function DiscoverPage() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [recent, setRecent] = useState<DiscoverItem[]>([]);
  const [trending, setTrending] = useState<DiscoverItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    // Recently-viewed is per-customer; trending works signed out.
    const [recentRows, trendingRows] = await Promise.all([
      user ? getRecentlyViewed(12).catch(() => []) : Promise.resolve([]),
      getTrending(12).catch(() => []),
    ]);
    setRecent(recentRows);
    setTrending(trendingRows);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const isEmpty = !loading && recent.length === 0 && trending.length === 0;

  return (
    <div className="space-y-10 animate-fade-in">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-extrabold tracking-tight text-foreground">
          <Compass className="h-7 w-7 text-primary" />
          {t.discoverTitle}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.discoverIntro}</p>
      </div>

      {user ? (
        <section className="relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-amber-400/25 bg-gradient-to-br from-[#191622] via-card to-card p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-amber-400/70 to-transparent" />
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
              <Shirt className="h-4 w-4 text-[#d4af37]" />
              {t.discoverAtelierTitle}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{t.discoverAtelierBody}</p>
          </div>
          <Link
            href="/studio"
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 self-start rounded-full bg-gradient-to-r from-[#e6c65a] to-[#c39c22] px-5 text-sm font-bold text-black shadow-[0_14px_36px_-16px_rgba(212,175,55,0.9)] transition-opacity hover:opacity-95 sm:self-auto"
          >
            <Shirt className="h-4 w-4" aria-hidden />
            {t.discoverAtelierCta}
          </Link>
        </section>
      ) : null}

      {loading ? (
        <p className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t.loading}
        </p>
      ) : isEmpty ? (
        <div className="rounded-2xl border border-border/50 bg-muted/20 p-6 text-center">
          <p className="text-sm text-muted-foreground">{t.discoverEmpty}</p>
          <Link
            href="/shop"
            className="mt-4 inline-flex h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground"
          >
            {t.discoverBrowseCatalogue}
          </Link>
        </div>
      ) : null}

      {recent.length > 0 ? (
        <DiscoverRail
          title={t.discoverRecentlyViewed}
          icon={<Clock className="h-5 w-5 text-primary" />}
          items={recent}
        />
      ) : null}

      {trending.length > 0 ? (
        <DiscoverRail
          title={user ? t.discoverTrendingForYou : t.discoverTrending}
          icon={<Flame className="h-5 w-5 text-primary" />}
          items={trending}
        />
      ) : null}
    </div>
  );
}

/**
 * One horizontal rail of products.
 *
 * Scroll-snap on mobile, grid on desktop: the same products and the same affordances
 * on both, never a reduced version.
 */
function DiscoverRail({
  title,
  icon,
  items,
}: {
  title: string;
  icon: React.ReactNode;
  items: DiscoverItem[];
}) {
  const { t } = useLanguage();
  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-foreground">
        {icon}
        {title}
      </h2>

      <div className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-4">
        {items.map((item) => {
          const finalPrice = item.discount_price ?? item.price;
          const hasDiscount = item.discount_price !== null;
          const isFood = item.product_type === "food";
          return (
            <Link
              key={item.id}
              href={`/product/${item.slug}`}
              className="group flex w-40 shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-border/60 bg-card transition-all hover:shadow-md sm:w-auto"
            >
              <div className="relative aspect-square overflow-hidden bg-muted">
                <ProductImage
                  src={item.image_url ?? ""}
                  alt={item.name}
                  fill
                  sizes="(max-width: 640px) 40vw, (max-width: 1024px) 30vw, 25vw"
                  className="object-cover transition-transform duration-300 group-hover:scale-105"
                />
                {isFood ? (
                  <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-background/90 px-2 py-0.5 text-[10px] font-bold text-foreground">
                    <UtensilsCrossed className="h-2.5 w-2.5" />
                    {t.discoverFood}
                  </span>
                ) : null}
              </div>
              <div className="flex flex-1 flex-col gap-1 p-3">
                <h3 className="line-clamp-1 text-xs font-bold text-foreground group-hover:underline">
                  {item.name}
                </h3>
                <div className="mt-auto flex items-baseline gap-1.5 pt-1">
                  <span className="text-sm font-extrabold text-foreground">{finalPrice} $</span>
                  {hasDiscount ? (
                    <span className="text-[10px] text-muted-foreground line-through">
                      {item.price} $
                    </span>
                  ) : null}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
