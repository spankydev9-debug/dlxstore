"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { getProducts, getCategories } from "../services/db/products";
import { Product, Category } from "../types";
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

export default function HomePage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [featuredProducts, setFeaturedProducts] = useState<Product[]>([]);
  const [bestSellers, setBestSellers] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        const [cats, prods] = await Promise.all([getCategories(), getProducts()]);
        setCategories(cats);
        setFeaturedProducts(prods.filter(p => p.is_featured).slice(0, 4));
        setBestSellers(prods.filter(p => p.is_best_seller).slice(0, 4));
      } catch (err) {
        console.error("Error loading homepage data:", err);
        setLoadError("Impossible de charger la boutique. Vérifiez votre connexion puis réessayez.");
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, []);

  const testimonials = [
    {
      name: "Pascaline Kahindo",
      role: "Entrepreneuse, Keshero",
      text: "J'ai acheté la station solaire EcoFlow pour ma boutique. La livraison était totalement gratuite jusqu'à ma porte et j'ai payé en espèces après avoir testé l'appareil. Un service de confiance rare à Goma !",
      rating: 5
    },
    {
      name: "Christian Balume",
      role: "Étudiant, Himbi",
      text: "Le MacBook Air est arrivé scellé et en parfait état. Le fait de pouvoir vérifier la marchandise avant de donner l'argent au livreur rassure énormément. Je recommande DLXSTORE à 100%.",
      rating: 5
    },
    {
      name: "Ephrem Birindwa",
      role: "Enseignant, Ndosho",
      text: "La livraison à Ndosho s'est faite le jour même de la commande. Les baskets Nike sont originales et très confortables pour mes déplacements quotidiens.",
      rating: 5
    }
  ];

  const faqs = [
    {
      q: "Comment fonctionne la livraison gratuite à Goma ?",
      a: "La livraison est 100% gratuite dans tous les quartiers de Goma (Himbi, Keshero, Katindo, Ndosho, Mugunga, Majengo, Mabanga, Bujovu, etc.). Une fois votre commande passée, un livreur vous contactera par téléphone pour convenir de l'heure exacte de livraison."
    },
    {
      q: "Comment puis-je payer mes articles ?",
      a: "Chez DLXSTORE, nous utilisons exclusivement le paiement à la livraison (Cash on Delivery). Vous payez en dollars américains (USD) ou en francs congolais (CDF) directement au livreur, après avoir vérifié et essayé vos produits."
    },
    {
      q: "Comment contacter DLXSTORE ?",
      a: "Les canaux officiels de DLXSTORE sont publiés dans la page Contact dès qu’ils sont configurés par l’équipe."
    },
    {
      q: "Que faire si un article ne me convient pas ?",
      a: "Vous pouvez refuser l'article directement auprès du livreur lors de la présentation. Consultez la page Contact pour les canaux de support officiels."
    }
  ];

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center space-y-4">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
        <p className="text-sm text-muted-foreground">Chargement de votre boutique à Goma...</p>
      </div>
    );
  }

  if (loadError) {
    return <div role="alert" className="mx-auto flex min-h-[50vh] max-w-xl flex-col items-center justify-center gap-4 text-center"><h1 className="text-2xl font-bold">La boutique est indisponible</h1><p className="text-sm text-muted-foreground">{loadError}</p><button onClick={() => window.location.reload()} className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground">Réessayer</button></div>;
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
            Livraison premium dans tout Goma
          </div>
          
          <h1 className="text-4xl sm:text-5xl lg:text-7xl font-light tracking-tighter leading-[1.1]">
            Achetez Malin. <br />
            <span className="font-bold bg-clip-text text-transparent bg-gradient-to-r from-gold via-gold-muted to-white">
              Payez à la Livraison.
            </span>
          </h1>
          
          <p className="text-sm sm:text-base lg:text-lg text-neutral-400 max-w-lg leading-relaxed font-light">
            Profitez d'une sélection premium de téléphones, de mode et de solutions d'énergie solaire. Payez en espèces uniquement après réception et vérification de votre colis.
          </p>
          
          <div className="flex flex-wrap gap-4 pt-4">
            <Link
              href="/shop"
              className="inline-flex items-center gap-2 rounded-full bg-white text-black px-6 py-3 text-sm font-semibold hover:bg-neutral-100 transition-colors shadow-lg"
            >
              Découvrir la boutique
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/about"
              className="inline-flex items-center gap-2 rounded-full bg-white/10 text-white border border-white/20 px-6 py-3 text-sm font-semibold hover:bg-white/20 transition-colors"
            >
              Comment ça marche ?
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
              <p className="font-medium text-white uppercase tracking-wider text-[10px]">Livraison 0 $</p>
              <p className="text-neutral-400">Partout à Goma</p>
            </div>
          </div>
          <div className="flex items-center gap-4 rounded-2xl bg-black/40 border border-white/10 px-5 py-4 shadow-xl backdrop-blur-xl">
            <div className="bg-gold/10 p-2 rounded-full">
              <Banknote className="h-5 w-5 text-gold" />
            </div>
            <div className="text-xs">
              <p className="font-medium text-white uppercase tracking-wider text-[10px]">Cash on Delivery</p>
              <p className="text-neutral-400">Paiement après vérification</p>
            </div>
          </div>
        </div>
      </section>

      {/* 2. CATEGORIES SECTION */}
      <section className="space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Parcourir par catégorie</h2>
            <p className="text-sm text-muted-foreground">Trouvez rapidement ce dont vous avez besoin au meilleur prix.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((cat) => (
            <Link
              key={cat.id}
              href={`/shop?category=${cat.slug}`}
              className="group relative h-64 overflow-hidden rounded-2xl border border-border/60 shadow-sm transition-all hover:shadow-md"
            >
              {cat.image_url ? <Image src={cat.image_url} alt={cat.name} fill sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw" className="object-cover transition-transform duration-700 group-hover:scale-105" /> : <div aria-hidden className="absolute inset-0 bg-gradient-to-br from-neutral-800 to-neutral-950" />}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent"></div>
              <div className="absolute bottom-6 left-6 text-white space-y-1">
                <h3 className="text-xl font-bold">{cat.name}</h3>
                <p className="text-xs text-neutral-200 line-clamp-1">{cat.description}</p>
                <div className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400 pt-1 group-hover:underline">
                  Voir les articles
                  <ChevronRight className="h-3 w-3" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* 3. PROMOTIONAL SOLAR BANNER */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-emerald-600 to-teal-800 text-white p-8 sm:p-12 shadow-xl">
        <div className="absolute top-0 right-0 h-64 w-64 -translate-y-16 translate-x-16 rounded-full bg-white/5 blur-3xl"></div>
        <div className="relative max-w-xl space-y-4">
          <div className="inline-flex items-center gap-1 rounded-full bg-amber-400/20 border border-amber-400/30 px-3 py-1 text-xs font-semibold text-amber-300">
            <Zap className="h-3.5 w-3.5 fill-amber-300" />
            Solution Énergie
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Coupures de courant à Goma ?</h2>
          <p className="text-sm sm:text-base text-emerald-50 max-w-md leading-relaxed">
            Dites adieu aux délestages. Explorez nos stations solaires portables EcoFlow et nos lanternes LED rechargeables haute autonomie.
          </p>
          <div className="pt-2">
            <Link
              href="/shop?category=maison-energie"
              className="inline-flex items-center gap-2 rounded-full bg-white text-emerald-800 px-6 py-2.5 text-xs sm:text-sm font-semibold hover:bg-emerald-50 transition-colors shadow-lg"
            >
              Équipez votre maison
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* 4. FEATURED PRODUCTS */}
      <section className="space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Produits vedettes</h2>
            <p className="text-sm text-muted-foreground">Une sélection exclusive de nos produits de qualité supérieure.</p>
          </div>
          <Link href="/shop" className="text-sm font-semibold text-primary hover:underline flex items-center gap-1">
            Tout voir
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
                  {product.images[0] ? <Image src={product.images[0]} alt={product.name} fill sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 25vw" className="object-cover transition-transform duration-500 group-hover:scale-105" /> : <div aria-hidden className="absolute inset-0 bg-muted" />}
                  {hasDiscount && (
                    <span className="absolute top-3 left-3 rounded-full bg-destructive px-2.5 py-1 text-[10px] font-bold text-destructive-foreground">
                      Promo
                    </span>
                  )}
                  {product.stock_quantity <= 3 && (
                    <span className="absolute top-3 right-3 rounded-full bg-amber-500 px-2.5 py-1 text-[10px] font-bold text-white">
                      Stock Bas
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
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Ce que disent nos clients</h2>
          <p className="text-sm text-muted-foreground">La satisfaction de nos clients à Goma est notre priorité absolue.</p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {testimonials.map((t, index) => (
            <div key={index} className="flex flex-col bg-card border border-border/40 p-6 rounded-2xl shadow-sm space-y-4">
              <div className="flex gap-0.5">
                {[...Array(t.rating)].map((_, i) => (
                  <Star key={i} className="h-4 w-4 fill-amber-400 text-amber-400" />
                ))}
              </div>
              <p className="text-xs sm:text-sm text-muted-foreground italic flex-1 leading-relaxed">
                "{t.text}"
              </p>
              <div>
                <h4 className="font-bold text-sm text-foreground">{t.name}</h4>
                <p className="text-[10px] text-muted-foreground">{t.role}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 6. FAQ SECTION */}
      <section className="max-w-3xl mx-auto space-y-8">
        <div className="text-center space-y-2">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Foire aux questions (FAQ)</h2>
          <p className="text-sm text-muted-foreground">Tout savoir sur les livraisons et paiements de DLXSTORE.</p>
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
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Abonnez-vous à notre newsletter</h2>
          <p className="text-xs sm:text-sm text-neutral-300">
            Recevez des alertes sur nos arrivages et promotions exclusives à Goma.
          </p>
        </div>
        <form 
          onSubmit={(e) => { e.preventDefault(); alert('Merci de vous être abonné !'); }} 
          className="mx-auto flex max-w-md gap-2 rounded-full bg-white/5 border border-white/10 p-1"
        >
          <input
            type="email"
            placeholder="Votre adresse email"
            required
            className="flex-1 bg-transparent px-4 py-2 text-xs sm:text-sm text-white placeholder-neutral-400 outline-none"
          />
          <button
            type="submit"
            className="rounded-full bg-white text-black px-4 sm:px-6 py-2 text-xs font-semibold hover:bg-neutral-100 transition-colors"
          >
            S'abonner
          </button>
        </form>
      </section>

    </div>
  );
}
