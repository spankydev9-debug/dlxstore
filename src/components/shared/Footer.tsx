import React from "react";
import Link from "next/link";
import { Truck, ShieldCheck, MapPin, MessageSquare } from "lucide-react";

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="w-full border-t border-border/40 bg-card mt-auto">
      {/* Citywide Promises grid */}
      <div className="border-b border-border/40 py-8 px-4 sm:px-6 lg:px-8 mx-auto max-w-7xl">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex items-start gap-4">
            <div className="rounded-full bg-primary/10 p-3 text-primary">
              <Truck className="h-6 w-6" />
            </div>
            <div>
              <h4 className="font-semibold text-foreground text-sm sm:text-base">Livraison Gratuite</h4>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                Livraison gratuite garantie partout dans la ville de Goma à votre porte.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="rounded-full bg-primary/10 p-3 text-primary">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <h4 className="font-semibold text-foreground text-sm sm:text-base">Paiement à la Livraison</h4>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                Aucun paiement en ligne requis. Vous payez en espèces (COD) uniquement après inspection de vos articles.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="rounded-full bg-primary/10 p-3 text-primary">
              <MessageSquare className="h-6 w-6" />
            </div>
            <div>
              <h4 className="font-semibold text-foreground text-sm sm:text-base">Assistance WhatsApp Rapide</h4>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                Les canaux officiels de support seront affichés ici dès leur configuration.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Footer Links */}
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 grid grid-cols-1 md:grid-cols-4 gap-8">
        
        {/* Brand */}
        <div className="space-y-4">
          <Link href="/" className="text-xl font-bold tracking-widest text-foreground uppercase">
            DLX<span className="text-primary font-light">STORE</span>
          </Link>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Une fondation de marché numérique pensée pour la République démocratique du Congo.
          </p>
          <div className="flex items-center gap-3 text-xs sm:text-sm text-muted-foreground">
            <MapPin className="h-4.5 w-4.5 text-primary" />
            <span>Goma, Province du Nord-Kivu, RDC</span>
          </div>
        </div>

        {/* Categories */}
        <div>
          <h4 className="font-semibold text-foreground text-sm mb-4">Catégories</h4>
          <ul className="space-y-2 text-xs sm:text-sm text-muted-foreground">
            <li><Link href="/shop?category=electronique" className="hover:text-foreground transition-colors">Électronique & High-Tech</Link></li>
            <li><Link href="/shop?category=mode-vetements" className="hover:text-foreground transition-colors">Mode & Vêtements</Link></li>
            <li><Link href="/shop?category=maison-energie" className="hover:text-foreground transition-colors">Maison & Énergie</Link></li>
          </ul>
        </div>

        {/* Links */}
        <div>
          <h4 className="font-semibold text-foreground text-sm mb-4">Liens Utiles</h4>
          <ul className="space-y-2 text-xs sm:text-sm text-muted-foreground">
            <li><Link href="/shop" className="hover:text-foreground transition-colors">Tous les produits</Link></li>
            <li><Link href="/about" className="hover:text-foreground transition-colors">À propos de nous</Link></li>
            <li><Link href="/contact" className="hover:text-foreground transition-colors">Contactez-nous</Link></li>
            <li><Link href="/dashboard" className="hover:text-foreground transition-colors">Mon compte</Link></li>
          </ul>
        </div>

        {/* Contact info */}
        <div>
          <h4 className="font-semibold text-foreground text-sm mb-4">Contact</h4>
          <ul className="space-y-3 text-xs sm:text-sm text-muted-foreground">
            <li className="pt-2">
              <Link
                href="/contact"
                className="inline-flex items-center gap-2 rounded-full bg-emerald-600 hover:bg-emerald-700 px-4 py-2 text-xs font-semibold text-white transition-colors"
              >
                Voir les canaux officiels
              </Link>
            </li>
          </ul>
        </div>
      </div>

      {/* Copyright */}
      <div className="border-t border-border/40 py-6 px-4 sm:px-6 lg:px-8 mx-auto max-w-7xl flex flex-col sm:flex-row items-center justify-between text-xs text-muted-foreground gap-4">
        <div>
          © {currentYear} DLXSTORE. Tous droits réservés.
        </div>
        <div className="flex gap-4">
          <span>Ville de Goma - Livraison Gratuite - Paiement COD</span>
        </div>
      </div>
    </footer>
  );
}
