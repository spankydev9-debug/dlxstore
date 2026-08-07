"use client";

import React from "react";
import Link from "next/link";
import { useCart } from "../../context/CartContext";
import { Trash2, ArrowRight, ShoppingCart, Truck, ShieldCheck, Heart } from "lucide-react";

export default function CartPage() {
  const { items, subtotal, total, updateQuantity, removeFromCart, clearCart } = useCart();

  if (items.length === 0) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center space-y-4 animate-fade-in">
        <div className="rounded-full bg-muted p-6">
          <ShoppingCart className="h-12 w-12 text-muted-foreground" />
        </div>
        <h1 className="text-2xl font-bold">Votre panier est vide</h1>
        <p className="text-sm text-muted-foreground max-w-xs">
          Explorez notre catalogue et ajoutez des articles de qualité avec livraison gratuite à Goma.
        </p>
        <Link
          href="/shop"
          className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground hover:bg-primary/95 transition-all shadow-md"
        >
          Découvrir nos produits
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Title */}
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Votre Panier</h1>
        <p className="text-sm text-muted-foreground">Vérifiez vos articles avant de passer la commande.</p>
      </div>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-3">
        
        {/* Cart Items List */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between border-b border-border/40 pb-3">
            <span className="text-sm font-semibold text-muted-foreground">{items.length} articles</span>
            <button
              onClick={clearCart}
              className="text-xs text-muted-foreground hover:text-destructive hover:underline font-semibold"
            >
              Vider le panier
            </button>
          </div>

          <div className="divide-y divide-border/40">
            {items.map((item) => {
              const price = item.product.discount_price ?? item.product.price;
              const hasDiscount = !!item.product.discount_price;
              return (
                <div key={item.id} className="flex flex-col sm:flex-row py-4 sm:items-center justify-between gap-4">
                  {/* Image & Details */}
                  <div className="flex gap-4">
                    <img
                      src={item.product.images[0]}
                      alt={item.product.name}
                      className="h-20 w-20 rounded-xl object-cover border border-border bg-muted flex-shrink-0"
                    />
                    <div className="space-y-1">
                      <h3 className="font-bold text-sm text-foreground hover:underline">
                        <Link href={`/product/${item.product.slug}`}>{item.product.name}</Link>
                      </h3>
                      <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">
                        {item.product.brand}
                      </p>
                      {/* Attributes */}
                      <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                        {item.selectedSize && (
                          <span className="bg-muted px-2 py-0.5 rounded">Taille : {item.selectedSize}</span>
                        )}
                        {item.selectedColor && (
                          <span className="bg-muted px-2 py-0.5 rounded">Couleur : {item.selectedColor}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Quantity & Price */}
                  <div className="flex items-center justify-between sm:justify-end gap-6 w-full sm:w-auto">
                    {/* Quantity Controls */}
                    <div className="flex items-center border border-border rounded-lg h-9 bg-background overflow-hidden">
                      <button
                        onClick={() => updateQuantity(item.id, item.quantity - 1)}
                        className="px-2.5 h-full hover:bg-muted text-foreground transition-colors font-bold"
                      >
                        -
                      </button>
                      <span className="px-3 text-xs font-semibold">{item.quantity}</span>
                      <button
                        onClick={() => updateQuantity(item.id, item.quantity + 1)}
                        className="px-2.5 h-full hover:bg-muted text-foreground transition-colors font-bold"
                      >
                        +
                      </button>
                    </div>

                    {/* Price and delete */}
                    <div className="text-right space-y-1">
                      <div className="text-sm font-bold text-foreground">
                        {price * item.quantity} $
                      </div>
                      {hasDiscount && (
                        <div className="text-[10px] text-muted-foreground line-through">
                          {item.product.price * item.quantity} $
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => removeFromCart(item.id)}
                      className="text-muted-foreground hover:text-destructive p-2 hover:bg-destructive/10 rounded-full transition-colors"
                      title="Retirer l'article"
                    >
                      <Trash2 className="h-4.5 w-4.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Cart Summary */}
        <div className="space-y-6">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-6">
            <h3 className="font-bold text-lg text-foreground border-b border-border/40 pb-3">Résumé du panier</h3>
            
            <div className="space-y-3 text-xs sm:text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Sous-total</span>
                <span className="font-semibold text-foreground">{subtotal} $</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Livraison</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">GRATUITE (Goma)</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Moyen de paiement</span>
                <span className="font-semibold text-foreground">À la livraison (COD)</span>
              </div>
              
              <div className="border-t border-border/45 pt-3 flex justify-between font-bold text-base sm:text-lg text-foreground">
                <span>Total</span>
                <span>{total} $</span>
              </div>
            </div>

            <div className="pt-2">
              <Link
                href="/checkout"
                className="w-full inline-flex items-center justify-center gap-2 h-11 rounded-full bg-primary text-primary-foreground font-semibold hover:bg-primary/95 transition-all shadow-md"
              >
                Passer au paiement (COD)
                <ArrowRight className="h-4.5 w-4.5" />
              </Link>
            </div>
          </div>

          {/* Guarantees */}
          <div className="rounded-2xl border border-border/60 bg-muted/20 p-5 space-y-4">
            <h4 className="font-bold text-xs text-foreground uppercase tracking-wider">Nos garanties à Goma</h4>
            <div className="flex items-start gap-3">
              <Truck className="h-5 w-5 text-emerald-500 flex-shrink-0 mt-0.5" />
              <div className="text-xs">
                <p className="font-bold text-foreground">Livraison 100% Gratuite</p>
                <p className="text-muted-foreground">Partout dans la ville de Goma, sans frais cachés.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <ShieldCheck className="h-5 w-5 text-emerald-500 flex-shrink-0 mt-0.5" />
              <div className="text-xs">
                <p className="font-bold text-foreground">Achat Sans Risque</p>
                <p className="text-muted-foreground">Vérifiez l'article à l'arrivée. Payez en espèces uniquement si vous êtes satisfait.</p>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
