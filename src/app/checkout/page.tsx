"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "../../context/CartContext";
import { useAuth } from "../../context/AuthContext";
import { createOrder, recordOrderWhatsAppHandoff } from "../../services/db/orders";
import { CouponValidation, validateCoupon } from "../../services/db/coupons";
import { getStoreSettings } from "../../services/db/settings";
import { buildWhatsAppUrl, buildOrderOperationalMessage, getWhatsAppBuyNumber } from "../../lib/whatsapp";
import { useLanguage } from "../../context/LanguageContext";
import { GOMA_MUNICIPALITIES } from "../../lib/mock-data";
import { ShieldCheck, ArrowLeft, ShoppingBag, CheckCircle2, AlertCircle } from "lucide-react";
import Link from "next/link";
import { Order } from "../../types";

export default function CheckoutPage() {
  const router = useRouter();
  const { items, total, clearCart } = useCart();
  const { user } = useAuth();
  const { t } = useLanguage();

  // Form Fields
  const [customerName, setCustomerName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [municipality, setMunicipality] = useState("Goma");
  const [neighborhood, setNeighborhood] = useState("");
  const [avenue, setAvenue] = useState("");
  const [houseNumber, setHouseNumber] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [coupon, setCoupon] = useState<CouponValidation | null>(null);
  const [couponNotice, setCouponNotice] = useState("");
  
  // Error and success states
  const [orderError, setOrderError] = useState<string | null>(null);
  const [orderSuccess, setOrderSuccess] = useState<Order | null>(null);
  const [whatsappManualUrl, setWhatsappManualUrl] = useState<string | null>(null);
  const [whatsappStatus, setWhatsappStatus] = useState<"link_opened" | "unavailable" | "not_configured">("not_configured");

  // Sync with logged-in user details if available
  useEffect(() => {
    if (user) {
      setCustomerName(user.full_name);
      setPhoneNumber(user.phone || "");
    }
  }, [user]);

  // Set default neighborhood when municipality changes
  useEffect(() => {
    const list = GOMA_MUNICIPALITIES[municipality] || [];
    if (list.length > 0) {
      setNeighborhood(list[0]);
    }
  }, [municipality]);

  const applyCoupon = async () => {
    try {
      const result = await validateCoupon(couponCode, total, false);
      setCoupon(result);
      setCouponNotice(result ? t.couponApplied : t.couponInvalid);
    } catch { setCoupon(null); setCouponNotice(t.couponUnavailable); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (items.length === 0) return;
    if (!user) {
      router.push("/auth?mode=login&next=/checkout");
      return;
    }
    
    // Reset states
    setOrderError(null);
    setOrderSuccess(null);
    setWhatsappManualUrl(null);
    setIsSubmitting(true);
    
    console.log("[CHECKOUT] Submit started", { user: user.id, itemCount: items.length });
    
    try {
      const orderFields = {
        customer_id: user.id,
        customer_name: customerName,
        phone_number: phoneNumber,
        municipality,
        neighborhood,
        avenue,
        house_number: houseNumber || undefined,
        delivery_notes: deliveryNotes || undefined,
        coupon_code: coupon?.coupon.code,
        discount_amount: coupon?.discount || 0,
        total_amount: Math.max(0, total - (coupon?.discount || 0))
      };

      const orderItems = items.map(item => ({
        product_id: item.product.id,
        quantity: item.quantity,
        price_at_sale: item.product.discount_price ?? item.product.price,
        size: item.selectedSize,
        color: item.selectedColor
      }));

      console.log("[CHECKOUT] Order validation passed", { orderFields, itemCount: orderItems.length });

      // Phase 1: Order Creation (critical - if this fails, everything fails)
      console.log("[CHECKOUT] Creating order...");
      const newOrder = await createOrder(orderFields, orderItems);
      console.log("[CHECKOUT] Order created successfully", { orderId: newOrder.id });
      setOrderSuccess(newOrder);
      
      // Phase 2: Clear cart IMMEDIATELY after successful order creation to prevent duplicate orders
      console.log("[CHECKOUT] Clearing cart immediately after successful order creation");
      clearCart();
      
      // Phase 3: WhatsApp Handoff (non-critical - order already exists and cart is cleared)
      let currentWhatsappStatus: "link_opened" | "unavailable" | "not_configured" = "not_configured";
      let manualUrl: string | null = null;
      
      try {
        console.log("[CHECKOUT] Attempting WhatsApp handoff");
        const settings = await getStoreSettings();
        const number = getWhatsAppBuyNumber(settings);
        const message = buildOrderOperationalMessage({
          ...newOrder,
          items: items.map((item) => ({
            quantity: item.quantity,
            price_at_sale: item.product.discount_price ?? item.product.price,
            size: item.selectedSize,
            color: item.selectedColor,
            product: { name: item.product.name },
          })),
        });
        const url = number ? buildWhatsAppUrl(number, message) : null;
        if (url) {
          console.log("[CHECKOUT] Opening WhatsApp popup");
          const handoffWindow = window.open(url, "_blank", "noopener,noreferrer");
          if (handoffWindow) {
            console.log("[CHECKOUT] WhatsApp popup opened successfully");
            currentWhatsappStatus = "link_opened";
          } else {
            console.log("[CHECKOUT] WhatsApp popup blocked by browser");
            currentWhatsappStatus = "unavailable";
            manualUrl = url;
          }
        } else {
          console.log("[CHECKOUT] WhatsApp number not configured");
        }
      } catch (whatsappError) {
        console.warn("[CHECKOUT] WhatsApp handoff unavailable; order was created.", whatsappError);
        currentWhatsappStatus = "unavailable";
      }
      
      setWhatsappStatus(currentWhatsappStatus);
      setWhatsappManualUrl(manualUrl);
      console.log("[CHECKOUT] Final WhatsApp status", { status: currentWhatsappStatus, hasManualUrl: !!manualUrl });
      
      // Phase 4: Record handoff status (non-critical - order already exists)
      try {
        console.log("[CHECKOUT] Recording WhatsApp handoff status", { status: currentWhatsappStatus });
        await recordOrderWhatsAppHandoff(newOrder.id, currentWhatsappStatus);
        console.log("[CHECKOUT] WhatsApp handoff status recorded");
      } catch (handoffError) {
        console.warn("[CHECKOUT] Order handoff state was not recorded.", handoffError);
      }
      
      // Phase 5: Navigate to tracking
      console.log("[CHECKOUT] Navigating to order tracking", { orderId: newOrder.id, whatsappStatus: currentWhatsappStatus });
      router.push(`/order-tracking?orderId=${newOrder.id}&whatsapp=${currentWhatsappStatus}`);
      
    } catch (err) {
      console.error("[CHECKOUT] Error creating order:", err);
      console.error("[CHECKOUT] Error details:", {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        user: user?.id,
        itemCount: items.length
      });
      setOrderError(err instanceof Error ? err.message : String(err));
      // Don't clear cart on order creation failure - user can retry
    } finally {
      setIsSubmitting(false);
      console.log("[CHECKOUT] Submit process completed");
    }
  };

  if (items.length === 0) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center space-y-4 animate-fade-in">
        <h1 className="text-2xl font-bold">{t.cartEmpty}</h1>
        <Link href="/shop" className="text-primary hover:underline font-semibold text-sm">{t.backToShop}</Link>
      </div>
    );
  }

  if (!user) {
    return <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-4 text-center"><h1 className="text-2xl font-bold">{t.checkoutLoginTitle}</h1><p className="text-sm text-muted-foreground">{t.checkoutLoginBody}</p><Link href="/auth?mode=login&next=/checkout" className="rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground">{t.signIn}</Link></div>;
  }

  return (
    <div className="space-y-8 animate-fade-in max-w-5xl mx-auto">
      {/* Back Button */}
      <Link href="/cart" className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        {t.backToCart}
      </Link>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-5">
        
        {/* Left Column: Checkout Form (Col span 3) */}
        <div className="lg:col-span-3 space-y-6">
          <div className="space-y-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{t.checkoutTitle}</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">
              {t.checkoutIntro}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl border border-border bg-card p-6 shadow-sm">
            <h3 className="font-bold text-base text-foreground border-b border-border/40 pb-2">{t.deliveryInfo}</h3>
            
            {/* Customer Name */}
            <div className="space-y-1.5">
              <label htmlFor="name" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t.customerName}</label>
              <input
                id="name"
                type="text"
                required
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Ex. Jean-Paul Kabulo"
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
              />
            </div>

            {/* Phone Number */}
            <div className="space-y-1.5">
              <label htmlFor="phone" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t.phone}</label>
              <input
                id="phone"
                type="tel"
                required
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="Ex. +243 990 123 456"
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
              />
            </div>

            {/* Municipality & Neighborhood Selectors */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="municipality" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t.municipality}</label>
                <select
                  id="municipality"
                  value={municipality}
                  onChange={(e) => setMunicipality(e.target.value)}
                  className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
                >
                  <option value="Goma">Goma</option>
                  <option value="Karisimbi">Karisimbi</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="neighborhood" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t.neighborhood}</label>
                <select
                  id="neighborhood"
                  value={neighborhood}
                  onChange={(e) => setNeighborhood(e.target.value)}
                  className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
                >
                  {(GOMA_MUNICIPALITIES[municipality] || []).map((q) => (
                    <option key={q} value={q}>{q}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Avenue & House Number */}
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2 space-y-1.5">
                <label htmlFor="avenue" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t.avenue}</label>
                <input
                  id="avenue"
                  type="text"
                  required
                  value={avenue}
                  onChange={(e) => setAvenue(e.target.value)}
                  placeholder="Ex. Avenue du Lac"
                  className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="house" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t.houseNumber}</label>
                <input
                  id="house"
                  type="text"
                  value={houseNumber}
                  onChange={(e) => setHouseNumber(e.target.value)}
                  placeholder="Ex. 45 (optionnel)"
                  className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
                />
              </div>
            </div>

            {/* Delivery Notes */}
            <div className="space-y-1.5">
              <label htmlFor="notes" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t.deliveryNotes}</label>
              <textarea
                id="notes"
                rows={3}
                value={deliveryNotes}
                onChange={(e) => setDeliveryNotes(e.target.value)}
                placeholder="Ex. Derrière l'hôtel Kivu Palace, portail noir."
                className="w-full rounded-lg border border-border bg-background p-3 text-sm outline-none focus:border-foreground"
              />
            </div>

            {/* Important COD notice */}
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 space-y-2">
              <div className="flex items-center gap-2 font-bold text-emerald-800 dark:text-emerald-400 text-sm">
                <ShieldCheck className="h-5 w-5" />
                <span>{t.codGuarantee}</span>
              </div>
              <p className="text-xs text-emerald-700 dark:text-emerald-300 leading-relaxed">{t.codNotice}</p>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full inline-flex items-center justify-center h-12 rounded-full bg-primary text-primary-foreground font-semibold hover:bg-primary/95 transition-all shadow-md disabled:opacity-50"
            >
              {isSubmitting ? t.processingOrder : t.confirmOrder}
            </button>
            
            {/* Error Message */}
            {orderError && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-4 mt-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-destructive">
                      {t.orderError}
                    </p>
                    <p className="text-xs text-destructive/80 mt-1">
                      {orderError}
                    </p>
                  </div>
                </div>
              </div>
            )}
            
            {/* Success Message with WhatsApp Fallback */}
            {orderSuccess && !isSubmitting && (
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 mt-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-emerald-800">
                      Commande confirmée !
                    </p>
                    <p className="text-xs text-emerald-700 mt-1">
                      Votre commande #{orderSuccess.id} a été créée avec succès.
                    </p>
                    
                    {whatsappManualUrl && (
                      <div className="mt-3 pt-3 border-t border-emerald-200">
                        <p className="text-xs text-emerald-700 mb-2">
                          WhatsApp n'a pas pu s'ouvrir automatiquement.
                        </p>
                        <a 
                          href={whatsappManualUrl} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 px-3 py-2 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-700 transition-colors"
                        >
                          Ouvrir WhatsApp manuellement
                        </a>
                      </div>
                    )}
                    
                    <div className="mt-3 pt-3 border-t border-emerald-200">
                      <Link 
                        href={`/order-tracking?orderId=${orderSuccess.id}&whatsapp=${whatsappStatus}`}
                        className="text-xs font-semibold text-emerald-700 hover:underline"
                      >
                        Suivre ma commande →
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </form>
        </div>

        {/* Right Column: Order Items Overview (Col span 2) */}
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-6">
            <h3 className="font-bold text-base text-foreground border-b border-border/40 pb-2 flex items-center gap-2">
              <ShoppingBag className="h-4.5 w-4.5 text-muted-foreground" />
              {t.orderItems}
            </h3>

            {/* Items Summary */}
            <div className="max-h-80 overflow-y-auto divide-y divide-border/40 pr-1">
              {items.map((item) => {
                const price = item.product.discount_price ?? item.product.price;
                return (
                  <div key={item.id} className="flex justify-between py-3 text-xs sm:text-sm first:pt-0">
                    <div className="space-y-1">
                      <p className="font-bold text-foreground line-clamp-1">{item.product.name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {t.quantity}: {item.quantity}
                        {item.selectedSize ? ` | ${item.selectedSize}` : ""} 
                        {item.selectedColor ? ` | ${item.selectedColor}` : ""}
                      </p>
                    </div>
                    <span className="font-semibold text-foreground">{price * item.quantity} $</span>
                  </div>
                );
              })}
            </div>

            {/* Totals */}
            <div className="border-t border-border/40 pt-4 space-y-2 text-xs sm:text-sm">
              <div className="space-y-2 border-b border-border/40 pb-4"><label htmlFor="coupon" className="font-semibold text-foreground">{t.promoCode}</label><div className="flex gap-2"><input id="coupon" value={couponCode} onChange={(e) => { setCouponCode(e.target.value); setCoupon(null); }} placeholder="Ex. DLX10" className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2" /><button type="button" onClick={applyCoupon} className="rounded-lg border border-border px-3 py-2 font-semibold hover:bg-muted">{t.apply}</button></div>{couponNotice && <p role="status" className={coupon ? "text-emerald-600" : "text-muted-foreground"}>{couponNotice}</p>}</div>
              <div className="flex justify-between text-muted-foreground">
                <span>{t.subtotal}</span>
                <span className="font-semibold text-foreground">{total} $</span>
              </div>
              {coupon && <div className="flex justify-between text-emerald-600"><span>{t.discount} ({coupon.coupon.code})</span><span>-{coupon.discount} $</span></div>}
              <div className="flex justify-between text-muted-foreground">
                <span>{t.delivery}</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">{t.free}</span>
              </div>
              <div className="border-t border-border/40 pt-3 flex justify-between font-bold text-sm sm:text-base text-foreground">
                <span>{t.amountDueCod}</span>
                <span>{Math.max(0, total - (coupon?.discount || 0))} $</span>
              </div>
            </div>
          </div>

          {/* Delivery Area assurances */}
          <div className="rounded-2xl border border-border/60 bg-muted/20 p-5 space-y-3">
            <h4 className="font-bold text-xs uppercase text-foreground tracking-wider">{t.deliveryAreas}</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">{t.deliveryAreasBody}</p>
          </div>
        </div>

      </div>
    </div>
  );
}
