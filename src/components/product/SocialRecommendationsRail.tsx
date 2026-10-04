"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, TrendingUp } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useLanguage } from "../../context/LanguageContext";
import { getSocialRecommendations } from "../../services/db/social-commerce";
import type { SocialRecommendation } from "../../types";
import { ProductImage } from "../shared/ProductImage";

/**
 * "Popular with your circle" rail.
 *
 * Recommendations come from what people you follow or are friends with actually
 * bought or saved, and every card states its reason. The reason is not decoration:
 * a recommendation with no stated cause is a black box, and in a market where
 * DLXSTORE is a new brand, an unexplained suggestion is worth less than none.
 *
 * Renders nothing when there is no social signal, when the customer is signed out,
 * or when the migration is not applied. A rail that cannot explain itself is
 * better left off the page than shown empty.
 */
export function SocialRecommendationsRail({ limit = 8 }: { limit?: number }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [items, setItems] = useState<SocialRecommendation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // A recommendation is personal, so there is nothing to show signed out.
    if (!user) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void getSocialRecommendations(limit)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch(() => {
        // Recommendations are an enhancement; a failure hides the rail rather
        // than surfacing an error on a shopping page.
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [limit, user]);

  if (loading || items.length === 0) return null;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-foreground">
          <Sparkles className="h-5 w-5 text-primary" />
          {t.socialRecommendationTitle}
        </h2>
      </div>

      {/* Horizontally scrollable on mobile, grid on desktop: same content, no
          reduced version. */}
      <div className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-4">
        {items.map((item) => {
          const finalPrice = item.discount_price ?? item.price;
          const hasDiscount = item.discount_price !== null;
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
              </div>
              <div className="flex flex-1 flex-col gap-1 p-3">
                <span className="inline-flex w-fit items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                  <TrendingUp className="h-2.5 w-2.5" />
                  {item.reason === "bought_by_friends"
                    ? t.socialRecommendationBought
                    : t.socialRecommendationSaved}
                </span>
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
