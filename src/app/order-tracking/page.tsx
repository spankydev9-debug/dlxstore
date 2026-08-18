"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { getOrderById } from "../../services/db/orders";
import { isSupabaseConfigured, supabase } from "../../services/db";
import { Order } from "../../types";
import { useLanguage } from "../../context/LanguageContext";
import { 
  Truck, 
  MapPin, 
  MessageSquare, 
  CheckCircle2, 
  Clock, 
  Package, 
  ShieldCheck
} from "lucide-react";

function OrderTrackingContent() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get("orderId");
  const whatsappStatus = searchParams.get("whatsapp");
  const { language, t } = useLanguage();

  const [order, setOrder] = useState<Order | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadOrder() {
      if (!orderId) return;
      setIsLoading(true);
      try {
        const ord = await getOrderById(orderId);
        setOrder(ord);
      } catch (err) {
        console.error("Error loading order:", err);
      } finally {
        setIsLoading(false);
      }
    }

    loadOrder();

    const interval = setInterval(() => {
      if (orderId) getOrderById(orderId).then(setOrder).catch(console.error);
    }, 15000);

    const channel = isSupabaseConfigured && supabase && orderId
      ? supabase
          .channel(`order-${orderId}`)
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders", filter: `id=eq.${orderId}` }, () => {
            getOrderById(orderId).then(setOrder).catch(console.error);
          })
          .subscribe()
      : null;

    return () => {
      clearInterval(interval);
      if (channel && supabase) supabase.removeChannel(channel);
    };
  }, [orderId]);

  if (!orderId) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center space-y-4 animate-fade-in">
        <h1 className="text-xl font-bold text-destructive">{t.missingOrderId}</h1>
        <Link href="/shop" className="text-primary hover:underline text-sm font-semibold">{t.backToShop}</Link>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center space-y-4 animate-fade-in">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
        <p className="text-sm text-muted-foreground">{t.searchingOrder}</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center space-y-4 animate-fade-in">
        <h1 className="text-xl font-bold">{t.orderNotFound}</h1>
        <p className="text-xs text-muted-foreground">{t.orderNotFoundBody}</p>
        <Link href="/shop" className="text-primary hover:underline text-sm font-semibold">{t.backToShop}</Link>
      </div>
    );
  }

  // Progress Bar configuration
  const statusSteps = [
    { key: "pending", label: t.pending, desc: t.orderReceived, icon: Clock }, { key: "confirmed", label: t.confirmed, desc: t.teamValidated, icon: CheckCircle2 }, { key: "preparing", label: t.preparing, desc: t.packing, icon: Package }, { key: "ready", label: t.ready, desc: t.readyToShip, icon: ShieldCheck }, { key: "out_for_delivery", label: t.outForDelivery, desc: t.driverOnWay, icon: Truck }, { key: "delivered", label: t.delivered, desc: t.deliveredSuccess, icon: CheckCircle2 }
  ];

  // Find index of current status
  const currentStepIdx = statusSteps.findIndex(s => s.key === order.status);
  const isCancelled = order.status === "cancelled";

  return (
    <div className="space-y-8 animate-fade-in max-w-4xl mx-auto pb-16">
      {whatsappStatus && <p role="status" className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">{whatsappStatus === "opened" ? t.whatsappOpened : t.whatsappUnavailable}</p>}
      
      {/* Header info */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-border/40 pb-5 gap-4">
        <div>
          <span className="text-xs font-bold text-muted-foreground uppercase">{t.tracking}</span>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{t.orderNumber} #{order.id}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{t.orderPlaced} {new Date(order.created_at).toLocaleString(language === "fr" ? "fr-FR" : "en-US")}</p>
        </div>
        <Link
          href="/contact"
          className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-muted transition-all"
        >
          <MessageSquare className="h-4 w-4" />
          {t.contactSupport}
        </Link>
      </div>

      {/* Cancelled Alert */}
      {isCancelled ? (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/10 p-5 text-center space-y-2">
          <h3 className="font-bold text-destructive text-base">{t.cancelled}</h3><p className="text-xs text-muted-foreground">{t.cancelledBody}</p>
        </div>
      ) : (
        /* Progress Steps Timeline */
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h3 className="font-bold text-base text-foreground mb-6">{t.deliveryStatus}</h3>
          
          <div className="relative flex flex-col md:flex-row justify-between items-start md:items-center gap-8 md:gap-4">
            
            {/* Horizontal line (Desktop only) */}
            <div className="absolute left-6 right-6 top-[22px] hidden md:block h-1 bg-border -z-10">
              <div 
                className="h-full bg-primary transition-all duration-500" 
                style={{ width: `${(currentStepIdx / (statusSteps.length - 1)) * 100}%` }}
              ></div>
            </div>

            {statusSteps.map((step, index) => {
              const Icon = step.icon;
              const isCompleted = index <= currentStepIdx;
              const isCurrent = index === currentStepIdx;

              return (
                <div key={step.key} className="flex md:flex-col items-center md:text-center gap-4 md:gap-2 flex-1 w-full">
                  <div 
                    className={`flex h-11 w-11 items-center justify-center rounded-full border transition-all ${isCompleted ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground border-border'} ${isCurrent ? 'ring-4 ring-primary/20 scale-110' : ''}`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className={`text-xs font-bold ${isCurrent ? 'text-foreground text-sm' : isCompleted ? 'text-foreground' : 'text-muted-foreground'}`}>
                      {step.label}
                    </h4>
                    <p className="text-[10px] text-muted-foreground hidden md:block mt-0.5">{step.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Driver info card */}
      {!isCancelled && order.delivery?.driver_id && (
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">
          <h3 className="font-bold text-base text-foreground border-b border-border/40 pb-2">{t.assignedDriver}</h3>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                {order.delivery.driver_name?.charAt(0).toUpperCase()}
              </div>
              <div>
                <h4 className="font-bold text-sm text-foreground">{order.delivery.driver_name}</h4>
                <p className="text-xs text-muted-foreground mt-0.5">{t.driverContactNote}</p>
              </div>
            </div>
            
            <Link href="/contact" className="inline-flex items-center justify-center gap-2 h-9 rounded-full bg-emerald-600 text-white text-xs font-semibold px-4 hover:bg-emerald-700 transition-colors shadow-sm"><MessageSquare className="h-3.5 w-3.5" />{t.contactSupport}</Link>
          </div>
        </div>
      )}

      {/* Order Summary details */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Address */}
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">
          <h3 className="font-bold text-base text-foreground border-b border-border/40 pb-2">{t.deliveryAddress}</h3>
          <div className="space-y-2 text-xs sm:text-sm">
            <p className="font-bold text-foreground">{order.customer_name}</p>
            <p className="text-muted-foreground flex items-center gap-2">
              <MapPin className="h-4 w-4 text-primary flex-shrink-0" />
              <span>
                {t.neighborhoodLabel} {order.neighborhood}, {t.municipalityLabel} {order.municipality} <br />
                {t.avenueLabel} {order.avenue} {order.house_number ? `, N° ${order.house_number}` : ""} <br />
                Goma, {t.countryLabel}
              </span>
            </p>
            {order.delivery_notes && (
              <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground mt-2 italic">
                <strong>{t.landmark} :</strong> {order.delivery_notes}
              </div>
            )}
          </div>
        </div>

        {/* Invoice details */}
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">
          <h3 className="font-bold text-base text-foreground border-b border-border/40 pb-2">{t.financialDetails}</h3>
          
          <div className="divide-y divide-border/40 space-y-3">
            {order.items.map((item) => (
              <div key={item.id} className="flex justify-between py-2 text-xs sm:text-sm first:pt-0">
                <span className="text-muted-foreground">{item.product?.name || t.productFallback} (x{item.quantity})</span>
                <span className="font-semibold text-foreground">{item.price_at_sale * item.quantity} $</span>
              </div>
            ))}
            
            <div className="pt-3 space-y-2 text-xs sm:text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>{t.subtotal}</span>
                <span>{order.total_amount} $</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>{t.delivery}</span>
                <span className="text-emerald-600 font-semibold">{t.free}</span>
              </div>
              <div className="border-t border-border/45 pt-3 flex justify-between font-bold text-sm sm:text-base text-foreground">
                <span>{t.amountDue}</span>
                <span>{order.total_amount} $</span>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}

function OrderTrackingFallback() {
  const { t } = useLanguage();
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center space-y-4">
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      <p className="text-sm text-muted-foreground">{t.searchingOrder}</p>
    </div>
  );
}

export default function OrderTrackingPage() {
  return (
    <Suspense fallback={<OrderTrackingFallback />}>
      <OrderTrackingContent />
    </Suspense>
  );
}
