"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { getProductBySlug, getProducts } from "../../../services/db/products";
import { getProductReviews, addReview } from "../../../services/db/reviews";
import { addToWishlist, removeFromWishlist, isInWishlist } from "../../../services/db/wishlist";
import { useCart } from "../../../context/CartContext";
import { useAuth } from "../../../context/AuthContext";
import { Product, Review } from "../../../types";
import { Star, Heart, ShoppingCart, MessageSquare, ShieldCheck, Truck, RefreshCw, StarHalf } from "lucide-react";

export default function ProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { addToCart } = useCart();
  const slug = params.slug as string;

  const [product, setProduct] = useState<Product | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [relatedProducts, setRelatedProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // User selections
  const [selectedSize, setSelectedSize] = useState("");
  const [selectedColor, setSelectedColor] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [isSaved, setIsSaved] = useState(false);
  const [activeImage, setActiveImage] = useState("");

  // Review Form States
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);

  // Zoom Effect State
  const [zoomStyle, setZoomStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    async function loadData() {
      if (!slug) return;
      setIsLoading(true);
      try {
        const prod = await getProductBySlug(slug);
        if (!prod) {
          router.push("/shop");
          return;
        }
        setProduct(prod);
        setActiveImage(prod.images[0]);
        
        // Load reviews and related products
        const [revs, allProds] = await Promise.all([
          getProductReviews(prod.id),
          getProducts()
        ]);
        setReviews(revs);
        setRelatedProducts(
          allProds.filter(p => p.category_id === prod.category_id && p.id !== prod.id).slice(0, 4)
        );

        // Check if item in wishlist
        if (user) {
          const saved = await isInWishlist(user.id, prod.id);
          setIsSaved(saved);
        }

        // Set default size/color
        if (prod.sizes.length > 0) setSelectedSize(prod.sizes[0]);
        if (prod.colors.length > 0) setSelectedColor(prod.colors[0]);
      } catch (err) {
        console.error("Error loading product details:", err);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, [slug, user, router]);

  const handleWishlistToggle = async () => {
    if (!user) {
      router.push("/auth?mode=login");
      return;
    }
    if (!product) return;

    try {
      if (isSaved) {
        await removeFromWishlist(user.id, product.id);
        setIsSaved(false);
      } else {
        await addToWishlist(user.id, product.id);
        setIsSaved(true);
      }
    } catch (err) {
      console.error("Error toggling wishlist:", err);
    }
  };

  const handleAddToCart = () => {
    if (!product) return;
    addToCart(product, quantity, selectedSize, selectedColor);
    alert("Produit ajouté au panier !");
  };

  const handleWhatsAppOrder = () => {
    if (!product) return;
    const finalPrice = product.discount_price ?? product.price;
    const message = `Bonjour DLXSTORE, je souhaite commander l'article suivant :\n\n` +
      `- *Produit* : ${product.name}\n` +
      (selectedSize ? `- *Taille* : ${selectedSize}\n` : "") +
      (selectedColor ? `- *Couleur* : ${selectedColor}\n` : "") +
      `- *Quantité* : ${quantity}\n` +
      `- *Prix* : ${finalPrice} $\n\n` +
      `Merci de me contacter pour la livraison gratuite à Goma.`;
    
    const url = `https://wa.me/243990123456?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank");
  };

  const handleReviewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !product) return;
    setIsSubmittingReview(true);
    try {
      const newRev = await addReview(product.id, user.id, user.full_name, rating, comment);
      setReviews(prev => [newRev, ...prev]);
      setComment("");
      alert("Votre avis a été publié !");
    } catch (err) {
      console.error("Error submitting review:", err);
      alert("Erreur lors de la publication de votre avis.");
    } finally {
      setIsSubmittingReview(false);
    }
  };

  // Magnifying Glass Zoom Effect
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const { left, top, width, height } = e.currentTarget.getBoundingClientRect();
    const x = ((e.pageX - left - window.scrollX) / width) * 100;
    const y = ((e.pageY - top - window.scrollY) / height) * 100;
    setZoomStyle({
      transformOrigin: `${x}% ${y}%`,
      transform: "scale(2)",
      cursor: "zoom-in"
    });
  };

  const handleMouseLeave = () => {
    setZoomStyle({});
  };

  if (isLoading || !product) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center space-y-4">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
        <p className="text-sm text-muted-foreground">Chargement des détails de l'article...</p>
      </div>
    );
  }

  const finalPrice = product.discount_price ?? product.price;
  const hasDiscount = !!product.discount_price;

  return (
    <div className="space-y-16 pb-16 animate-fade-in">
      
      {/* Product Details Section */}
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-2">
        
        {/* Left Column: Image Gallery & Zoom */}
        <div className="space-y-4">
          <div 
            className="relative aspect-square overflow-hidden rounded-2xl border border-border/80 bg-muted"
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          >
            <img
              src={activeImage}
              alt={product.name}
              style={zoomStyle}
              className="h-full w-full object-cover transition-transform duration-100 ease-out"
            />
          </div>

          {/* Thumbnails */}
          {product.images.length > 1 && (
            <div className="flex gap-3 overflow-x-auto pb-1">
              {product.images.map((img, i) => (
                <button
                  key={i}
                  onClick={() => setActiveImage(img)}
                  className={`relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-xl border transition-all ${activeImage === img ? 'border-primary ring-2 ring-ring' : 'border-border hover:border-muted-foreground'}`}
                >
                  <img src={img} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right Column: Information & Controls */}
        <div className="space-y-6">
          <div className="space-y-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">{product.brand}</span>
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground">{product.name}</h1>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-0.5">
                {[...Array(5)].map((_, i) => (
                  <Star 
                    key={i} 
                    className={`h-4 w-4 ${i < Math.floor(product.rating) ? 'fill-amber-400 text-amber-400' : 'text-border'}`} 
                  />
                ))}
              </div>
              <span className="text-xs font-bold text-foreground">{product.rating}</span>
              <span className="text-xs text-muted-foreground">({reviews.length} avis)</span>
            </div>
          </div>

          {/* Pricing */}
          <div className="flex items-baseline gap-3 border-t border-b border-border/40 py-4">
            <span className="text-3xl font-extrabold text-foreground">{finalPrice} $</span>
            {hasDiscount && (
              <span className="text-lg text-muted-foreground line-through">{product.price} $</span>
            )}
            <span className="ml-auto rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              Livraison Gratuite (COD)
            </span>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <h3 className="font-bold text-sm text-foreground">Description</h3>
            <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">{product.description}</p>
          </div>

          {/* Attributes Selectors */}
          <div className="space-y-4">
            {/* Size selector */}
            {product.sizes.length > 0 && (
              <div className="space-y-2">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Taille</span>
                <div className="flex flex-wrap gap-2">
                  {product.sizes.map((size) => (
                    <button
                      key={size}
                      onClick={() => setSelectedSize(size)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold border transition-all ${selectedSize === size ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:border-muted-foreground text-foreground'}`}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Color selector */}
            {product.colors.length > 0 && (
              <div className="space-y-2">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Couleur</span>
                <div className="flex flex-wrap gap-2">
                  {product.colors.map((color) => (
                    <button
                      key={color}
                      onClick={() => setSelectedColor(color)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold border transition-all ${selectedColor === color ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:border-muted-foreground text-foreground'}`}
                    >
                      {color}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Quantity Selector & Stock Indicator */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Quantité</span>
                <div className="flex items-center gap-1.5">
                  <span className={`h-2.5 w-2.5 rounded-full ${product.stock_quantity > 3 ? 'bg-emerald-500' : product.stock_quantity > 0 ? 'bg-amber-500' : 'bg-destructive'}`}></span>
                  <span className="text-xs text-muted-foreground">
                    {product.stock_quantity > 3 ? 'En stock' : product.stock_quantity > 0 ? `Stock bas (${product.stock_quantity} restants)` : 'Rupture de stock'}
                  </span>
                </div>
              </div>

              {product.stock_quantity > 0 && (
                <div className="flex items-center gap-3">
                  <div className="flex items-center border border-border rounded-lg h-10 bg-background overflow-hidden">
                    <button
                      onClick={() => setQuantity(q => Math.max(1, q - 1))}
                      className="px-3 h-full hover:bg-muted text-foreground transition-colors font-bold"
                    >
                      -
                    </button>
                    <span className="px-4 text-sm font-semibold">{quantity}</span>
                    <button
                      onClick={() => setQuantity(q => Math.min(product.stock_quantity, q + 1))}
                      className="px-3 h-full hover:bg-muted text-foreground transition-colors font-bold"
                    >
                      +
                    </button>
                  </div>

                  {/* Save to Wishlist */}
                  <button
                    onClick={handleWishlistToggle}
                    className={`flex h-10 w-10 items-center justify-center rounded-lg border transition-all ${isSaved ? 'border-red-200 bg-red-50 text-red-500' : 'border-border hover:bg-muted text-muted-foreground'}`}
                  >
                    <Heart className={`h-5 w-5 ${isSaved ? 'fill-red-500' : ''}`} />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          {product.stock_quantity > 0 ? (
            <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-border/40">
              <button
                onClick={handleAddToCart}
                className="flex-1 inline-flex items-center justify-center gap-2 h-12 rounded-full bg-primary text-primary-foreground font-semibold hover:bg-primary/95 transition-all shadow-md"
              >
                <ShoppingCart className="h-5 w-5" />
                Ajouter au panier
              </button>
              <button
                onClick={handleWhatsAppOrder}
                className="flex-1 inline-flex items-center justify-center gap-2 h-12 rounded-full bg-emerald-600 text-white font-semibold hover:bg-emerald-700 transition-all shadow-md"
              >
                <MessageSquare className="h-5 w-5" />
                Commander via WhatsApp
              </button>
            </div>
          ) : (
            <button
              disabled
              className="w-full h-12 rounded-full bg-muted text-muted-foreground font-semibold cursor-not-allowed border border-border"
            >
              Épuisé
            </button>
          )}

          {/* Assurances */}
          <div className="rounded-2xl border border-border/60 bg-muted/30 p-4 space-y-3">
            <div className="flex items-center gap-3 text-xs">
              <Truck className="h-4.5 w-4.5 text-primary" />
              <span className="font-semibold text-foreground">Livraison Gratuite partout à Goma</span>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <ShieldCheck className="h-4.5 w-4.5 text-primary" />
              <span className="font-semibold text-foreground">Paiement Cash à la livraison (COD) uniquement</span>
            </div>
          </div>
        </div>

      </div>

      {/* Reviews Section */}
      <div className="border-t border-border/40 pt-12 grid grid-cols-1 lg:grid-cols-3 gap-12">
        <div className="space-y-6">
          <h2 className="text-2xl font-bold tracking-tight">Avis des clients</h2>
          
          <div className="rounded-2xl border border-border/60 p-5 space-y-4">
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-extrabold text-foreground">{product.rating}</span>
              <span className="text-xs text-muted-foreground">sur 5</span>
            </div>
            <div className="flex items-center gap-0.5">
              {[...Array(5)].map((_, i) => (
                <Star 
                  key={i} 
                  className={`h-5 w-5 ${i < Math.floor(product.rating) ? 'fill-amber-400 text-amber-400' : 'text-border'}`} 
                />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Avis authentiques de clients basés à Goma.</p>
          </div>

          {/* Review write form */}
          {user ? (
            <form onSubmit={handleReviewSubmit} className="space-y-4 border border-border/60 rounded-2xl p-5 bg-card">
              <h3 className="font-bold text-sm text-foreground">Laisser un avis</h3>
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground font-semibold">Note</span>
                <div className="flex gap-1.5">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setRating(star)}
                      className="text-amber-400 focus:outline-none"
                    >
                      <Star className={`h-6 w-6 ${rating >= star ? 'fill-amber-400' : 'text-border'}`} />
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="comment" className="text-xs text-muted-foreground font-semibold">Commentaire</label>
                <textarea
                  id="comment"
                  rows={4}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Écrivez votre commentaire ici..."
                  required
                  className="w-full rounded-lg border border-border bg-background p-3 text-xs outline-none focus:border-foreground"
                />
              </div>
              <button
                type="submit"
                disabled={isSubmittingReview}
                className="w-full inline-flex justify-center items-center h-9 rounded-full bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/95 transition-all disabled:opacity-50"
              >
                {isSubmittingReview ? "Publication..." : "Publier l'avis"}
              </button>
            </form>
          ) : (
            <div className="rounded-2xl border border-dashed border-border p-5 text-center">
              <p className="text-xs text-muted-foreground mb-3">Connectez-vous pour laisser un avis.</p>
              <Link
                href="/auth?mode=login"
                className="inline-flex h-9 items-center justify-center rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-muted transition-all"
              >
                Se connecter
              </Link>
            </div>
          )}
        </div>

        {/* Reviews List */}
        <div className="lg:col-span-2 space-y-6">
          <h3 className="font-bold text-lg text-foreground border-b border-border/40 pb-2">Commentaires ({reviews.length})</h3>
          
          {reviews.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-4">Aucun avis rédigé pour le moment.</p>
          ) : (
            <div className="divide-y divide-border/40 space-y-6">
              {reviews.map((rev) => (
                <div key={rev.id} className="pt-6 first:pt-0 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm text-foreground">{rev.user_name}</span>
                    <span className="text-[10px] text-muted-foreground">{new Date(rev.created_at).toLocaleDateString()}</span>
                  </div>
                  <div className="flex gap-0.5">
                    {[...Array(5)].map((_, i) => (
                      <Star 
                        key={i} 
                        className={`h-3.5 w-3.5 ${i < rev.rating ? 'fill-amber-400 text-amber-400' : 'text-border'}`} 
                      />
                    ))}
                  </div>
                  {rev.comment && (
                    <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                      {rev.comment}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Related Products */}
      {relatedProducts.length > 0 && (
        <div className="border-t border-border/40 pt-12 space-y-6">
          <h2 className="text-2xl font-bold tracking-tight">Articles similaires</h2>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {relatedProducts.map((product) => {
              const finalPrice = product.discount_price ?? product.price;
              const hasDiscount = !!product.discount_price;
              return (
                <Link
                  key={product.id}
                  href={`/product/${product.slug}`}
                  className="group flex flex-col rounded-2xl border border-border/60 bg-card overflow-hidden transition-all hover:shadow-md"
                >
                  <div className="relative aspect-square overflow-hidden bg-muted">
                    <img
                      src={product.images[0]}
                      alt={product.name}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  </div>
                  <div className="flex flex-col flex-1 p-4 space-y-1">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{product.brand}</span>
                    <h3 className="font-bold text-sm text-foreground line-clamp-1 group-hover:underline">{product.name}</h3>
                    <div className="flex items-baseline gap-2 pt-1 mt-auto">
                      <span className="text-sm font-extrabold text-foreground">{finalPrice} $</span>
                      {hasDiscount && (
                        <span className="text-[10px] text-muted-foreground line-through">{product.price} $</span>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
}
