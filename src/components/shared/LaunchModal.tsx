"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Megaphone, X } from "lucide-react";
import { getLiveInAppCampaigns } from "../../services/db/campaigns";
import type { Campaign } from "../../types";
import { useLanguage } from "../../context/LanguageContext";
import { useOverlay } from "../../context/OverlayContext";
import { fill } from "../../lib/i18n";
import { formatMoney } from "../../lib/format";
import { Modal } from "./Modal";

/**
 * The launch modal — a one-time-per-visitor announcement on top of the P5
 * campaign layer.
 *
 * It reads through the same `getLiveInAppCampaigns()` as `CampaignBanner`, so the
 * two surfaces can never disagree about what "live" means, and it renders only
 * campaign data: an offer without a discount reads as an announcement, never as
 * an invented saving.
 *
 * "Seen" is remembered per campaign slug, so dismissing the launch cannot hide
 * next month's offer. The key is kept separate from the banner's, so hiding the
 * banner does not also dismiss the modal, and vice versa.
 */
const SEEN_KEY = "dlxstore:seen-launch-modals";

/**
 * Only these routes are the shop. `StorefrontShell` wraps the whole app, so
 * without an allow-list this modal would open over checkout, the admin console
 * and the dashboard too.
 */
const STOREFRONT_ROUTES = ["/", "/shop", "/product", "/discover", "/food", "/deals"];

function isStorefrontRoute(pathname: string): boolean {
  return STOREFRONT_ROUTES.some(
    (route) => pathname === route || (route !== "/" && pathname.startsWith(`${route}/`))
  );
}

function readSeen(): string[] {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function LaunchModal() {
  const pathname = usePathname();
  const { t, language, ready, hasSelectedLanguage } = useLanguage();
  const { activeOverlay } = useOverlay();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [closed, setClosed] = useState(false);
  const [copied, setCopied] = useState(false);

  // Read after mount rather than during render: the campaign and the seen list
  // are browser state, and reading them while server-rendering would emit markup
  // the browser then has to replace.
  useEffect(() => {
    if (!isStorefrontRoute(pathname)) return;

    let cancelled = false;
    getLiveInAppCampaigns()
      .then((rows) => {
        if (cancelled) return;
        const seen = readSeen();
        setCampaign(rows.find((row) => !seen.includes(row.slug)) ?? null);
      })
      // A campaign is an announcement, never a reason to break the page.
      .catch(() => {
        if (!cancelled) setCampaign(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  // Hold the modal until the first-visit language choice is done, and never let
  // it sit on top of another primary overlay (menu drawer, support chat, search):
  // those are portalled by Header, which is rendered before this component, so a
  // simultaneous modal would cover them.
  const open =
    campaign !== null &&
    isStorefrontRoute(pathname) &&
    ready &&
    hasSelectedLanguage &&
    activeOverlay === null &&
    !closed;

  const dismiss = useCallback(() => {
    setClosed(true);
    if (!campaign) return;
    const next = [...new Set([...readSeen(), campaign.slug])];
    try {
      window.localStorage.setItem(SEEN_KEY, JSON.stringify(next));
    } catch {
      // Storage can be full or blocked; the modal simply returns next visit.
    }
  }, [campaign]);

  if (!campaign) return null;

  // Nothing applies `discount_percent` at checkout: the coupon code is the only
  // field that turns this announcement into a real saving, so it is usable here.
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
    <Modal
      open={open}
      onClose={dismiss}
      size="md"
      labelledBy="launch-modal-title"
      panelClassName="p-6"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <Megaphone className="h-5 w-5 text-primary" aria-hidden />
          </span>
          <h2 id="launch-modal-title" className="text-lg font-bold text-foreground">
            {campaign.name}
          </h2>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t.socialClose}
          className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {parts.length > 0 && (
        <p className="mt-3 text-sm text-muted-foreground">{parts.join(" · ")}</p>
      )}

      {campaign.ends_at && (
        <p className="mt-1 text-xs text-muted-foreground">
          {fill(t.campaignBannerEnds, {
            date: new Date(campaign.ends_at).toLocaleDateString(language),
          })}
        </p>
      )}

      {code && (
        <button
          type="button"
          onClick={() => void copyCode()}
          aria-label={t.rewardsCouponCopy}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-primary/40 bg-background px-3 py-2 font-mono text-sm font-bold tracking-wide text-foreground"
        >
          {code}
          {copied ? (
            <Check className="h-4 w-4 text-emerald-600" aria-hidden />
          ) : (
            <Copy className="h-4 w-4 text-muted-foreground" aria-hidden />
          )}
        </button>
      )}

      <Link
        href="/shop"
        onClick={dismiss}
        className="mt-5 flex w-full items-center justify-center rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90"
      >
        {t.campaignBannerCta}
      </Link>
    </Modal>
  );
}
