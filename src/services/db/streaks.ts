import type { StreakState } from "../../types";
import { isDemoMode, isSupabaseConfigured, supabase } from "./index";

// ---------------------------------------------------------------------------
// DLX daily streak data layer (ROADMAP Phase 9)
//
// Two RPCs and nothing else. `record_streak_activity()` is idempotent per
// calendar day, so calling it on every authenticated page view is safe and cheap.
// `get_my_streak()` is the read-only counterpart, so simply opening the streak
// panel never counts as activity.
//
// Reminders are IN-APP ONLY. This project has no scheduler, so nothing here
// fires on a timer: `expires_today` is computed by the database when the
// customer reads their state, and the UI prompts them. There is no fake push.
//
// The "day" is Africa/Kinshasa, matching `src/lib/store-config.ts`
// (`launch.timezone`), not UTC.
//
// Added by 20261005090000_daily_streaks.sql.
// ---------------------------------------------------------------------------

/** Thrown when the streak migration has not been applied. */
export class StreakUnavailableError extends Error {
  constructor(message = "Streaks are not available yet.") {
    super(message);
    this.name = "StreakUnavailableError";
  }
}

const DEMO_KEY = "dlxstore_streak";

const MILESTONE_THRESHOLDS = [3, 7, 30, 100, 365];

/** Africa/Kinshasa is UTC+2 year-round, so local midnight is UTC-2. */
function kinshasaToday(): string {
  const now = new Date();
  const shifted = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function kinshasaYesterday(): string {
  const now = new Date();
  const shifted = new Date(now.getTime() - 2 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function rethrow(error: { code?: string; message?: string }): never {
  const code = error.code ?? "";
  const message = error.message ?? "";
  if (
    code === "PGRST202" ||
    code === "42883" ||
    code === "42P01" ||
    code === "42703" ||
    /could not find the function/i.test(message) ||
    /does not exist/i.test(message)
  ) {
    throw new StreakUnavailableError();
  }
  throw new Error(message || "Unable to load your streak.");
}

/**
 * Normalise the RPC payload defensively. The database owns the contract, but a
 * missing key must render as an honest zero rather than `undefined` reaching the
 * dashboard as `NaN`.
 */
function mapStreak(raw: unknown): StreakState {
  const r = (raw ?? {}) as Partial<StreakState> & {
    milestones_awarded?: unknown;
  };
  const count = Number(r.current_count ?? 0);
  const lastDate = r.last_activity_date ?? null;

  return {
    current_count: Number.isFinite(count) ? count : 0,
    streak_broken: r.streak_broken === true,
    longest_count: Number(r.longest_count ?? 0) || 0,
    total_active_days: Number(r.total_active_days ?? 0) || 0,
    last_activity_date: lastDate,
    activity_recorded_today: r.activity_recorded_today === true,
    expires_today: r.expires_today === true,
    advanced_today: r.advanced_today === true,
    milestones_awarded: Array.isArray(r.milestones_awarded)
      ? (r.milestones_awarded as unknown[]).map(Number).filter((n) => Number.isFinite(n))
      : [],
    next_milestone: r.next_milestone ?? null,
    badges: Array.isArray(r.badges) ? r.badges : [],
  };
}

function emptyStreak(): StreakState {
  return {
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
}

function readDemo(): StreakState {
  if (typeof window === "undefined") return emptyStreak();
  try {
    const raw = window.localStorage.getItem(DEMO_KEY);
    return raw ? mapStreak(JSON.parse(raw)) : emptyStreak();
  } catch {
    return emptyStreak();
  }
}

function writeDemo(state: StreakState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DEMO_KEY, JSON.stringify(state));
  } catch {
    // localStorage being unavailable must not break the panel.
  }
}

/**
 * Apply the same day-boundary rules locally so demo mode behaves identically to
 * the database rather than inventing its own semantics.
 */
function advanceDemo(state: StreakState): StreakState {
  const today = kinshasaToday();
  if (state.last_activity_date === today) {
    return { ...state, activity_recorded_today: true, expires_today: false };
  }

  const isConsecutive =
    state.last_activity_date !== null && state.last_activity_date === kinshasaYesterday();
  const current = isConsecutive ? state.current_count + 1 : 1;

  const earned: StreakState["badges"] = state.badges.slice();
  const awarded: number[] = [];
  for (const threshold of MILESTONE_THRESHOLDS) {
    if (current >= threshold && !earned.some((badge) => badge.threshold === threshold)) {
      earned.push({ threshold, earned_at: new Date().toISOString() });
      awarded.push(threshold);
    }
  }
  earned.sort((a, b) => a.threshold - b.threshold);

  const next = MILESTONE_THRESHOLDS.find((threshold) => current < threshold) ?? null;

  return {
    current_count: current,
    streak_broken: false,
    longest_count: Math.max(state.longest_count, current),
    total_active_days: state.total_active_days + 1,
    last_activity_date: today,
    activity_recorded_today: true,
    expires_today: false,
    advanced_today: true,
    milestones_awarded: awarded,
    next_milestone: next ? { threshold: next, days_remaining: Math.max(next - current, 1) } : null,
    badges: earned,
  };
}

/**
 * Read the streak without recording activity.
 *
 * Applies the same expiry projection as the database, so a lapsed streak reads as
 * zero with `streak_broken` set.
 */
export async function getMyStreak(): Promise<StreakState> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("get_my_streak");
    if (error) rethrow(error);
    return mapStreak(data);
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");

  const state = readDemo();
  const lapsed =
    state.current_count > 0 &&
    state.last_activity_date !== null &&
    state.last_activity_date < kinshasaYesterday();
  return {
    ...state,
    current_count: lapsed ? 0 : state.current_count,
    streak_broken: lapsed,
    expires_today:
      !lapsed &&
      state.current_count > 0 &&
      state.last_activity_date === kinshasaYesterday(),
  };
}

/**
 * Record today's activity and advance the streak if this is a new day.
 *
 * Safe to call repeatedly: the database is idempotent per calendar day.
 */
export async function recordStreakActivity(): Promise<StreakState> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("record_streak_activity");
    if (error) rethrow(error);
    return mapStreak(data);
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");

  const next = advanceDemo(readDemo());
  writeDemo(next);
  return next;
}