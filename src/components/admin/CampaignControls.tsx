"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { CalendarClock, Loader2, Megaphone, Pencil, Plus, Save } from "lucide-react";

import { useLanguage } from "../../context/LanguageContext";
import {
  CAMPAIGN_CHANNELS as CHANNELS,
  CAMPAIGN_SEGMENTS as SEGMENTS,
  getCampaigns,
  isCampaignLive,
  saveCampaign,
  updateCampaign,
  type CampaignInput,
} from "../../services/db/campaigns";
import type { Campaign } from "../../types";
import { formatMoney } from "../../lib/format";

// ---------------------------------------------------------------------------
// P5 — admin campaign controls.
//
// The `campaigns` table existed since P11 and P13 could *send* a campaign from
// it, but nothing in the product could create or edit one — so the storefront
// banner P5 adds had no source and both tables were empty in production. Writes
// go to the table directly: "Admins manage campaigns" is an `is_admin()` FOR ALL
// policy, so the database remains the authorisation boundary.
//
// The values offered here are exactly the values the database CHECK lists accept.
// ---------------------------------------------------------------------------

const emptyDraft = (): CampaignInput => ({
  name: "",
  slug: "",
  description: "",
  channel: "in_app",
  segment: "all",
  discount_percent: null,
  min_order: 0,
  coupon_code: "",
  starts_at: new Date().toISOString().slice(0, 16),
  ends_at: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 16),
  is_active: true,
});

function toInput(campaign: Campaign): CampaignInput {
  const local = (value: string | null) => (value ? value.slice(0, 16) : "");
  return {
    name: campaign.name,
    slug: campaign.slug,
    description: campaign.description ?? "",
    channel: campaign.channel,
    segment: campaign.segment,
    discount_percent: campaign.discount_percent,
    min_order: campaign.min_order,
    coupon_code: campaign.coupon_code ?? "",
    starts_at: local(campaign.starts_at),
    ends_at: local(campaign.ends_at),
    is_active: campaign.is_active,
  };
}

/** `<input type="datetime-local">` gives a wall-clock string; Postgres wants a instant. */
const toInstant = (value: string) => new Date(value).toISOString();

