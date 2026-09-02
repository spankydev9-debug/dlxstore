"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, MapPin, Store } from "lucide-react";
import { PartnerShop } from "../../types";
import { getPartnerShops } from "../../services/db/partner-shops";
import { ProductImage } from "../../components/shared/ProductImage";
import { useLanguage } from "../../context/LanguageContext";

export default function PartnersPage() {
  const { t } = useLanguage();
  const [shops, setShops] = useState<PartnerShop[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    getPartnerShops()
      .then((nextShops) => setShops(nextShops))
      .catch(() => setError(t.partnersError))
      .finally(() => setLoading(false));
  }, [t.partnersError]);

  const sortedShops = useMemo(
    () => [...shops].sort((a, b) => Number(b.is_featured) - Number(a.is_featured)),
    [shops]
  );

  return (
    <main className="mx-auto max-w-6xl space-y-10 py-10">
      <section className="rounded-3xl bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 p-7 text-white shadow-lg sm:p-10">
        <div className="max-w-2xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/20 px-3 py-1 text-xs font-bold">
            <Store className="h-4 w-4" />
            {t.partnersBadge}
          </div>
          <h1 className="text-3xl font-extrabold sm:text-5xl">{t.partnersTitle}</h1>
          <p className="mt-3 text-sm leading-relaxed text-white/90 sm:text-base">
            {t.partnersSubtitle}
          </p>
        </div>
      </section>

      {loading ? (
        <div className="py-20 text-center text-sm text-muted-foreground">{t.partnersLoading}</div>
      ) : error ? (
        <div role="alert" className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">{error}</div>
      ) : (
        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">{t.partnersActive}</h2>
            <span className="text-sm text-muted-foreground">{sortedShops.length} {t.shopsUnit}</span>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sortedShops.map((shop) => {
              const displayName = shop.shop_name?.trim() || shop.business_name;
              const displayDescription = shop.shop_description?.trim() || shop.description;
              return (
                <Link
                  key={shop.id}
                  href={`/partners/${shop.slug}`}
                  className="group flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="relative aspect-[16/9] overflow-hidden bg-muted">
                    {shop.shop_image_url || shop.banner_image_url ? (
                      <ProductImage
                        src={shop.shop_image_url ?? shop.banner_image_url}
                        alt={displayName}
                        fill
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                        className="object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    ) : (
                      <div aria-hidden className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-indigo-600 to-fuchsia-600">
                        <Store className="h-10 w-10 text-white/70" />
                      </div>
                    )}
                    {shop.is_featured && (
                      <span className="absolute top-3 left-3 rounded-full bg-primary px-2.5 py-1 text-[10px] font-bold text-primary-foreground">
                        {t.partnerFeatured}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col p-5">
                    <h3 className="font-bold group-hover:underline">{displayName}</h3>
                    {shop.city && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="h-3.5 w-3.5" />
                        {shop.city}, {shop.province}
                      </p>
                    )}
                    {displayDescription && (
                      <p className="mt-2 text-sm text-muted-foreground line-clamp-2">{displayDescription}</p>
                    )}
                    <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-primary">
                      {t.visitShop}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
          {sortedShops.length === 0 && (
            <p className="mt-4 rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">
              {t.partnersEmpty}
            </p>
          )}
        </section>
      )}

      <section className="rounded-2xl border border-border bg-card p-6 text-center">
        <p className="text-sm text-muted-foreground">
          {t.partnersCta}
        </p>
        <Link href="/partner" className="mt-3 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground">
          {t.partner}
          <ArrowRight className="h-4 w-4" />
        </Link>
      </section>
    </main>
  );
}
