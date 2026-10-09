"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Clock,
  Loader2,
  MessageSquare,
  PackageSearch,
  RefreshCw,
} from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { formatMoney } from "../../lib/format";
import {
  listCustomOrdersForReview,
  setCustomOrderStatus,
  submitCustomOrderQuote,
  CustomOrdersUnavailableError,
} from "../../services/db/custom-orders";
import type { CustomOrderReviewItem, CustomOrderStatus } from "../../types";

const STATUS_LABEL_KEYS = {
  open: "customStatusOpen",
  quoted: "customStatusQuoted",
  accepted: "customStatusAccepted",
  declined: "customStatusDeclined",
  cancelled: "customStatusCancelled",
  fulfilled: "customStatusFulfilled",
} as const;

const FILTERS: Array<{ value: CustomOrderStatus | ""; key: "customFilterAll" | "customStatusOpen" | "customStatusQuoted" | "customStatusAccepted" | "customStatusFulfilled" | "customStatusCancelled" }> = [
  { value: "", key: "customFilterAll" },
  { value: "open", key: "customStatusOpen" },
  { value: "quoted", key: "customStatusQuoted" },
  { value: "accepted", key: "customStatusAccepted" },
  { value: "fulfilled", key: "customStatusFulfilled" },
  { value: "cancelled", key: "customStatusCancelled" },
];

/**
 * Reviewer console for custom orders (admin/staff).
 *
 * Lists incoming requests, shows reference images and the customer's contact
 * preference, and lets a reviewer send a real quotation or advance the status.
 * The database enforces the admin/staff gate; a non-reviewer sees an honest
 * error rather than an empty screen.
 */
