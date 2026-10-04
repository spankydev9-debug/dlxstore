"use client";

import { AlertCircle, Flame, Loader2, LockKeyhole, RotateCw, Trophy } from "lucide-react";
import { useStreakContext } from "../../context/StreakContext";
import { useLanguage } from "../../context/LanguageContext";
import type { StreakBadgeKey, StreakState } from "../../types";

/**
 * Badge descriptors. `key` drives the earned/locked styling and `threshold` is
 * what the database stores in the milestone ledger.
 */
type StreakBadgeLabelKey =
  | "streakBadgeNewStreak"
  | "streakBadgeSevenDays"
  | "streakBadgeThirtyDays"
  | "streakBadgeHundredDays"
  | "streakBadgeYear";

const BADGES: readonly {
  key: StreakBadgeKey;
  threshold: number;
  label: StreakBadgeLabelKey;
}[] = [
  { key: "new_streak", threshold: 1, label: "streakBadgeNewStreak" },
  { key: "seven_days", threshold: 7, label: "streakBadgeSevenDays" },
  { key: "thirty_days", threshold: 30, label: "streakBadgeThirtyDays" },
  { key: "hundred_days", threshold: 100, label: "streakBadgeHundredDays" },
  { key: "three_sixty_five_days", threshold: 365, label: "streakBadgeYear" },
];

/**
 * Daily streak panel (ROADMAP Phase 9).
 *
 * Reads from `StreakContext`, which is the app's single writer, so this panel
 * never records activity by itself. Opening the panel must not advance the
 * streak — only genuine use of the site should.
 *
 * Fully responsive with no breakpoint gating: the same controls are available on
 * desktop and mobile.
 */
export function StreakPanel() {
  const { t } = useLanguage();
  const { streak, loadState, isRecording, record, refresh } = useStreakContext();

  if (loadState === "loading") {
    return (
      <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t.streakLoading}
      </p>
    );
  }

  if (loadState === "unavailable") {
    return (
      <div className="space-y-3 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-5">
        <p className="flex items-center gap-2 font-bold text-amber-700 dark:text-amber-400">
          <LockKeyhole className="h-4 w-4" />
          {t.streakUnavailableTitle}
        </p>
        <p className="text-sm text-amber-700/90 dark:text-amber-400/90">
          {t.streakUnavailableBody}
        </p>
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
        <AlertCircle className="h-3.5 w-3.5" />
        {t.streakError}
      </p>
    );
  }

  const state: StreakState = streak ?? {
    current_count: 0,
    streak_broken: false,
    longest_count: 0,
    total_active_days: 0,
    last_activity_date: null,
    activity_recorded_today: false,
    expires_today: false,
    advanced_today: false,
    milestones_awarded: [],
    next_milestone: null,
    badges: [],
  };

  const earnedThresholds = new Set(state.badges.map((badge) => badge.threshold));
  const hasStarted = state.total_active_days > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-bold text-foreground">
            <Flame className="h-5 w-5 text-orange-500" />
            {t.streakTitle}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">{t.streakIntro}</p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border px-3 text-xs font-bold transition-colors hover:bg-muted"
        >
          <RotateCw className="h-3.5 w-3.5" />
          {t.streakRefresh}
        </button>
      </div>

      <p className="rounded-xl bg-muted/50 p-3 text-[11px] leading-relaxed text-muted-foreground">
        {t.streakHowItWorks}
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t.streakCurrent} value={state.current_count} accent />
        <Stat label={t.streakLongest} value={state.longest_count} />
        <Stat label={t.streakTotalDays} value={state.total_active_days} />
        <Stat
          label={t.streakLastActive}
          value={state.last_activity_date ? formatDay(state.last_activity_date) : "—"}
          small
        />
      </div>

      {state.activity_recorded_today ? (
        <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-3 text-xs font-bold text-emerald-700 dark:text-emerald-400">
          {t.streakDoneToday}
        </p>
      ) : state.expires_today ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-orange-500/40 bg-orange-500/5 p-3">
          <p className="text-xs font-bold text-orange-700 dark:text-orange-400">
            {t.streakExpiresToday}
          </p>
          <button
            type="button"
            onClick={() => void record()}
            disabled={isRecording}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-orange-600 px-4 text-xs font-bold text-white disabled:opacity-50"
          >
            {isRecording ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Flame className="h-3.5 w-3.5" />
            )}
            {t.streakKeepIt}
          </button>
        </div>
      ) : state.streak_broken ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">{t.streakBroken}</p>
          <button
            type="button"
            onClick={() => void record()}
            disabled={isRecording}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-bold text-primary-foreground disabled:opacity-50"
          >
            {isRecording ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Flame className="h-3.5 w-3.5" />
            )}
            {t.streakStartAgain}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void record()}
          disabled={isRecording}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-50 sm:w-auto"
        >
          {isRecording ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Flame className="h-4 w-4" />
          )}
          {t.streakStart}
        </button>
      )}

      {state.next_milestone ? (
        <div className="rounded-xl border border-border p-3">
          <p className="text-xs font-bold text-foreground">
            {t.streakNextMilestone.replace("{n}", String(state.next_milestone.threshold))}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {t.streakDaysRemaining.replace(
              "{n}",
              String(state.next_milestone.days_remaining)
            )}
          </p>
          <div
            className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={state.current_count}
            aria-valuemin={0}
            aria-valuemax={state.next_milestone.threshold}
          >
            <div
              className="h-full rounded-full bg-orange-500 transition-all"
              style={{
                width: `${Math.min(
                  100,
                  Math.round(
                    (state.current_count / state.next_milestone.threshold) * 100
                  )
                )}%`,
              }}
            />
          </div>
        </div>
      ) : null}

      <section className="space-y-2">
        <h4 className="flex items-center gap-2 text-sm font-bold text-foreground">
          <Trophy className="h-4 w-4 text-primary" />
          {t.streakBadges}
        </h4>
        <ul className="grid gap-2 sm:grid-cols-2">
          {BADGES.map(({ key, threshold, label }) => {
            const earned =
              key === "new_streak" ? hasStarted : earnedThresholds.has(threshold);
            return (
              <li
                key={key}
                className={`flex items-center gap-2.5 rounded-xl border p-3 ${
                  earned
                    ? "border-orange-500/40 bg-orange-500/5"
                    : "border-dashed border-border opacity-60"
                }`}
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-extrabold ${
                    earned ? "bg-orange-500 text-white" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {threshold}
                </span>
                <span className="text-xs font-bold text-foreground">{t[label]}</span>
              </li>
            );
          })}
        </ul>
        <p className="text-[11px] text-muted-foreground">{t.streakMilestonesNote}</p>
      </section>
    </div>
  );
}

function formatDay(value: string): string {
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

function Stat({
  label,
  value,
  accent,
  small,
}: {
  label: string;
  value: number | string;
  accent?: boolean;
  small?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1 font-extrabold text-foreground ${small ? "text-sm" : "text-2xl"} ${
          accent ? "text-orange-500" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}
