"use client";

import {
  AlertCircle,
  Check,
  Copy,
  Crown,
  Gift,
  Loader2,
  Percent,
  Sparkles,
  Timer,
  Truck,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "../../context/LanguageContext";
import {
  applyReferralCode,
  dismissPromotion,
  getActiveBundles,
  getActiveFlashSales,
  getCartRecoveryOffer,
  getLoyaltySummary,
  getPersonalizedPromotions,
  getPointsHistory,
  getReferrals,
} from "../../services/db/loyalty";
import type { TranslationKeys } from "../../lib/i18n";
import type {
  BundleSummary,
  CartRecoveryOffer,
  FlashSaleItem,
  LoyaltySummary,
  PersonalizedPromotion,
  PointsEntry,
  PointsReason,
  ReferralSummary,
} from "../../types";

type StringKey = {
  [K in keyof TranslationKeys]: TranslationKeys[K] extends string ? K : never;
}[keyof TranslationKeys];

const REASON_LABEL: Record<PointsReason, StringKey> = {
  order_delivered: "loyaltyReasonOrder",
  streak: "loyaltyReasonStreak",
  referral_earned: "loyaltyReasonReferralEarned",
  referral_signed_up: "loyaltyReasonReferralSignup",
  birthday: "loyaltyReasonBirthday",
  redemption: "loyaltyReasonRedemption",
  admin_adjustment: "loyaltyReasonAdmin",
  recovery: "loyaltyReasonRecovery",
};

function formatDate(value: string, locale: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(parsed);
}

/**
 * Growth & loyalty panel (ROADMAP Phase 17 / P11).
 *
 * Read-only with respect to money: points, tiers and referral qualification are
 * all decided by SECURITY DEFINER RPCs. The only writes here are applying a
 * referral code and dismissing an offer, both of which the RPC scopes to the
 * signed-in customer.
 */
export function LoyaltyPanel() {
  const { t, language } = useLanguage();

  const [summary, setSummary] = useState<LoyaltySummary | null>(null);
  const [history, setHistory] = useState<PointsEntry[]>([]);
  const [referrals, setReferrals] = useState<ReferralSummary | null>(null);
  const [promotions, setPromotions] = useState<PersonalizedPromotion[]>([]);
  const [flashSales, setFlashSales] = useState<FlashSaleItem[]>([]);
  const [bundles, setBundles] = useState<BundleSummary[]>([]);
  const [recovery, setRecovery] = useState<CartRecoveryOffer | null>(null);

  const [loadState, setLoadState] = useState<"loading" | "ready" | "unavailable" | "error">(
    "loading",
  );
  const [error, setError] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [codeMessage, setCodeMessage] = useState<string | null>(null);
  const [codeOk, setCodeOk] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const locale = language ?? "en";

  const load = useCallback(async () => {
    setLoadState("loading");
    setError(null);
    try {
      const [s, h, r, p, f, b, rec] = await Promise.all([
        getLoyaltySummary(),
        getPointsHistory(15),
        getReferrals(),
        getPersonalizedPromotions(),
        getActiveFlashSales().catch(() => []),
        getActiveBundles().catch(() => []),
        getCartRecoveryOffer(),
      ]);
      setSummary(s);
      setHistory(h);
      setReferrals(r);
      setPromotions(p);
      setFlashSales(f);
      setBundles(b);
      setRecovery(rec);
      setLoadState("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : t.loyaltyLoadError);
      setLoadState("error");
    }
  }, [t.loyaltyLoadError]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCopy = useCallback(async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, []);

  const handleApplyCode = useCallback(async () => {
    const value = codeInput.trim();
    if (!value) return;
    setBusy(true);
    setCodeMessage(null);
    setCodeOk(null);
    try {
      const message = await applyReferralCode(value);
      setCodeMessage(message);
      setCodeOk(message === "ok");
      if (message === "ok") {
        setCodeInput("");
        await load();
      }
    } catch (err) {
      setCodeMessage(err instanceof Error ? err.message : t.loyaltyLoadError);
      setCodeOk(false);
    } finally {
      setBusy(false);
    }
  }, [codeInput, load, t.loyaltyLoadError]);

  const handleDismiss = useCallback(
    async (id: string) => {
      setPromotions((current) => current.filter((item) => item.id !== id));
      try {
        await dismissPromotion(id);
      } catch {
        void load();
      }
    },
    [load],
  );

  if (loadState === "loading") {
    return (
      <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t.loyaltyLoading}
      </p>
    );
  }

  if (loadState === "error") {
    return (
      <div className="space-y-3 rounded-2xl border border-destructive/40 bg-destructive/5 p-5">
        <p className="flex items-center gap-2 font-bold text-destructive">
          <AlertCircle className="h-4 w-4" />
          {t.loyaltyLoadError}
        </p>
        {error ? <p className="text-xs text-destructive/90">{error}</p> : null}
      </div>
    );
  }

  const progress =
    summary && summary.points_to_next_tier > 0
      ? Math.min(
          100,
          Math.max(
            0,
            Math.round(
              (summary.lifetime_earned /
                (summary.lifetime_earned + summary.points_to_next_tier)) *
                100,
            ),
          ),
        )
      : 100;

  return (
    <div className="space-y-6">
      {recovery ? (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-5">
          <p className="flex items-center gap-2 font-bold text-amber-700 dark:text-amber-400">
            <Timer className="h-4 w-4" />
            {t.loyaltyRecoveryTitle}
          </p>
          <p className="mt-1 text-sm text-amber-700/90 dark:text-amber-400/90">
            {t.loyaltyRecoveryBody.replace("{n}", String(Math.round(recovery.discount_percent)))}
          </p>
          <a
            href="/cart"
            className="mt-3 inline-flex rounded-full bg-amber-600 px-4 py-2 text-sm font-semibold text-white"
          >
            {t.loyaltyRecoveryCta}
          </a>
        </div>
      ) : null}

      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Crown className="h-4 w-4" />
              {t.loyaltyTier}
            </p>
            <p className="mt-1 text-2xl font-bold">{summary?.tier_label ?? t.loyaltyTier}</p>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t.loyaltyBalance}
            </p>
            <p className="text-2xl font-bold tabular-nums">{summary?.balance ?? 0}</p>
          </div>
        </div>

        <div className="mt-4">
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {summary && summary.points_to_next_tier > 0
              ? t.loyaltyNextTier
                  .replace("{n}", String(summary.points_to_next_tier))
                  .replace("{tier}", summary.next_tier_label)
              : t.loyaltyTopTier}
          </p>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {(summary?.discount_percent ?? 0) > 0 ? (
            <p className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-sm">
              <Percent className="h-4 w-4 shrink-0" />
              {t.loyaltyBenefitDiscount.replace(
                "{n}",
                String(Math.round(summary?.discount_percent ?? 0)),
              )}
            </p>
          ) : null}
          {summary?.free_shipping ? (
            <p className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-sm">
              <Truck className="h-4 w-4 shrink-0" />
              {t.loyaltyBenefitFreeShipping}
            </p>
          ) : null}
          {summary?.early_access ? (
            <p className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-sm">
              <Sparkles className="h-4 w-4 shrink-0" />
              {t.loyaltyBenefitEarlyAccess}
            </p>
          ) : null}
          {(summary?.points_multiplier ?? 1) > 1 ? (
            <p className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-sm">
              <Sparkles className="h-4 w-4 shrink-0" />
              {t.loyaltyBenefitMultiplier.replace(
                "{n}",
                String(summary?.points_multiplier ?? 1),
              )}
            </p>
          ) : null}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <h3 className="flex items-center gap-2 font-bold">
          <Users className="h-4 w-4" />
          {t.loyaltyReferralTitle}
        </h3>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <code className="rounded-lg bg-muted px-3 py-2 text-sm font-semibold tracking-wide">
            {referrals?.code || summary?.referral_code || "—"}
          </code>
          <button
            type="button"
            onClick={() => void handleCopy(referrals?.code || summary?.referral_code || "")}
            disabled={!(referrals?.code || summary?.referral_code)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? t.loyaltyReferralCopied : t.loyaltyReferralCopy}
          </button>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-muted px-2 py-3">
            <p className="text-lg font-bold tabular-nums">{referrals?.total ?? 0}</p>
            <p className="text-[11px] text-muted-foreground">{t.loyaltyReferralInvited}</p>
          </div>
          <div className="rounded-xl bg-muted px-2 py-3">
            <p className="text-lg font-bold tabular-nums">{referrals?.qualified ?? 0}</p>
            <p className="text-[11px] text-muted-foreground">{t.loyaltyReferralQualified}</p>
          </div>
          <div className="rounded-xl bg-muted px-2 py-3">
            <p className="text-lg font-bold tabular-nums">{referrals?.rewarded ?? 0}</p>
            <p className="text-[11px] text-muted-foreground">{t.loyaltyReferralRewarded}</p>
          </div>
        </div>

        <div className="mt-4">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t.loyaltyReferralApply}
          </label>
          <div className="mt-1.5 flex flex-wrap gap-2">
            <input
              value={codeInput}
              onChange={(event) => setCodeInput(event.target.value)}
              placeholder={t.loyaltyReferralPlaceholder}
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={() => void handleApplyCode()}
              disabled={busy || !codeInput.trim()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t.loyaltyReferralApplyBtn}
            </button>
          </div>
          {codeMessage ? (
            <p
              className={`mt-2 text-xs ${codeOk ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}
            >
              {codeMessage}
            </p>
          ) : null}
        </div>
      </div>

      {promotions.length > 0 ? (
        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="flex items-center gap-2 font-bold">
            <Gift className="h-4 w-4" />
            {t.loyaltyOffers}
          </h3>
          <ul className="mt-3 space-y-2">
            {promotions.map((promo) => (
              <li
                key={promo.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{promo.title}</p>
                  {promo.message ? (
                    <p className="truncate text-xs text-muted-foreground">{promo.message}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => void handleDismiss(promo.id)}
                  className="shrink-0 text-xs font-semibold text-muted-foreground underline"
                >
                  {t.loyaltyDismiss}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {flashSales.length > 0 ? (
        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="flex items-center gap-2 font-bold">
            <Timer className="h-4 w-4" />
            {t.loyaltyFlashSales}
          </h3>
          <ul className="mt-3 space-y-2">
            {flashSales.map((sale) => (
              <li
                key={`${sale.flash_sale_id}-${sale.product_id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{sale.product_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.loyaltyFlashEnds} {formatDate(sale.ends_at, locale)}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-bold text-destructive">
                  −{Math.round(sale.discount_percent)}%
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {bundles.length > 0 ? (
        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="flex items-center gap-2 font-bold">
            <Gift className="h-4 w-4" />
            {t.loyaltyBundles}
          </h3>
          <ul className="mt-3 space-y-2">
            {bundles.map((bundle) => (
              <li
                key={bundle.bundle_id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{bundle.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.loyaltyBundleItems.replace("{n}", String(bundle.item_count))}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-bold text-emerald-600 dark:text-emerald-400">
                  {t.loyaltyBundleSave.replace("{n}", String(Math.round(bundle.savings_percent)))}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rounded-2xl border border-border bg-card p-5">
        <h3 className="font-bold">{t.loyaltyHistory}</h3>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t.loyaltyHistoryEmpty}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {history.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2 last:border-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">{t[REASON_LABEL[entry.reason]]}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(entry.created_at, locale)}</p>
                </div>
                <p
                  className={`shrink-0 text-sm font-bold tabular-nums ${
                    entry.delta > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
                  }`}
                >
                  {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
