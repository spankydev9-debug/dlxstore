"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Check, Copy, Megaphone, X } from "lucide-react";
import { getLiveInAppCampaigns } from "../../services/db/campaigns";
import type { Campaign } from "../../types";
import { useLanguage } from "../../context/LanguageContext";
import { fill } from "../../lib/i18n";
import { formatMoney } from "../../lib/format";

/**
 * Dismissal is remembered per campaign slug, so hiding today's launch banner
 * cannot hide next month's offer. The key is namespaced because localStorage is
 * shared with the cart and the language prompt.
 */
const DISMISS_KEY = "dlxstore:dismissed-campaigns";

/**
 * Only these routes are the shop. `StorefrontShell` wraps the whole app, so
 * without an allow-list this banner would sit on top of checkout, the admin
 * console and the dashboard too.
 */
const STOREFRONT_ROUTES = ["/", "/shop", "/product", "/discover", "/food", "/deals"];

function isStorefrontRoute(pathname: string): boolean {
  return STOREFRONT_ROUTES.some(
    (route) => pathname === route || (route !== "/" && pathname.startsWith(`${route}/`))
  );
}

function readDismissed(): string[] {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function CampaignBanner() {
  const pathname = usePathname();
  const { t, language } = useLanguage();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [copied, setCopied] = useState(false);

  // Read after mount rather than during render: the campaign and the dismissal
  // list are browser state, and reading them while server-rendering would emit
  // markup the browser then has to replace.
  useEffect(() => {
    if (!isStorefrontRoute(pathname)) return;

    let cancelled = false;
    getLiveInAppCampaigns()
      .then((rows) => {
        if (cancelled) return;
        const hidden = readDismissed();
        setCampaign(rows.find((row) => !hidden.includes(row.slug)) ?? null);
      })
      // A campaign is decoration, never a reason to break the page it advertises.
      .catch(() => {
        if (!cancelled) setCampaign(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  if (!campaign || !isStorefrontRoute(pathname)) return null;

  const hide = () => {
    const next = [...new Set([...readDismissed(), campaign.slug])];
    setCampaign(null);
    try {
      window.localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
    } catch {
      // Storage can be full or blocked; the banner simply returns next visit.
    }
  };

  // Nothing applies `discount_percent` at checkout: the coupon code is the only
  // field that turns this banner into a real saving, so it has to be usable here.
  const code = campaign.coupon_code?.trim();

  const copyCode = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // A blocked clipboard is not a dead end: the chip still shows the code.
    }
  };

  // Every number shown here comes from the campaign row. An offer without a
  // discount renders as an announcement, never as an invented saving.
  const parts: string[] = [];
  if (campaign.discount_percent !== null) {
    parts.push(fill(t.campaignBannerOff, { percent: campaign.discount_percent }));
  }
  if (campaign.description?.trim()) parts.push(campaign.description.trim());
  if (campaign.min_order > 0) {
    parts.push(fill(t.campaignBannerMinOrder, { amount: formatMoney(campaign.min_order) }));
  }

  return (
    <div className="w-full border-b border-primary/30 bg-primary/5">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-3 px-4 py-2 sm:px-6 lg:px-8">
        <Megaphone className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        <p className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground sm:text-sm">
          <span className="font-bold text-primary">{campaign.name}</span>
          {parts.length > 0 && <span className="text-muted-foreground"> — {parts.join(" · ")}</span>}
          {campaign.ends_at && (
            <span className="ml-2 hidden text-muted-foreground sm:inline">
              {fill(t.campaignBannerEnds, {
                date: new Date(campaign.ends_at).toLocaleDateString(language),
              })}
            </span>
          )}
        </p>
        {code && (
          <button
            type="button"
            onClick={() => void copyCode()}
            aria-label={t.rewardsCouponCopy}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-primary/40 bg-background px-2 py-1 font-mono text-xs font-bold tracking-wide text-foreground"
          >
            {code}
            {copied ? (
              <Check className="hidden h-3.5 w-3.5 text-emerald-600 sm:block" aria-hidden />
            ) : (
              <Copy className="hidden h-3.5 w-3.5 text-muted-foreground sm:block" aria-hidden />
            )}
          </button>
        )}
        <Link
          href="/shop"
          className="shrink-0 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground transition-opacity hover:opacity-90"
        >
          {t.campaignBannerCta}
        </Link>
        <button
          type="button"
          onClick={hide}
          aria-label={t.campaignBannerDismiss}
          className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