export function CustomOrdersConsole() {
  const { t } = useLanguage();
  const [items, setItems] = useState<CustomOrderReviewItem[]>([]);
  const [status, setStatus] = useState<CustomOrderStatus | "">("");
  const [loadState, setLoadState] = useState<"loading" | "ready" | "unavailable" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadState((current) => (current === "ready" ? "ready" : "loading"));
    try {
      const list = await listCustomOrdersForReview(status);
      setItems(list);
      setLoadState("ready");
      setError(null);
    } catch (cause) {
      if (cause instanceof CustomOrdersUnavailableError) {
        setLoadState("unavailable");
      } else {
        setError(cause instanceof Error ? cause.message : "Could not load requests.");
        setLoadState("error");
      }
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const advance = useCallback(
    async (id: string, next: CustomOrderStatus) => {
      setBusyId(id);
      setError(null);
      try {
        await setCustomOrderStatus(id, next);
        await load();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not update this request.");
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  if (loadState === "loading") {
    return (
      <p className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t.customLoading}
      </p>
    );
  }

  if (loadState === "unavailable") {
    return (
      <div className="space-y-3 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-5">
        <p className="flex items-center gap-2 font-bold text-amber-700 dark:text-amber-400">
          <AlertCircle className="h-4 w-4" />
          {t.customUnavailableTitle}
        </p>
        <p className="text-sm text-amber-700/90 dark:text-amber-400/90">{t.customUnavailableBody}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/40 pb-4">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-bold text-foreground">
            <PackageSearch className="h-5 w-5 text-primary" />
            {t.customReviewTitle}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">{t.customReviewIntro}</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border px-3 text-xs font-bold transition-colors hover:bg-muted"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {t.storiesRefresh}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            onClick={() => setStatus(filter.value)}
            className={`rounded-full border px-3 py-1 text-[11px] font-bold transition-colors ${
              status === filter.value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:border-primary/50"
            }`}
          >
            {t[filter.key]}
          </button>
        ))}
      </div>

      {error ? (
        <p className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="rounded-xl border border-border/50 bg-muted/20 p-6 text-center text-xs text-muted-foreground">
          {t.customReviewEmpty}
        </p>
      ) : (
        <ul className="space-y-4">
          {items.map((item) => (
            <ReviewCard
              key={item.id}
              item={item}
              busy={busyId === item.id}
              onAdvance={(next) => void advance(item.id, next)}
              onQuoted={() => setBusyId(null)}
              setBusy={(value) => setBusyId(value ? item.id : null)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One request in the reviewer queue, with an inline quotation form.
 *
 * The price is the reviewer's real number in dollars, converted to cents here.
 * Submitting sends it through `submit_custom_order_quote`, which supersedes any
 * prior quote and notifies the customer. Nothing is fabricated or pre-filled.
 */
function ReviewCard({
  item,
  busy,
  onAdvance,
  onQuoted,
  setBusy,
}: {
  item: CustomOrderReviewItem;
  busy: boolean;
  onAdvance: (next: CustomOrderStatus) => void;
  onQuoted: () => void;
  setBusy: (value: boolean) => void;
}) {
  const { t } = useLanguage();
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [price, setPrice] = useState("");
  const [message, setMessage] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const submitQuote = useCallback(async () => {
    setLocalError(null);
    const parsed = Number(price);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setLocalError(t.customQuoteInvalid);
      return;
    }
    setBusy(true);
    try {
      await submitCustomOrderQuote(item.id, Math.round(parsed * 100), message.trim() || undefined);
      setQuoteOpen(false);
      setPrice("");
      setMessage("");
      onQuoted();
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : "Could not send the quote.");
      setBusy(false);
    }
  }, [price, message, item.id, setBusy, onQuoted, t.customQuoteInvalid]);

  const canQuote = item.status === "open" || item.status === "quoted";
  const canFulfill = item.status === "accepted";
  const canDecline = item.status === "open" || item.status === "quoted";

  return (
    <li className="space-y-3 rounded-2xl border border-border/60 bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-bold text-foreground">{item.title}</h4>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span className="font-semibold text-foreground">{item.customer_name}</span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {new Date(item.created_at).toLocaleDateString()}
            </span>
            <span className="flex items-center gap-1">
              <MessageSquare className="h-3 w-3" />
              {item.contact_preference === "whatsapp" ? t.customContactWhatsapp : t.customContactChat}
            </span>
            {item.budget_cents != null ? (
              <span>· {t.customBudgetYou}: {formatMoney(item.budget_cents / 100)}</span>
            ) : null}
          </p>
        </div>
        <StatusPill status={item.status} />
      </div>

      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{item.details}</p>

      {item.reference_image_urls.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {item.reference_image_urls.map((url) => (
            <a key={url} href={url} target="_blank" rel="noopener noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt=""
                className="h-20 w-20 rounded-lg border border-border object-cover transition-transform hover:scale-105"
              />
            </a>
          ))}
        </div>
      ) : null}

      {item.quote_count > 0 ? (
        <p className="text-[11px] text-muted-foreground">
          {t.customQuoteCount.replace("{count}", String(item.quote_count))}
        </p>
      ) : null}

      {localError ? (
        <p className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {localError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {canQuote ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => setQuoteOpen((open) => !open)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground transition-colors hover:bg-primary/95 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {t.customSendQuote}
          </button>
        ) : null}
        {canFulfill ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onAdvance("fulfilled")}
            className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-600 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
          >
            {t.customMarkFulfilled}
          </button>
        ) : null}
        {canDecline ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onAdvance("declined")}
            className="rounded-lg border border-destructive/40 px-3 py-2 text-xs font-bold text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
          >
            {t.customMarkDeclined}
          </button>
        ) : null}
      </div>

      {quoteOpen ? (
        <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-bold text-foreground">
              {t.customQuotePriceLabel}
              <input
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                inputMode="decimal"
                className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm font-normal text-foreground outline-none focus:border-primary"
                placeholder="0.00"
              />
            </label>
            <label className="block text-xs font-bold text-foreground">
              {t.customQuoteMessageLabel}
              <input
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                maxLength={500}
                className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm font-normal text-foreground outline-none focus:border-primary"
                placeholder={t.customQuoteMessagePlaceholder}
              />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setQuoteOpen(false)}
              className="rounded-lg border border-border px-3 py-2 text-xs font-bold text-muted-foreground transition-colors hover:bg-muted"
            >
              {t.customCancel}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void submitQuote()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground transition-colors hover:bg-primary/95 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {t.customSendQuote}
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function StatusPill({ status }: { status: CustomOrderStatus }) {
  const { t } = useLanguage();
  const tones: Record<CustomOrderStatus, string> = {
    open: "border-border bg-muted/40 text-muted-foreground",
    quoted: "border-primary/30 bg-primary/10 text-primary",
    accepted: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600",
    declined: "border-destructive/30 bg-destructive/10 text-destructive",
    cancelled: "border-border bg-muted/40 text-muted-foreground",
    fulfilled: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600",
  };
  return (
    <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold ${tones[status]}`}>
      {t[STATUS_LABEL_KEYS[status]]}
    </span>
  );
}
