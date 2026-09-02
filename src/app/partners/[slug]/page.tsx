"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, MapPin, Package, Star, Store } from "lucide-react";
import { PartnerShop, Product } from "../../../types";
import { getPartnerShopBySlug, getShopProducts } from "../../../services/db/partner-shops";
import { getProducts } from "../../../services/db/products";
import { ProductImage } from "../../../components/shared/ProductImage";
import { useLanguage } from "../../../context/LanguageContext";

export default function PartnerShopPage() {
  const params = useParams();
  const router = useRouter();
  const { t } = useLanguage();
  const slug = params.slug as string;

  const [shop, setShop] = useState<PartnerShop | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    async function load() {
      try {
        const found = await getPartnerShopBySlug(slug);
        if (!found || found.status !== "active") {
          router.push("/partners");
          return;
        }
        const [shopProductRows, allProducts] = await Promise.all([
          getShopProducts(found.id),
          getProducts(),
        ]);
        if (cancelled) return;
        const byId = new Map(allProducts.map((product) => [product.id, product]));
        const orderedProducts = shopProductRows
          .filter((row) => row.is_visible)
          .sort((a, b) => a.display_order - b.display_order)
          .map((row) => byId.get(row.product_id))
          .filter((product): product is Product => Boolean(product));
        setShop(found);
        setProducts(orderedProducts);
      } catch {
        if (!cancelled) router.push("/partners");
        return;
      }
      if (!cancelled) setIsLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [slug, router]);

  if (isLoading || !shop) {
    return (
      <main className="mx-auto max-w-6xl py-10">
        <div className="py-20 text-center text-sm text-muted-foreground">{t.shopLoading}</div>
      </main>
    );
  }

  const displayName = shop.shop_name?.trim() || shop.business_name;
  const displayDescription = shop.shop_description?.trim() || shop.description;

  return (
    <main className="mx-auto max-w-6xl space-y-8 py-8">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 text-white shadow-lg">
        {shop.banner_image_url && (
          <ProductImage
            src={shop.banner_image_url}
            alt=""
            fill
            sizes="100vw"
            className="object-cover opacity-40"
          />
        )}
        <div className="relative space-y-3 p-7 sm:p-10">
          <Link href="/partners" className="inline-flex items-center gap-1 text-xs font-semibold text-white/80 hover:text-white">
            <ArrowLeft className="h-3.5 w-3.5" />
            {t.allShops}
          </Link>
          <div className="flex items-center gap-2">
            <Store className="h-5 w-5" />
            <h1 className="text-3xl font-extrabold sm:text-4xl">{displayName}</h1>
            {shop.is_featured && (
              <span className="rounded-full bg-white/20 px-2.5 py-1 text-[10px] font-bold">{t.partnerFeatured}</span>
            )}
          </div>
          {shop.city && (
            <p className="flex items-center gap-1 text-sm text-white/90">
              <MapPin className="h-4 w-4" />
              {shop.city}, {shop.province}
            </p>
          )}
          {displayDescription && (
            <p className="max-w-2xl text-sm leading-relaxed text-white/90">{displayDescription}</p>
          )}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">{t.shopProducts}</h2>
          <span className="text-sm text-muted-foreground">{products.length} {t.items}</span>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {products.map((product) => {
            const finalPrice = product.discount_price ?? product.price;
            const hasDiscount = !!product.discount_price;
            return (
              <Link
                key={product.id}
                href={`/product/${product.slug}`}
                className="group flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-card transition-all hover:shadow-md"
              >
                <div className="relative aspect-square overflow-hidden bg-muted">
                  {product.images[0] ? (
                    <ProductImage
                      src={product.images[0]}
                      alt={product.name}
                      fill
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                      className="object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div aria-hidden className="absolute inset-0 flex items-center justify-center bg-muted">
                      <Package className="h-8 w-8 text-muted-foreground/50" />
                    </div>
                  )}
                  {hasDiscount && (
                    <span className="absolute top-3 left-3 rounded-full bg-destructive px-2.5 py-1 text-[10px] font-bold text-destructive-foreground">
                      {t.promotion}
                    </span>
                  )}
                </div>
                <div className="flex flex-1 flex-col space-y-2 p-4">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {product.brand}
                  </span>
                  <h3 className="text-sm font-bold text-foreground line-clamp-1 group-hover:underline">
                    {product.name}
                  </h3>
                  <div className="flex items-center gap-1">
                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                    <span className="text-xs font-semibold text-foreground">{product.rating}</span>
                  </div>
                  <div className="mt-auto flex items-baseline gap-2">
                    <span className="font-bold text-foreground">{finalPrice} $</span>
                    {hasDiscount && (
                      <span className="text-xs text-muted-foreground line-through">{product.price} $</span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
        {products.length === 0 && (
          <p className="mt-4 rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">
            {t.shopProductsEmpty}
          </p>
        )}
      </section>
    </main>
  );
}
