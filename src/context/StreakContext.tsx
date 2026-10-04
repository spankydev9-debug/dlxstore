"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthContext";
import {
  getMyStreak,
  recordStreakActivity,
  StreakUnavailableError,
} from "../services/db/streaks";
import type { StreakState } from "../types";

type StreakContextType = {
  streak: StreakState | null;
  loadState: "loading" | "ready" | "unavailable" | "error";
  isRecording: boolean;
  /** Record today's activity. Idempotent per Kinshasa calendar day. */
  record: () => Promise<void>;
  refresh: () => Promise<void>;
};

const StreakContext = createContext<StreakContextType | undefined>(undefined);

const RECORDED_KEY = "dlxstore_streak_recorded_on";

/** Africa/Kinshasa is UTC+2 year-round, so local midnight is UTC-2. */
function kinshasaToday(): string {
  return new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Skip the round trip when this browser already recorded today. This is only an
 * optimisation: the database is idempotent per day, so a stale or cleared
 * localStorage entry costs one extra call and nothing else.
 */
function alreadyRecordedToday(): boolean {
  try {
    return window.localStorage.getItem(RECORDED_KEY) === kinshasaToday();
  } catch {
    return false;
  }
}

function markRecordedToday(): void {
  try {
    window.localStorage.setItem(RECORDED_KEY, kinshasaToday());
  } catch {
    // Non-fatal; the database still dedupes.
  }
}

/**
 * Single source of truth for the daily streak.
 *
 * There is deliberately exactly ONE writer in the app: this provider. The header
 * counter and the dashboard panel both read from here, so they can never disagree
 * about today's count.
 *
 * Activity is recorded on mount and whenever the tab becomes visible again,
 * which is what "any daily activity" means in practice — opening DLXSTORE is
 * the activity. Reminders are in-app only: this project has no scheduler, so the
 * "expires tonight" prompt is derived from `expires_today` on read rather than
 * pushed on a timer.
 */
export function StreakProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [streak, setStreak] = useState<StreakState | null>(null);
  const [loadState, setLoadState] = useState<StreakContextType["loadState"]>("loading");
  const [isRecording, setIsRecording] = useState(false);
  const inFlight = useRef(false);
  const userId = user?.id ?? null;

  const fail = useCallback((cause: unknown) => {
    if (cause instanceof StreakUnavailableError) {
      setLoadState("unavailable");
      return;
    }
    setLoadState("error");
  }, []);

  const refresh = useCallback(async () => {
    if (!userId) {
      setStreak(null);
      setLoadState("ready");
      return;
    }
    try {
      setStreak(await getMyStreak());
      setLoadState("ready");
    } catch (cause) {
      fail(cause);
    }
  }, [fail, userId]);

  const record = useCallback(async () => {
    if (!userId || inFlight.current) return;
    inFlight.current = true;
    // Yield one microtask so no state update happens synchronously inside a
    // caller's effect; React treats that as a cascading render.
    await Promise.resolve();
    setIsRecording(true);
    try {
      setStreak(await recordStreakActivity());
      setLoadState("ready");
      markRecordedToday();
    } catch (cause) {
      fail(cause);
    } finally {
      inFlight.current = false;
      setIsRecording(false);
    }
  }, [fail, userId]);

  // Sign-in and the initial authenticated load. Sign-out is handled by
  // derivation below rather than by resetting state inside the effect.
  useEffect(() => {
    if (!userId) return;
    if (alreadyRecordedToday()) {
      // Read-only: today's activity is already banked, so do not re-record.
      void refresh();
      return;
    }
    void record();
  }, [record, refresh, userId]);

  // A long-lived PWA can sit open across a day boundary without remounting.
  useEffect(() => {
    if (!userId) return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (alreadyRecordedToday()) return;
      void record();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [record, userId]);

  // Derive the signed-out view so signing out never needs a render-triggering
  // reset, and so a stale streak can never leak across an account switch.
  const value: StreakContextType = {
    streak: userId ? streak : null,
    loadState: userId ? loadState : "ready",
    isRecording,
    record,
    refresh,
  };

  return <StreakContext.Provider value={value}>{children}</StreakContext.Provider>;
}

export function useStreakContext(): StreakContextType {
  const context = useContext(StreakContext);
  if (!context) {
    throw new Error("useStreakContext must be used within a StreakProvider.");
  }
  return context;
}