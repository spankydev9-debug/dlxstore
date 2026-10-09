"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Order } from "../../types";
import { useChat } from "../../context/ChatContext";
import { useLanguage } from "../../context/LanguageContext";
import { getStoreSettings } from "../../services/db/settings";
import { recordOrderWhatsAppHandoff } from "../../services/db/orders";
import { buildWhatsAppUrl, buildOrderOperationalMessage, getWhatsAppBuyNumber } from "../../lib/whatsapp";
import { MessageSquare, CheckCircle2, Eye, Loader2 } from "lucide-react";

export interface PurchaseContinueItem {
  product?: { name?: string };
  quantity: number;
  price_at_sale: number;
  size?: string;
  color?: string;
}

interface PurchaseContinueDialogProps {
  order: Order;
  items: PurchaseContinueItem[];
  onDismiss: () => void;
}

export default function PurchaseContinueDialog({ order, items, onDismiss }: PurchaseContinueDialogProps) {
  const router = useRouter();
  const { openSupportConversation, sendMessage } = useChat();
  const { t } = useLanguage();
  const [actionBusy, setActionBusy] = useState<"chat" | "whatsapp" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const orderPayload = {
    id: order.id,
    customer_name: order.customer_name,
    phone_number: order.phone_number,
    municipality: order.municipality,
    neighborhood: order.neighborhood,
    avenue: order.avenue,
    house_number: order.house_number,
    delivery_notes: order.delivery_notes,
    total_amount: order.total_amount,
    status: order.status,
    items,
  };

  const handleContinueInChat = async () => {
    if (actionBusy) return;
    setActionBusy("chat");
    setError(null);
    try {
      const conversation = await openSupportConversation(order.id);
      if (!conversation) {
        setError(t.purchaseChatUnavailable);
        setActionBusy(null);
        return;
      }
      try {
        await sendMessage(buildOrderOperationalMessage(orderPayload));
      } catch (sendErr) {
        // The conversation is still linked to the order; a failed transcript
        // message must not block the customer from reaching the chat.
        console.warn("Order summary message could not be sent:", sendErr);
      }
      router.push("/chat");
    } catch (err) {
      console.error("Error continuing in DLX Chat:", err);
      setError(t.purchaseChatUnavailable);
      setActionBusy(null);
    }
  };

  const handleContinueOnWhatsApp = async () => {
    if (actionBusy) return;
    setActionBusy("whatsapp");
    setError(null);
    let whatsappStatus: "link_opened" | "unavailable" | "not_configured" = "not_configured";
    try {
      const settings = await getStoreSettings();
      const number = getWhatsAppBuyNumber(settings);
      const url = number ? buildWhatsAppUrl(number, buildOrderOperationalMessage(orderPayload)) : null;
      if (url) {
        const handoffWindow = window.open(url, "_blank", "noopener,noreferrer");
        whatsappStatus = handoffWindow ? "link_opened" : "unavailable";
      } else {
        setError(t.purchaseWhatsAppUnavailable);
        setActionBusy(null);
        return;
      }
    } catch (err) {
      console.warn("WhatsApp handoff unavailable; order was created.", err);
    }
    try {
      await recordOrderWhatsAppHandoff(order.id, whatsappStatus);
    } catch (handoffError) {
      console.warn("Order handoff state was not recorded:", handoffError);
    }
    router.push(`/order-tracking?orderId=${order.id}&whatsapp=${whatsappStatus}`);
  };

  const handleViewStatus = () => {
    if (actionBusy) return;
    onDismiss();
    router.push(`/order-tracking?orderId=${order.id}`);
  };

  const body = t.purchaseContinueBody.replace("{ref}", order.id);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      data-continue-dialog="true"
      role="dialog"
      aria-modal="true"
      aria-label={t.purchaseContinueTitle}
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl animate-fade-in">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" />
          <h2 className="text-lg font-extrabold text-foreground">{t.purchaseContinueTitle}</h2>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">{body}</p>

        {error && (
          <p role="alert" className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="mt-5 grid grid-cols-1 gap-3" data-purchase-continue-actions="true">
          <button
            type="button"
            onClick={handleContinueInChat}
            disabled={actionBusy !== null}
            className="inline-flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-4 text-left transition-all hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
            data-continue-chat
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
              {actionBusy === "chat" ? <Loader2 className="h-5 w-5 animate-spin" /> : <MessageSquare className="h-5 w-5" />}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-bold text-foreground">{t.continueInDlxChat}</span>
              <span className="block text-xs text-muted-foreground">{t.continueInDlxChatBody}</span>
            </span>
          </button>

          <button
            type="button"
            onClick={handleContinueOnWhatsApp}
            disabled={actionBusy !== null}
            className="inline-flex items-center gap-3 rounded-xl border border-emerald-600/30 bg-emerald-600/5 px-4 py-4 text-left transition-all hover:bg-emerald-600/10 disabled:cursor-not-allowed disabled:opacity-60"
            data-continue-whatsapp
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
              {actionBusy === "whatsapp" ? <Loader2 className="h-5 w-5 animate-spin" /> : <MessageSquare className="h-5 w-5" />}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-bold text-foreground">{t.continueOnWhatsApp}</span>
              <span className="block text-xs text-muted-foreground">{t.continueOnWhatsAppBody}</span>
            </span>
          </button>
        </div>

        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={handleViewStatus}
            disabled={actionBusy !== null}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            data-continue-status
          >
            <Eye className="h-4 w-4" />
            {t.viewOrderStatus}
          </button>
        </div>
      </div>
    </div>
  );
}