import React from "react";
import Link from "next/link";
import Image from "next/image";
import { Truck, ShieldCheck, Smile, HelpCircle } from "lucide-react";

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-4xl py-12 px-4 space-y-16 animate-fade-in">
      
      {/* Hero */}
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-extrabold tracking-tight">À propos de DLXSTORE</h1>
        <p className="text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto leading-relaxed">
          DLXSTORE est la plateforme e-commerce de référence pour la ville de Goma. Nous simplifions vos achats quotidiens en combinant un catalogue premium, une livraison ultra-rapide et un paiement cash sécurisé à votre porte.
        </p>
      </div>

      {/* Grid: Our Mission */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center border-t border-border/40 pt-12">
        <div className="space-y-4">
          <h2 className="text-2xl font-bold tracking-tight">Notre Mission</h2>
          <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
            Nous croyons que chaque habitant de Goma mérite une expérience d'achat moderne et sans friction. Finis les tracas des marchés bondés ou l'insécurité des paiements en ligne non réglementés. Avec DLXSTORE, commandez en un clic, inspectez vos articles à la livraison et payez uniquement si vous êtes convaincu.
          </p>
          <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
            Qu'il s'agisse de s'équiper en énergie solaire pour faire face aux délestages réguliers, de s'offrir le dernier smartphone ou d'acheter du café arabica produit localement, DLXSTORE est là pour vous servir.
          </p>
        </div>
        <div className="relative rounded-2xl overflow-hidden aspect-video border bg-muted">
          <Image 
            src="https://images.unsplash.com/photo-1556740758-90de374c12ad?w=500&auto=format&fit=crop&q=60" 
            alt="E-commerce Goma" 
            fill
            sizes="(max-width: 768px) 100vw, 50vw"
            className="object-cover"
          />
        </div>
      </div>

      {/* Grid: Core Pillars */}
      <div className="space-y-6">
        <h2 className="text-2xl font-bold tracking-tight text-center">Nos Engagements Majeurs</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="rounded-2xl border border-border p-6 space-y-3 bg-card shadow-sm text-center">
            <div className="rounded-full bg-primary/10 p-3 text-primary w-fit mx-auto">
              <Truck className="h-6 w-6" />
            </div>
            <h4 className="font-bold text-sm sm:text-base">Livraison Gratuite</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Nous livrons gratuitement sur toute l'étendue de Goma (Himbi, Keshero, Katindo, Ndosho, etc.) sans aucun montant minimum d'achat requis.
            </p>
          </div>

          <div className="rounded-2xl border border-border p-6 space-y-3 bg-card shadow-sm text-center">
            <div className="rounded-full bg-primary/10 p-3 text-primary w-fit mx-auto">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <h4 className="font-bold text-sm sm:text-base">Paiement sur Livraison</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Cash on Delivery (COD) uniquement. Nous ne vous demandons jamais vos coordonnées bancaires en ligne. Vous payez en espèces après vérification.
            </p>
          </div>

          <div className="rounded-2xl border border-border p-6 space-y-3 bg-card shadow-sm text-center">
            <div className="rounded-full bg-primary/10 p-3 text-primary w-fit mx-auto">
              <Smile className="h-6 w-6" />
            </div>
            <h4 className="font-bold text-sm sm:text-base">Originalité Garantie</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Tous nos articles (sneakers, ordinateurs, stations de recharge solaires) proviennent de sources vérifiées et d'une authenticité certifiée.
            </p>
          </div>
        </div>
      </div>

      {/* CTA Box */}
      <div className="rounded-2xl bg-neutral-950 text-white p-8 text-center space-y-4">
        <h3 className="text-xl sm:text-2xl font-bold">Prêt à faire des achats intelligents ?</h3>
        <p className="text-xs text-neutral-300 max-w-sm mx-auto">Découvrez dès maintenant notre catalogue d'articles originaux disponibles pour Goma.</p>
        <div className="pt-2">
          <Link
            href="/shop"
            className="inline-flex h-10 items-center justify-center rounded-full bg-white text-black px-6 text-xs font-semibold hover:bg-neutral-100 transition-colors"
          >
            Visiter la boutique
          </Link>
        </div>
      </div>

    </div>
  );
}
