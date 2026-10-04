"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Inbox,
  Loader2,
  Megaphone,
  RefreshCw,
  Send,
  ShieldAlert,
  XCircle,
} from "lucide-react";

import { useLanguage } from "../../context/LanguageContext";
import { fill } from "../../lib/i18n";
import {
  dispatchOnce,
  enqueueTestMessage,
  getCampaigns,
  getMarketingAudience,
  getMessageStats,
  getOutbox,
  isCampaignLive,
  previewCampaign,
  sendCampaign,
  type MessagingCampaign,
} from "../../services/db/messaging";
import type { MessageStats, OutboxFilters, OutboxRow, OutboxStatus } from "../../types";
import { StatCard } from "./StatCard";

// ---------------------------------------------------------------------------
// P13 — admin Message Center.
//
// Reads the outbox through the P13 admin RPCs, which re-check `public.is_admin()`
// in SQL, and runs delivery through `/api/messaging/dispatch` so provider
// credentials never reach the browser.
//
// The honesty rule that matters here: a row shows what the provider actually
// said. `pending` is not "sent", `skipped` carries the reason it was skipped, and
// a message with no destination or no consent is counted and displayed rather
// than quietly dropped. Delivery rate stays blank until a message actually
// finishes, because a percentage of zero finished messages has no meaning.
// ---------------------------------------------------------------------------

const E164 = /^\+[1-9]\d{7,14}$/;
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
type ExternalTestChannel = "in_app" | "whatsapp" | "email";

const STATUS_STYLES: Record<OutboxStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  sending: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  sent: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  skipped: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
};

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">{title}</h3>
      </div>
      {children}
    </div>
  );
}

