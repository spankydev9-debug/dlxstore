"use client";

import { useSyncExternalStore, type ReactNode } from "react";

/**
 * SSR-safe timestamp rendering for chat.
 *
 * Why this module exists
 * ----------------------
 * The previous implementation called `new Date()`, `toLocaleTimeString()` and
 * `toLocaleDateString()` *during render*. Next.js prerenders `/chat` on the
 * server, where `Date.now()` and the process locale/timezone differ from the
 * browser's, so the first client render produced different text than the server
 * sent. React reported it as a minified hydration error (#418) and threw away
 * the server markup.
 *
 * The fix has two halves:
 *
 *  1. Before hydration, render a *deterministic* string derived only from the
 *     ISO value: fixed locale (`en-GB`) and fixed timezone (`UTC`), and never a
 *     comparison against "now". Server and client therefore produce byte-identical
 *     markup on the first pass, by construction rather than by suppression.
 *  2. After mount, switch to the nicer locale/timezone-aware rendering (bare time
 *     for today, relative labels for recent activity).
 *
 * `suppressHydrationWarning` is retained as a second line of defence for the
 * narrow case of clock skew between the server render and hydration.
 */

const SSR_LOCALE = "en-GB";
const SSR_TIME_ZONE = "UTC";

/** Nothing to subscribe to: hydration state flips once and never changes again. */
function subscribeToHydration() {
  return () => {};
}

/**
 * False during SSR and on the first client render, true from hydration onwards.
 *
 * Implemented with useSyncExternalStore (rather than useState + useEffect) so the
 * server snapshot and the client snapshot are distinct by construction, which is
 * what guarantees the first client render matches the server markup. This mirrors
 * the pattern already used for language in src/context/LanguageContext.tsx.
 */
export function useIsHydrated(): boolean {
  return useSyncExternalStore(
    subscribeToHydration,
    () => true, // client snapshot
    () => false // server snapshot
  );
}

/**
 * @param hydrated pass `useIsHydrated()`. When false the output is deterministic
 *   and safe to render on the server.
 */
export function formatChatTime(iso: string, hydrated: boolean): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  if (!hydrated) {
    // No dependency on "now": identical on server and client.
    return date.toLocaleString(SSR_LOCALE, {
      timeZone: SSR_TIME_ZONE,
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return time;
  return `${date.toLocaleDateString([], { day: "2-digit", month: "short" })} · ${time}`;
}

/** @param hydrated pass `useIsHydrated()`. */
export function formatRelativeTime(iso: string, hydrated: boolean): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  // Relative labels are inherently time-dependent, so they cannot be rendered
  // before hydration. Fall back to the deterministic absolute form.
  if (!hydrated) return formatChatTime(iso, false);

  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatChatTime(iso, true);
}

/** Absolute timestamp, hydration-safe. Replaces inline `formatChatTime(...)` calls in JSX. */
export function ChatTimestamp({
  iso,
  className,
}: {
  iso: string;
  className?: string;
}) {
  const hydrated = useIsHydrated();
  if (!iso) return null;
  return (
    <time dateTime={iso} className={className} suppressHydrationWarning>
      {formatChatTime(iso, hydrated)}
    </time>
  );
}

/** Relative timestamp, hydration-safe. */
export function RelativeTimestamp({
  iso,
  className,
  prefix,
}: {
  iso: string;
  className?: string;
  prefix?: string;
}) {
  const hydrated = useIsHydrated();
  if (!iso) return null;
  return (
    <time dateTime={iso} className={className} suppressHydrationWarning>
      {prefix ? `${prefix}${formatRelativeTime(iso, hydrated)}` : formatRelativeTime(iso, hydrated)}
    </time>
  );
}

/**
 * Guards against rendering a timestamp that depends on wall-clock time during SSR.
 * Useful for call sites that need the raw string rather than a <time> element.
 */
export function useHydrationSafeTime(): {
  hydrated: boolean;
  formatTime: (iso: string) => string;
  formatRelative: (iso: string) => string;
} {
  const hydrated = useIsHydrated();
  return {
    hydrated,
    formatTime: (iso: string) => formatChatTime(iso, hydrated),
    formatRelative: (iso: string) => formatRelativeTime(iso, hydrated),
  };
}

export type { ReactNode };