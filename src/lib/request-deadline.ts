/**
 * Transport-level request deadline.
 *
 * `fetch` has no timeout of its own, so a stalled gateway, a paused project or a
 * captive-portal connection leaves the returned promise pending forever. The auth
 * layer gates the whole authenticated shell on one such promise
 * (`supabase.auth.getUser()`), which is how a slow network becomes a screen that
 * never stops loading.
 *
 * Aborting at the transport layer makes every promise settle, so the UI can
 * always reach a decision. This is a network deadline, not a UI timeout: nothing
 * is decided here, the request simply fails the way a real network error does and
 * the auth layer classifies it as "unsettled" (never as "signed out").
 *
 * Kept dependency-free (and separate from the Supabase client module) so the
 * behaviour can be tested without a browser or a Supabase project.
 */

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const MIN_REQUEST_TIMEOUT_MS = 1_000;

/**
 * Resolve the deadline from a raw environment value, falling back to the default
 * for anything missing, unparsable or dangerously short.
 */
export function resolveRequestTimeoutMs(raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < MIN_REQUEST_TIMEOUT_MS) return DEFAULT_REQUEST_TIMEOUT_MS;
  return value;
}

/**
 * Build a `fetch` that aborts after `timeoutMs`, preserving any caller-supplied
 * signal: whichever aborts first wins, so caller cancellation is never delayed by
 * the deadline and the deadline is never disarmed by a caller signal.
 */
export function createDeadlineFetch(timeoutMs: number): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(
        typeof DOMException === "function"
          ? new DOMException("Request exceeded the deadline", "TimeoutError")
          : new Error("Request exceeded the deadline")
      );
    }, timeoutMs);

    const callerSignal = init?.signal;
    const signal =
      callerSignal && typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function"
        ? AbortSignal.any([callerSignal, controller.signal])
        : controller.signal;

    return fetch(input, { ...init, signal }).finally(() => clearTimeout(timer));
  }) as typeof fetch;
}
