"use client";

import React, { useState } from "react";
import { supabase } from "../../services/db";
import { useLanguage } from "../../context/LanguageContext";
import { Send, Loader2 } from "lucide-react";

export function NotificationBroadcast() {
  const { t } = useLanguage();
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [type, setType] = useState<"promotion" | "new_drop" | "reward" | "system">("promotion");
  const [audience, setAudience] = useState<"customers" | "admins" | "all">("customers");
  const [isSending, setIsSending] = useState(false);
  const [result, setResult] = useState<{ count: number | null; error: string | null }>({ count: null, error: null });

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !message.trim()) return;

    setIsSending(true);
    setResult({ count: null, error: null });

    try {
      const client = supabase;
      if (!client) throw new Error("Supabase not configured");

      const { data, error } = await client.rpc("broadcast_notification", {
        p_title: title.trim(),
        p_message: message.trim(),
        p_type: type,
        p_audience: audience
      });

      if (error) throw error;

      setResult({ count: data ?? 0, error: null });
      setTitle("");
      setMessage("");
    } catch (err) {
      console.error("Error broadcasting notification:", err);
      setResult({ count: null, error: t.broadcastError });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={handleSend} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t.broadcastType}</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as any)}
              className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
            >
              <option value="promotion">{t.broadcastTypePromotion}</option>
              <option value="new_drop">{t.broadcastTypeNewDrop}</option>
              <option value="reward">{t.broadcastTypeReward}</option>
              <option value="system">{t.broadcastTypeSystem}</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t.broadcastAudience}</label>
            <select
              value={audience}
              onChange={(e) => setAudience(e.target.value as any)}
              className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
            >
              <option value="customers">{t.broadcastAudienceCustomers}</option>
              <option value="admins">{t.broadcastAudienceAdmins}</option>
              <option value="all">{t.broadcastAudienceAll}</option>
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t.broadcastTitle}</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Titre de la notification"
            maxLength={160}
            required
            className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t.broadcastMessage}</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Message de la notification"
            maxLength={500}
            required
            rows={4}
            className="w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-foreground resize-none"
          />
        </div>

        <button
          type="submit"
          disabled={isSending || !title.trim() || !message.trim()}
          className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground font-semibold px-6 py-2.5 text-xs hover:bg-primary/95 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t.loading}
            </>
          ) : (
            <>
              <Send className="h-4 w-4" />
              {t.broadcastSend}
            </>
          )}
        </button>
      </form>

      {result.error && (
        <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-4">
          <p className="text-xs font-semibold text-destructive">{result.error}</p>
        </div>
      )}

      {result.count !== null && (
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-4">
          <p className="text-xs font-semibold text-emerald-600">
            {t.broadcastSent.replace("{count}", String(result.count))}
          </p>
        </div>
      )}
    </div>
  );
}
