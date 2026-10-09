"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ImagePlus,
  Loader2,
  PackageSearch,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useLanguage } from "../../context/LanguageContext";
import { formatMoney } from "../../lib/format";
import {
  createCustomOrder,
  CustomOrdersUnavailableError,
  getMyCustomOrders,
  respondToCustomOrderQuote,
  setCustomOrderStatus,
  uploadCustomOrderImage,
  CUSTOM_ORDER_MAX_IMAGES,
} from "../../services/db/custom-orders";
import type { CustomOrderContactPreference, CustomOrderRequest, CustomOrderStatus } from "../../types";

/** Minor units -> display. DLXSTORE stores money as integer cents. */
function fromCents(cents: number): number {
  return cents / 100;
}

const STATUS_LABEL_KEYS = {
  open: "customStatusOpen",
  quoted: "customStatusQuoted",
  accepted: "customStatusAccepted",
  declined: "customStatusDeclined",
  cancelled: "customStatusCancelled",
  fulfilled: "customStatusFulfilled",
} as const;

export function CustomOrdersPanel() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [requests, setRequests] = useState<CustomOrderRequest[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "unavailable" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadState("loading");
    try {
      const list = await getMyCustomOrders();
      setRequests(list);
      setLoadState("ready");
      setError(null);
    } catch (cause) {
      if (cause instanceof CustomOrdersUnavailableError) {
        setLoadState("unavailable");
      } else {
        setError(cause instanceof Error ? cause.message : "Something went wrong.");
        setLoadState("error");
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const cancel = useCallback(
    async (id: string) => {
      setBusyId(id);
      setError(null);
      try {
        await setCustomOrderStatus(id, "cancelled");
        await load();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not cancel this request.");
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const respond = useCallback(
    async (quoteId: string, accept: boolean) => {
      setBusyId(quoteId);
      setError(null);
      try {
        await respondToCustomOrderQuote(quoteId, accept);
        await load();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not respond to this quote.");
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
            {t.customTitle}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">{t.customIntro}</p>
        </div>
        {user ? (
          <button
            type="button"
            onClick={() => setComposing((open) => !open)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-bold text-primary-foreground transition-colors hover:bg-primary/95"
          >
            <ImagePlus className="h-3.5 w-3.5" />
            {t.customNewRequest}
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      ) : null}

      {composing && user ? (
        <CustomOrderComposer
          userId={user.id}
          busy={false}
          onSubmitted={async () => {
            setComposing(false);
            await load();
          }}
          onCancel={() => setComposing(false)}
        />
      ) : null}

      {requests.length === 0 ? (
        <p className="rounded-xl border border-border/50 bg-muted/20 p-6 text-center text-xs text-muted-foreground">
          {t.customEmpty}
        </p>
      ) : (
        <ul className="space-y-4">
          {requests.map((request) => (
            <CustomOrderCard
              key={request.id}
              request={request}
              busy={busyId === request.id}
              onCancel={() => void cancel(request.id)}
              onRespond={(quoteId, accept) => void respond(quoteId, accept)}
              quoteBusy={(quoteId) => busyId === quoteId}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * New-request form.
 *
 * Reference images are uploaded as they are chosen (each to the caller's own
 * folder) so a submission carries final public URLs; a failed upload is shown
 * inline and the file is not added, so an attachment is never silently lost.
 */
function CustomOrderComposer({
  userId,
  busy,
  onSubmitted,
  onCancel,
}: {
  userId: string;
  busy: boolean;
  onSubmitted: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [budget, setBudget] = useState("");
  const [contact, setContact] = useState<CustomOrderContactPreference>("chat");
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const addFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setLocalError(null);
      const room = CUSTOM_ORDER_MAX_IMAGES - images.length;
      if (room <= 0) {
        setLocalError(t.customTooManyImages.replace("{max}", String(CUSTOM_ORDER_MAX_IMAGES)));
        return;
      }
      const chosen = Array.from(files).slice(0, room);
      setUploading(true);
      const uploaded: string[] = [];
      const failures: string[] = [];
      for (const file of chosen) {
        try {
          uploaded.push(await uploadCustomOrderImage(userId, file));
        } catch (cause) {
          failures.push(cause instanceof Error ? cause.message : "Upload failed.");
        }
      }
      setUploading(false);
      if (uploaded.length > 0) setImages((current) => [...current, ...uploaded]);
      if (failures.length > 0) setLocalError(failures[0]);
    },
    [images.length, userId, t.customTooManyImages],
  );

  const submit = useCallback(async () => {
    setLocalError(null);
    const trimmedTitle = title.trim();
    const trimmedDetails = details.trim();
    if (trimmedTitle.length < 3) {
      setLocalError(t.customTitleTooShort);
      return;
    }
    if (trimmedDetails.length < 10) {
      setLocalError(t.customDetailsTooShort);
      return;
    }
    // Budget is optional. An empty field means "no figure in mind", never zero.
    let budgetCents: number | null = null;
    if (budget.trim() !== "") {
      const parsed = Number(budget);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setLocalError(t.customBudgetInvalid);
        return;
      }
      budgetCents = Math.round(parsed * 100);
    }
    setSubmitting(true);
    try {
      await createCustomOrder({
        title: trimmedTitle,
        details: trimmedDetails,
        budgetCents,
        contactPreference: contact,
        referenceImageUrls: images,
      });
      await onSubmitted();
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : "Could not submit your request.");
    } finally {
      setSubmitting(false);
    }
  }, [title, details, budget, contact, images, onSubmitted, t]);

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-muted/30 p-4">
      <div className="flex items-center justify-between">
        <h4 className="flex items-center gap-2 text-sm font-bold text-foreground">
          <PackageSearch className="h-4 w-4 text-primary" />
          {t.customNewRequest}
        </h4>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted"
          aria-label={t.customCancel}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {localError ? (
        <p className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {localError}
        </p>
      ) : null}

      <label className="block text-xs font-bold text-foreground">
        {t.customTitleLabel}
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={120}
          className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm font-normal text-foreground outline-none focus:border-primary"
          placeholder={t.customTitlePlaceholder}
        />
      </label>

      <label className="block text-xs font-bold text-foreground">
        {t.customDetailsLabel}
        <textarea
          value={details}
          onChange={(event) => setDetails(event.target.value)}
          rows={4}
          maxLength={2000}
          className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm font-normal text-foreground outline-none focus:border-primary"
          placeholder={t.customDetailsPlaceholder}
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-xs font-bold text-foreground">
          {t.customBudgetLabel}
          <input
            value={budget}
            onChange={(event) => setBudget(event.target.value)}
            inputMode="decimal"
            className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm font-normal text-foreground outline-none focus:border-primary"
            placeholder={t.customBudgetPlaceholder}
          />
        </label>
        <label className="block text-xs font-bold text-foreground">
          {t.customContactLabel}
          <select
            value={contact}
            onChange={(event) => setContact(event.target.value as CustomOrderContactPreference)}
            className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm font-normal text-foreground outline-none focus:border-primary"
          >
            <option value="chat">{t.customContactChat}</option>
            <option value="whatsapp">{t.customContactWhatsapp}</option>
          </select>
        </label>
      </div>

      <div>
        <p className="text-xs font-bold text-foreground">
          {t.customReferencesLabel.replace("{count}", String(images.length)).replace("{max}", String(CUSTOM_ORDER_MAX_IMAGES))}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {images.map((url, index) => (
            <span key={url} className="relative h-16 w-16 overflow-hidden rounded-lg border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => setImages((current) => current.filter((_, i) => i !== index))}
                className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white"
                aria-label={t.customRemoveImage}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </span>
          ))}
          {images.length < CUSTOM_ORDER_MAX_IMAGES ? (
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="flex h-16 w-16 items-center justify-center rounded-lg border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-primary/50 disabled:opacity-50"
              aria-label={t.customAddReference}
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
            </button>
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(event) => {
              void addFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-border px-4 py-2 text-xs font-bold text-muted-foreground transition-colors hover:bg-muted"
        >
          {t.customCancel}
        </button>
        <button
          type="button"
          disabled={submitting || uploading || busy}
          onClick={() => void submit()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground transition-colors hover:bg-primary/95 disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {submitting ? t.customSubmitting : t.customSubmit}
        </button>
      </div>
    </div>
  );
}

/**
 * One request with its quotations.
 *
 * The current quote is the newest one still `sent`; once the customer accepts
 * or declines it, the request status already reflects the outcome, so the card
 * only offers actions when there is genuinely something to do.
 */
function CustomOrderCard({
  request,
  busy,
  onCancel,
  onRespond,
  quoteBusy,
}: {
  request: CustomOrderRequest;
  busy: boolean;
  onCancel: () => void;
  onRespond: (quoteId: string, accept: boolean) => void;
  quoteBusy: (quoteId: string) => boolean;
}) {
  const { t } = useLanguage();
  const currentQuote = request.quotes.find((quote) => quote.status === "sent") ?? null;
  const canCancel = request.status === "open" || request.status === "quoted";

  return (
    <li className="space-y-3 rounded-2xl border border-border/60 bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-bold text-foreground">{request.title}</h4>
          <p className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            {new Date(request.created_at).toLocaleDateString()}
            {request.budget_cents != null ? (
              <span>
                · {t.customBudgetYou}: {formatMoney(fromCents(request.budget_cents))}
              </span>
            ) : null}
          </p>
        </div>
        <StatusPill status={request.status} />
      </div>

      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{request.details}</p>

      {request.reference_image_urls.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {request.reference_image_urls.map((url) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={url}
              src={url}
              alt=""
              className="h-20 w-20 rounded-lg border border-border object-cover"
            />
          ))}
        </div>
      ) : null}

      {currentQuote ? (
        <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
          <p className="flex items-center gap-2 text-xs font-bold text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            {t.customQuoteReady}
          </p>
          <p className="text-lg font-extrabold text-foreground">
            {formatMoney(fromCents(currentQuote.price_cents))}
          </p>
          {currentQuote.message ? (
            <p className="whitespace-pre-wrap text-xs text-muted-foreground">{currentQuote.message}</p>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={quoteBusy(currentQuote.id)}
              onClick={() => onRespond(currentQuote.id, true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground transition-colors hover:bg-primary/95 disabled:opacity-50"
            >
              {quoteBusy(currentQuote.id) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              {t.customAcceptQuote}
            </button>
            <button
              type="button"
              disabled={quoteBusy(currentQuote.id)}
              onClick={() => onRespond(currentQuote.id, false)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-bold text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" />
              {t.customDeclineQuote}
            </button>
          </div>
        </div>
      ) : request.status === "quoted" ? (
        <p className="rounded-xl border border-border/50 bg-muted/20 p-3 text-xs text-muted-foreground">
          {t.customQuotePending}
        </p>
      ) : null}

      {canCancel ? (
        <div className="flex justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-[11px] font-bold text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t.customCancelRequest}
          </button>
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