export function CampaignControls() {
  const { t, language } = useLanguage();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [draft, setDraft] = useState<CampaignInput>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCampaigns(await getCampaigns());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load campaigns.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const startNew = () => {
    setEditingId(null);
    setDraft(emptyDraft());
    setNotice(null);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    const payload: CampaignInput = {
      ...draft,
      description: draft.description?.toString() ?? null,
      starts_at: toInstant(draft.starts_at),
      ends_at: toInstant(draft.ends_at),
    };
    try {
      if (editingId) {
        await updateCampaign(editingId, payload);
      } else {
        await saveCampaign(payload);
      }
      setNotice(t.campaignSaved);
      startNew();
      await load();
    } catch (err) {
      // The service already turns constraint failures into one plain sentence.
      setError(err instanceof Error ? err.message : "The campaign could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (value: string | null) =>
    value ? new Date(value).toLocaleString(language, { dateStyle: "medium", timeStyle: "short" }) : "—";

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">
            {t.messagingCampaignsTitle}
          </h3>
        </div>
        <button
          type="button"
          onClick={startNew}
          className="flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
          {t.campaignNew}
        </button>
      </div>

      <p className="text-xs text-muted-foreground">{t.campaignInAppHint}</p>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700 dark:bg-green-950 dark:text-green-300">{notice}</p>}

      <form
        onSubmit={handleSubmit}
        className="grid gap-3 rounded-xl border border-border bg-muted/20 p-4 md:grid-cols-3"
      >
        <label className="text-sm font-medium">
          {t.campaignNameLabel}
          <input
            required
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="mt-1 block w-full rounded-lg border border-border bg-background p-2"
          />
        </label>
        <label className="text-sm font-medium">
          {t.campaignSlugLabel}
          <input
            required
            value={draft.slug}
            onChange={(e) => setDraft({ ...draft, slug: e.target.value.toLowerCase() })}
            placeholder="we-are-now-open"
            className="mt-1 block w-full rounded-lg border border-border bg-background p-2 font-mono"
          />
        </label>
        <label className="text-sm font-medium">
          {t.messagingAudience}
          <select
            value={draft.segment}
            onChange={(e) => setDraft({ ...draft, segment: e.target.value })}
            className="mt-1 block w-full rounded-lg border border-border bg-background p-2"
          >
            {SEGMENTS.map((segment) => (
              <option key={segment} value={segment}>
                {segment}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm font-medium md:col-span-3">
          {t.campaignMessageLabel}
          <textarea
            value={draft.description ?? ""}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            rows={2}
            className="mt-1 block w-full rounded-lg border border-border bg-background p-2"
          />
        </label>

        <label className="text-sm font-medium">
          {t.campaignChannelLabel}
          <select
            value={draft.channel}
            onChange={(e) => setDraft({ ...draft, channel: e.target.value })}
            className="mt-1 block w-full rounded-lg border border-border bg-background p-2"
          >
            {CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {channel === "in_app"
                  ? t.messagingChannelInApp
                  : channel === "whatsapp"
                    ? t.messagingChannelWhatsapp
                    : channel === "email"
                      ? t.messagingChannelEmail
                      : channel}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium">
          {t.campaignDiscountLabel}
          <input
            type="number"
            min={1}
            max={90}
            step="1"
            value={draft.discount_percent ?? ""}
            onChange={(e) =>
              setDraft({ ...draft, discount_percent: e.target.value === "" ? null : Number(e.target.value) })
            }
            className="mt-1 block w-full rounded-lg border border-border bg-background p-2"
          />
        </label>
        <label className="text-sm font-medium">
          {t.campaignMinOrderLabel}
          <input
            type="number"
            min={0}
            step="0.01"
            value={draft.min_order}
            onChange={(e) => setDraft({ ...draft, min_order: Number(e.target.value) })}
            className="mt-1 block w-full rounded-lg border border-border bg-background p-2"
          />
        </label>

        <label className="text-sm font-medium">
          {t.campaignCouponLabel}
          <input
            value={draft.coupon_code ?? ""}
            onChange={(e) => setDraft({ ...draft, coupon_code: e.target.value.toUpperCase() })}
            className="mt-1 block w-full rounded-lg border border-border bg-background p-2 font-mono uppercase"
          />
        </label>
        <label className="text-sm font-medium">
          {t.campaignStartsLabel}
          <input
            required
            type="datetime-local"
            value={draft.starts_at}
            onChange={(e) => setDraft({ ...draft, starts_at: e.target.value })}
            className="mt-1 block w-full rounded-lg border border-border bg-background p-2"
          />
        </label>
        <label className="text-sm font-medium">
          {t.campaignEndsLabel}
          <input
            required
            type="datetime-local"
            value={draft.ends_at}
            onChange={(e) => setDraft({ ...draft, ends_at: e.target.value })}
            className="mt-1 block w-full rounded-lg border border-border bg-background p-2"
          />
        </label>

        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={draft.is_active}
            onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}
            className="h-4 w-4 rounded border-border"
          />
          {t.campaignActiveLabel}
        </label>

        <div className="flex items-end gap-2 md:col-span-3">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-xs font-bold text-primary-foreground disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {editingId ? t.campaignEdit : t.campaignSave}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={startNew}
              className="rounded-full border border-border px-4 py-2 text-xs font-semibold text-muted-foreground"
            >
              {t.campaignNew}
            </button>
          )}
        </div>
      </form>

      {loading ? (
        <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t.campaignLoading}
        </p>
      ) : campaigns.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t.messagingCampaignEmpty}</p>
      ) : (
        <ul className="space-y-2">
          {campaigns.map((campaign) => {
            const live = isCampaignLive(campaign);
            return (
              <li
                key={campaign.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-foreground">
                    {campaign.name}
                    <span className="ml-2 font-mono text-[10px] text-muted-foreground">{campaign.slug}</span>
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {campaign.channel} · {campaign.segment}
                    {campaign.discount_percent !== null && ` · ${campaign.discount_percent}%`}
                    {campaign.min_order > 0 && ` · ${formatMoney(campaign.min_order)}`}
                    {campaign.coupon_code && ` · ${campaign.coupon_code}`}
                  </p>
                  <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <CalendarClock className="h-3 w-3" />
                    {formatDate(campaign.starts_at)} → {formatDate(campaign.ends_at)}
                  </p>
                  <p className={`text-[11px] font-semibold ${live ? "text-green-700 dark:text-green-400" : "text-muted-foreground"}`}>
                    {live ? t.messagingCampaignLive : t.messagingCampaignInactive}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(campaign.id);
                    setDraft(toInput(campaign));
                    setError(null);
                    setNotice(null);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  className="flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  {t.campaignEdit}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
