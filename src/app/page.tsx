"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { getProducts, getCategories } from "../services/db/products";
import { getSessions } from "../services/db/sessions";
import { Product, Category, StoreSession } from "../types";
import { 
  Truck, 
  Banknote, 
  ShieldAlert, 
  ArrowRight, 
  Star,
  ChevronRight,
  MessageSquare,
  Sparkles,
  Zap,
  Package
} from "lucide-react";
import { ProductImage } from "../components/shared/ProductImage";
import { useLanguage } from "../context/LanguageContext";

export default function HomePage() {
  const { t } = useLanguage();
  const [categories, setCategories] = useState<Category[]>([]);
  const [sessions, setSessions] = useState<StoreSession[]>([]);
  const [featuredProducts, setFeaturedProducts] = useState<Product[]>([]);
  const [bestSellers, setBestSellers] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        const [cats, sess, prods] = await Promise.all([getCategories(), getSessions(), getProducts()]);
        setCategories(cats);
        setSessions(sess);
        setFeaturedProducts(prods.filter(p => p.is_featured).slice(0, 4));
        setBestSellers(prods.filter(p => p.is_best_seller).slice(0, 4));
      } catch (err) {
        console.error("Error loading homepage data:", err);
        setLoadError(t.shopLoadError);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, []);

  const testimonials = [
    {
      name: "Pascaline Kahindo",
      role: t.testimonial1Role,
      text: t.testimonial1Text,
      rating: 5
    },
    {
      name: "Christian Balume",
      role: t.testimonial2Role,
      text: t.testimonial2Text,
      rating: 5
    },
    {
      name: "Ephrem Birindwa",
      role: t.testimonial3Role,
      text: t.testimonial3Text,
      rating: 5
    }
  ];

  const faqs = [
    { q: t.faq1Q, a: t.faq1A },
    { q: t.faq2Q, a: t.faq2A },
    { q: t.faq3Q, a: t.faq3A },
    { q: t.faq4Q, a: t.faq4A }
  ];

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center space-y-4">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
        <p className="text-sm text-muted-foreground">{t.loadingShop}</p>
      </div>
    );
  }

  if (loadError) {
    return <div role="alert" className="mx-auto flex min-h-[50vh] max-w-xl flex-col items-center justify-center gap-4 text-center"><h1 className="text-2xl font-bold">{t.shopUnavailable}</h1><p className="text-sm text-muted-foreground">{loadError}</p><button onClick={() => window.location.reload()} className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground">{t.retry}</button></div>;
  }

  return (
    <div className="space-y-20 pb-16 animate-fade-in">
      
      {/* 1. HERO SECTION */}
      <section className="relative overflow-hidden rounded-3xl bg-neutral-950 text-white py-24 px-8 sm:px-12 lg:px-16 shadow-2xl border border-white/5">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,rgba(212,175,55,0.15),transparent_60%)]"></div>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.05),transparent_45%)]"></div>
        
        <div className="relative max-w-2xl space-y-8">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-gold/10 px-4 py-1.5 text-xs font-medium text-gold border border-gold/20 backdrop-blur-md">
            <Sparkles className="h-3.5 w-3.5" />
            {t.heroPremiumDelivery}
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-7xl font-light tracking-tighter leading-[1.1]">
            {t.heroTitle} <br />
            <span className="font-bold bg-clip-text text-transparent bg-gradient-to-r from-gold via-gold-muted to-white">
              {t.heroTitleHighlight}
            </span>
          </h1>

          <p className="text-sm sm:text-base lg:text-lg text-neutral-400 max-w-lg leading-relaxed font-light">
            {t.heroDescription}
          </p>

          <div className="flex flex-wrap gap-4 pt-4">
            <Link
              href="/shop"
              className="inline-flex items-center gap-2 rounded-full bg-white text-black px-6 py-3 text-sm font-semibold hover:bg-neutral-100 transition-colors shadow-lg"
            >
              {t.heroDiscoverShop}
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/about"
              className="inline-flex items-center gap-2 rounded-full bg-white/10 text-white border border-white/20 px-6 py-3 text-sm font-semibold hover:bg-white/20 transition-colors"
            >
              {t.heroHowItWorks}
            </Link>
          </div>
        </div>

        {/* Feature badges absolute container (Desktop only) */}
        <div className="hidden lg:absolute lg:bottom-12 lg:right-16 lg:flex lg:flex-col lg:space-y-3">
          <div className="flex items-center gap-4 rounded-2xl bg-black/40 border border-white/10 px-5 py-4 shadow-xl backdrop-blur-xl">
            <div className="bg-gold/10 p-2 rounded-full">
              <Truck className="h-5 w-5 text-gold" />
            </div>
            <div className="text-xs">
              <p className="font-medium text-white uppercase tracking-wider text-[10px]">{t.heroDeliveryZero}</p>
              <p className="text-neutral-400">{t.heroDeliveryEverywhere}</p>
            </div>
          </div>
          <div className="flex items-center gap-4 rounded-2xl bg-black/40 border border-white/10 px-5 py-4 shadow-xl backdrop-blur-xl">
            <div className="bg-gold/10 p-2 rounded-full">
              <Banknote className="h-5 w-5 text-gold" />
            </div>
            <div className="text-xs">
              <p className="font-medium text-white uppercase tracking-wider text-[10px]">{t.heroCashOnDelivery}</p>
              <p className="text-neutral-400">{t.heroPaymentAfterVerification}</p>
            </div>
          </div>
        </div>
      </section>

      {/* 2. CATEGORIES SECTION */}
      <section className="space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">{t.categoriesTitle}</h2>
            <p className="text-sm text-muted-foreground">{t.categoriesSubtitle}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((cat) => (
            <Link
              key={cat.id}
              href={`/shop?category=${cat.slug}`}
              className="group relative h-64 overflow-hidden rounded-2xl border border-border/60 shadow-sm transition-all hover:shadow-md"
            >
              {cat.image_url ? <ProductImage src={cat.image_url} alt={cat.name} fill sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw" className="object-cover transition-transform duration-700 group-hover:scale-105" /> : <div aria-hidden className="absolute inset-0 bg-gradient-to-br from-neutral-800 to-neutral-950" />}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent"></div>
              <div className="absolute bottom-6 left-6 text-white space-y-1">
                <h3 className="text-xl font-bold">{cat.name}</h3>
                <p className="text-xs text-neutral-200 line-clamp-1">{cat.description}</p>
                <div className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400 pt-1 group-hover:underline">
                  {t.viewItems}
                  <ChevronRight className="h-3 w-3" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* 2b. COLLECTIONS / SESSIONS RAIL */}
      {sessions.length > 0 && (
        <section className="space-y-6">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">{t.collectionsTitle}</h2>
              <p className="text-sm text-muted-foreground">{t.collectionsSubtitle}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {sessions.map((session) => (
              <Link
                key={session.id}
                href={`/shop?session=${session.slug}`}
                className="group flex flex-col justify-center rounded-2xl border border-border/60 bg-card p-6 text-left shadow-sm transition-all hover:shadow-md hover:border-primary/40"
              >
                <span className="text-sm font-bold text-foreground line-clamp-1 group-hover:underline">{session.name}</span>
                {session.description && <span className="mt-1 text-xs text-muted-foreground line-clamp-2">{session.description}</span>}
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary">
                  {t.viewCollection}
                  <ChevronRight className="h-3 w-3" />
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 3. PROMOTIONAL SOLAR BANNER */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-emerald-600 to-teal-800 text-white p-8 sm:p-12 shadow-xl">
        <div className="absolute top-0 right-0 h-64 w-64 -translate-y-16 translate-x-16 rounded-full bg-white/5 blur-3xl"></div>
        <div className="relative max-w-xl space-y-4">
          <div className="inline-flex items-center gap-1 rounded-full bg-amber-400/20 border border-amber-400/30 px-3 py-1 text-xs font-semibold text-amber-300">
            <Zap className="h-3.5 w-3.5 fill-amber-300" />
            {t.solarSolution}
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{t.solarTitle}</h2>
          <p className="text-sm sm:text-base text-emerald-50 max-w-md leading-relaxed">
            {t.solarDescription}
          </p>
          <div className="pt-2">
            <Link
              href="/shop?category=maison-energie"
              className="inline-flex items-center gap-2 rounded-full bg-white text-emerald-800 px-6 py-2.5 text-xs sm:text-sm font-semibold hover:bg-emerald-50 transition-colors shadow-lg"
            >
              {t.solarEquipHome}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* 4. FEATURED PRODUCTS */}
      <section className="space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">{t.featuredProducts}</h2>
            <p className="text-sm text-muted-foreground">{t.featuredProductsSubtitle}</p>
          </div>
          <Link href="/shop" className="text-sm font-semibold text-primary hover:underline flex items-center gap-1">
            {t.viewAll}
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {featuredProducts.map((product) => {
            const finalPrice = product.discount_price ?? product.price;
            const hasDiscount = !!product.discount_price;
            return (
              <Link
                key={product.id}
                href={`/product/${product.slug}`}
                className="group flex flex-col rounded-2xl border border-border/60 bg-card overflow-hidden transition-all hover:shadow-md"
              >
                <div className="relative aspect-square overflow-hidden bg-muted">
                  {product.images[0] ? <ProductImage src={product.images[0]} alt={product.name} fill sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 25vw" className="object-cover transition-transform duration-500 group-hover:scale-105" /> : <div aria-hidden className="absolute inset-0 bg-muted" />}
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
      </section>

      {/* 5. CUSTOMER TESTIMONIALS */}
      <section className="space-y-8 rounded-3xl bg-muted/40 border border-border/40 py-12 px-6 sm:px-12">
        <div className="text-center max-w-xl mx-auto space-y-2">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">{t.testimonialsTitle}</h2>
          <p className="text-sm text-muted-foreground">{t.testimonialsSubtitle}</p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {testimonials.map((item, index) => (
            <div key={index} className="flex flex-col bg-card border border-border/40 p-6 rounded-2xl shadow-sm space-y-4">
              <div className="flex gap-0.5">
                {[...Array(item.rating)].map((_, i) => (
                  <Star key={i} className="h-4 w-4 fill-amber-400 text-amber-400" />
                ))}
              </div>
              <p className="text-xs sm:text-sm text-muted-foreground italic flex-1 leading-relaxed">
                "{item.text}"
              </p>
              <div>
                <h4 className="font-bold text-sm text-foreground">{item.name}</h4>
                <p className="text-[10px] text-muted-foreground">{item.role}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 6. FAQ SECTION */}
      <section className="max-w-3xl mx-auto space-y-8">
        <div className="text-center space-y-2">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">{t.faqTitle}</h2>
          <p className="text-sm text-muted-foreground">{t.faqSubtitle}</p>
        </div>

        <div className="space-y-4">
          {faqs.map((faq, index) => (
            <div key={index} className="border border-border/60 bg-card rounded-2xl p-5 shadow-sm space-y-2">
              <h3 className="font-bold text-sm sm:text-base text-foreground flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-primary"></span>
                {faq.q}
              </h3>
              <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed pl-4">
                {faq.a}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* 7. NEWSLETTER SECTION */}
      <section className="text-center rounded-3xl bg-neutral-950 text-white py-12 px-6 sm:px-12 space-y-6">
        <div className="max-w-md mx-auto space-y-2">
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight">{t.newsletterTitle}</h2>
          <p className="text-xs sm:text-sm text-neutral-300">
            {t.newsletterSubtitle}
          </p>
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); alert(t.newsletterThanks); }}
          className="mx-auto flex max-w-md gap-2 rounded-full bg-white/5 border border-white/10 p-1"
        >
          <input
            type="email"
            placeholder={t.yourEmail}
            required
            className="flex-1 bg-transparent px-4 py-2 text-xs sm:text-sm text-white placeholder-neutral-400 outline-none"
          />
          <button
            type="submit"
            className="rounded-full bg-white text-black px-4 sm:px-6 py-2 text-xs font-semibold hover:bg-neutral-100 transition-colors"
          >
            {t.subscribe}
          </button>
        </form>
      </section>

    </div>
  );
}
