"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, MessageSquare } from "lucide-react";

import { useLanguage } from "../../context/LanguageContext";
import { languages } from "../../lib/i18n";
import {
  getMyMessageOptIns,
  setMyMessageLocale,
  setMyMessageOptIn,
} from "../../services/db/messaging";
import type { MessageOptIns } from "../../types";

// ---------------------------------------------------------------------------
// P13 — customer communication preferences.
//
// This is the consent surface for the whole marketing system, so it states one
// thing precisely: declining marketing does not stop order confirmations. Those
// are transactional, tied to an order the customer placed, and are sent whatever
// this switch says.
//
// The transactional/marketing distinction is enforced in SQL
// (`enqueue_message_core`), not here. This component only reflects and changes
// the caller's own flags, resolved from `auth.uid()`.
// ---------------------------------------------------------------------------

function Toggle({
  checked,
  disabled,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex items-start justify-between gap-4 py-2">
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-foreground">{label}</span>
        {hint && (
          <span className="block text-[11px] leading-relaxed text-muted-foreground">
            {hint}
          </span>
        )}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
          checked ? "bg-primary" : "bg-muted"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition-all ${
            checked ? "left-[22px]" : "left-0.5"
          }`}
        />
      </button>
    </label>
  );
}

export function MessagingPreferences() {
  const { t } = useLanguage();

  const [prefs, setPrefs] = useState<MessageOptIns | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPrefs(await getMyMessageOptIns());
    } catch (err) {
      setError(err instanceof Error ? err.message : t.messagingLoadError);
    } finally {
      setLoading(false);
    }
  }, [t.messagingLoadError]);

  useEffect(() => {
    void load();
  }, [load]);

  // Any change resets the confirmation so it always describes the latest save.
  function markSaving() {
    setSaved(false);
    setSaving(true);
  }

  async function apply(action: () => Promise<MessageOptIns>) {
    markSaving();
    setError(null);
    try {
      setPrefs(await action());
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.messagingLoadError);
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t.messagingRefreshing}
      </div>
    );
  }

  return (
    <div className="space-y-5 rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">
          {t.messagingOptInTitle}
        </h3>
      </div>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      <div className="divide-y divide-border/60">
        <Toggle
          checked={prefs?.whatsapp_marketing ?? false}
          disabled={saving}
          label={t.messagingOptInWhatsapp}
          hint={t.messagingOptInMarketingHint}
          onChange={(next) =>
            void apply(() => setMyMessageOptIn("whatsapp", next))
          }
        />
        <Toggle
          checked={prefs?.email_marketing ?? false}
          disabled={saving}
          label={t.messagingOptInEmail}
          hint={t.messagingOptInMarketingHint}
          onChange={(next) => void apply(() => setMyMessageOptIn("email", next))}
        />
      </div>

      <p className="rounded-xl bg-muted/60 p-3 text-[11px] leading-relaxed text-muted-foreground">
        {t.messagingTransactionalNote}
      </p>

      <div className="space-y-2 border-t border-border/60 pt-4">
        <label className="flex flex-wrap items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-foreground">
              {t.messagingOptInLanguage}
            </span>
            <span className="block text-[11px] text-muted-foreground">
              {t.messagingOptInLanguageHint}
            </span>
          </span>
          <select
            value={prefs?.locale ?? "fr"}
            disabled={saving}
            onChange={(e) => void apply(() => setMyMessageLocale(e.target.value))}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold text-foreground disabled:opacity-50"
          >
            {languages.map((language) => (
              <option key={language.code} value={language.code}>
                {language.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center gap-2 text-[11px] font-semibold">
        {saving && (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">{t.messagingSaving}</span>
          </>
        )}
        {!saving && saved && (
          <>
            <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
            <span className="text-green-700 dark:text-green-400">{t.messagingSaved}</span>
          </>
        )}
      </div>
    </div>
  );
}