export function MessageCenter() {
  const { t } = useLanguage();

  const [stats, setStats] = useState<MessageStats | null>(null);
  const [rows, setRows] = useState<OutboxRow[]>([]);
  const [campaigns, setCampaigns] = useState<MessagingCampaign[]>([]);
  const [statusFilter, setStatusFilter] = useState<OutboxStatus | "">("");
  const [channelFilter, setChannelFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [preview, setPreview] = useState<Record<string, { matched: number; optedIn: number }>>({});
  const [testAddress, setTestAddress] = useState("");
  const [testChannel, setTestChannel] = useState<ExternalTestChannel>("whatsapp");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filters: OutboxFilters = {
        status: statusFilter === "" ? null : statusFilter,
        channel: channelFilter === "" ? null : (channelFilter as OutboxFilters["channel"]),
        limit: 50,
      };
      const [nextStats, nextRows, nextCampaigns] = await Promise.all([
        getMessageStats(),
        getOutbox(filters),
        getCampaigns(),
      ]);
      setStats(nextStats);
      setRows(nextRows);
      setCampaigns(nextCampaigns);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.messagingLoadError);
    } finally {
      setLoading(false);
    }
  }, [channelFilter, statusFilter, t.messagingLoadError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runDispatcher() {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const summary = await dispatchOnce();
      setNotice(
        fill(t.messagingDispatchResult, {
          delivered: summary.delivered ?? 0,
          requeued: summary.requeued ?? 0,
          abandoned: summary.abandoned ?? 0,
        })
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.messagingLoadError);
    } finally {
      setBusy(false);
    }
  }

  async function runPreview(campaign: MessagingCampaign) {
    setBusy(true);
    setError(null);
    try {
      const [result, audience] = await Promise.all([
        previewCampaign(campaign.id),
        getMarketingAudience(campaign.segment, campaign.channel === "email" ? "email" : "whatsapp"),
      ]);
      setPreview((prev) => ({
        ...prev,
        [campaign.id]: { matched: result.matched, optedIn: audience.opted_in },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t.messagingLoadError);
    } finally {
      setBusy(false);
    }
  }

  async function runSend(campaign: MessagingCampaign) {
    const info = preview[campaign.id];
    const reachable = info?.optedIn ?? 0;
    if (!window.confirm(fill(t.messagingSendConfirm, { count: reachable }))) return;

    setBusy(true);
    setError(null);
    try {
      const result = await sendCampaign(campaign.id);
      setNotice(
        fill(t.messagingSendResult, { queued: result.queued, skipped: result.skipped })
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.messagingLoadError);
    } finally {
      setBusy(false);
    }
  }

  async function runTestSend() {
    const address = testAddress.trim();
    // Mirrors /api/messaging/test. The route validates too; checking here just
    // avoids a pointless round trip and reports which field is wrong.
    if (testChannel !== "in_app") {
      if (address === "") {
        setError(t.messagingTestMissingAddress);
        return;
      }
      const valid =
        testChannel === "whatsapp" ? E164.test(address) : EMAIL.test(address);
      if (!valid) {
        setError(
          testChannel === "whatsapp"
            ? t.messagingTestInvalidPhone
            : t.messagingTestInvalidEmail
        );
        return;
      }
    }

    setBusy(true);
    setError(null);
    try {
      await enqueueTestMessage(testChannel, testChannel === "in_app" ? null : address);
      setNotice(
        testChannel === "in_app" ? t.messagingTestQueuedInApp : t.messagingTestQueued
      );
      setTestAddress("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.messagingLoadError);
    } finally {
      setBusy(false);
    }
  }

  const statusOptions: (OutboxStatus | "")[] = [
    "",
    "pending",
    "sending",
    "sent",
    "failed",
    "skipped",
  ];
  const channelOptions = ["", "in_app", "whatsapp", "email"];

  const channelLabel = (channel: string) =>
    channel === "in_app"
      ? t.messagingChannelInApp
      : channel === "whatsapp"
        ? t.messagingChannelWhatsapp
        : t.messagingChannelEmail;

  const statusLabel = (status: OutboxStatus) =>
    status === "pending"
      ? t.messagingStatusPending
      : status === "sending"
        ? t.messagingStatusSending
        : status === "sent"
          ? t.messagingStatusSent
          : status === "failed"
            ? t.messagingStatusFailed
            : t.messagingStatusSkipped;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-foreground">{t.messagingTitle}</h3>
          <p className="text-sm text-muted-foreground">{t.messagingSubtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void load()}
            disabled={loading || busy}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            {loading ? t.messagingRefreshing : t.messagingRefresh}
          </button>
          <button
            onClick={() => void runDispatcher()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            {busy ? t.messagingDispatching : t.messagingDispatch}
          </button>
        </div>
      </div>

      {error && (
        <p className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}
      {notice && (
        <p className="flex items-start gap-2 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          {notice}
        </p>
      )}

      {stats && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
          <StatCard label={t.messagingStatsTotal} value={stats.total} icon={Inbox} />
          <StatCard
            label={t.messagingStatsDelivered}
            value={stats.sent}
            icon={CheckCircle2}
          />
          <StatCard
            label={t.messagingStatsQueued}
            value={stats.by_status.pending ?? 0}
            icon={Loader2}
          />
          <StatCard
            label={t.messagingStatsFailed}
            value={stats.by_status.failed ?? 0}
            icon={XCircle}
          />
          <StatCard
            label={t.messagingStatsSkipped}
            value={stats.skipped_no_consent}
            icon={Ban}
            hint={t.messagingStatsSkippedHint}
          />
          <StatCard
            label={t.messagingDeliveryRate}
            value={
              stats.delivery_rate === null
                ? "—"
                : `${stats.delivery_rate}%`
            }
            icon={ShieldAlert}
            hint={
              stats.delivery_rate === null
                ? t.messagingNoDeliveryRate
                : fill(t.messagingPreviewResult, {
                    matched: stats.finished,
                    optedIn: stats.sent,
                  })
            }
          />
        </div>
      )}

      <Section title={t.messagingInboxTitle} icon={Inbox}>
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            {t.messagingFilterStatus}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as OutboxStatus | "")}
              className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs font-semibold text-foreground"
            >
              {statusOptions.map((option) => (
                <option key={option || "all"} value={option}>
                  {option === "" ? t.messagingAll : statusLabel(option)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            {t.messagingFilterChannel}
            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs font-semibold text-foreground"
            >
              {channelOptions.map((option) => (
                <option key={option || "all"} value={option}>
                  {option === "" ? t.messagingAll : channelLabel(option)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t.messagingEmpty}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-2 pr-3 font-semibold">{t.messagingStatusTitle}</th>
                  <th className="py-2 pr-3 font-semibold">{t.messagingChannelInApp}</th>
                  <th className="py-2 pr-3 font-semibold">{t.messagingTemplate}</th>
                  <th className="py-2 pr-3 font-semibold">{t.messagingRecipient}</th>
                  <th className="py-2 pr-3 font-semibold">{t.messagingAttempts}</th>
                  <th className="py-2 font-semibold">{t.messagingBodyTitle}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-border/40 align-top">
                    <td className="py-2 pr-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLES[row.status]}`}
                      >
                        {statusLabel(row.status)}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {channelLabel(row.channel)}
                    </td>
                    <td className="py-2 pr-3">
                      <p className="font-semibold text-foreground">{row.template_key}</p>
                      <p className="text-[10px] text-muted-foreground">{row.locale}</p>
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      <p className="break-all">{row.recipient_address ?? "—"}</p>
                      {row.skip_reason && (
                        <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                          {row.skip_reason}
                        </p>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {row.attempts}/{row.max_attempts}
                      {row.last_error && (
                        <p className="max-w-[220px] break-words text-[10px] text-red-700 dark:text-red-400">
                          {row.last_error}
                        </p>
                      )}
                    </td>
                    <td className="py-2 text-muted-foreground">
                      <p className="max-w-[320px] break-words">{row.body}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title={t.messagingCampaignsTitle} icon={Megaphone}>
        {campaigns.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {t.messagingCampaignEmpty}
          </p>
        ) : (
          <div className="space-y-3">
            {campaigns.map((campaign) => {
              const live = isCampaignLive(campaign);
              const info = preview[campaign.id];
              return (
                <div
                  key={campaign.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 p-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-foreground">{campaign.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {channelLabel(campaign.channel)} · {t.messagingAudience}:{" "}
                      {campaign.segment}
                      {campaign.discount_percent !== null && ` · ${campaign.discount_percent}%`}
                    </p>
                    <p className="text-[11px] font-semibold text-muted-foreground">
                      {live ? t.messagingCampaignLive : t.messagingCampaignInactive}
                    </p>
                    {info && (
                      <p className="text-[11px] text-muted-foreground">
                        {fill(t.messagingPreviewResult, {
                          matched: info.matched,
                          optedIn: info.optedIn,
                        })}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => void runPreview(campaign)}
                      disabled={busy}
                      className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted disabled:opacity-50"
                    >
                      {t.messagingPreview}
                    </button>
                    <button
                      onClick={() => void runSend(campaign)}
                      disabled={busy || !info || info.optedIn === 0}
                      className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                    >
                      {t.messagingSendNow}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section title={t.messagingTestTitle} icon={Send}>
        <p className="flex items-start gap-2 text-[11px] text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {t.messagingTestHint}
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
            {t.messagingTestChannel}
            <select
              value={testChannel}
              onChange={(e) => setTestChannel(e.target.value as ExternalTestChannel)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold text-foreground"
            >
              <option value="in_app">{t.messagingChannelInApp}</option>
              <option value="whatsapp">{t.messagingChannelWhatsapp}</option>
              <option value="email">{t.messagingChannelEmail}</option>
            </select>
          </label>
          {testChannel !== "in_app" && (
            <input
              value={testAddress}
              onChange={(e) => setTestAddress(e.target.value)}
              placeholder={
                testChannel === "whatsapp"
                  ? t.messagingTestAddressPlaceholder
                  : t.messagingTestEmailPlaceholder
              }
              className="min-w-[220px] flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          )}
          <button
            onClick={() => void runTestSend()}
            disabled={busy}
            className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            {t.messagingTestSend}
          </button>
        </div>
      </Section>
    </div>
  );
}
