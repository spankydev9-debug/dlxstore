/**
 * Auth failure classification.
 *
 * The dashboard must distinguish three states that used to collapse into one:
 *   1. there is no session            → the customer is signed out (redirect);
 *   2. the session could not be       → the network/deadline failed, the session
 *      verified within the deadline     is probably still valid (offer a retry);
 *   3. the session is valid but the   → the account exists but its profile could
 *      profile is unavailable           not be read (offer a retry, never a
 *                                       silent sign-out).
 *
 * Collapsing (2) and (3) into "signed out" is what produced the misleading
 * log-in loop; collapsing everything into "loading" is what produced a spinner
 * that never resolved. This module is deliberately dependency-free so the
 * classification can be unit-tested without a Supabase client.
 */

export type AuthFailureKind = "session-unverified" | "profile-unavailable";

export class SessionVerificationError extends Error {
  readonly kind = "session-unverified" as const;
  readonly cause?: unknown;

  constructor(cause?: unknown) {
    super("The session could not be verified in time.");
    this.name = "SessionVerificationError";
    this.cause = cause;
  }
}

export class ProfileUnavailableError extends Error {
  readonly kind = "profile-unavailable" as const;
  readonly cause?: unknown;

  constructor(cause?: unknown) {
    super("The customer profile is not available yet.");
    this.name = "ProfileUnavailableError";
    this.cause = cause;
  }
}

/**
 * True when an error means "we could not reach a verdict", as opposed to
 * "the server gave a definite answer". Aborts, timeouts and network failures
 * leave the session in an unknown state, so the caller must not sign the
 * customer out on the strength of one.
 */
export function isUnsettledError(error: unknown): boolean {
  if (!error) return false;

  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name?: unknown }).name ?? "")
      : "";
  if (/^(AbortError|TimeoutError)$/i.test(name)) return true;

  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  // PostgREST/supabase-js surface aborts as a thrown payload rather than a
  // Response; 0/undefined status never reaches us as a code, so match the
  // transport-level markers instead.
  if (/^(NETWORK_ERROR|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|UND_ERR_CONNECT_TIMEOUT)$/i.test(code)) {
    return true;
  }

  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : String(error);
  return /abort|timed? ?out|timeout|failed to fetch|network ?error|fetch failed|load failed/i.test(
    message
  );
}

/**
 * True when an auth error is a definite "this session is no longer valid"
 * verdict. Only these may clear the session; anything unsettled must not.
 */
export function isInvalidSessionError(error: unknown): boolean {
  const status =
    error && typeof error === "object" && "status" in error
      ? Number((error as { status?: unknown }).status)
      : NaN;
  if (status === 401 || status === 403) return true;

  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  if (code === "session_not_found" || code === "refresh_token_not_found" || code === "bad_jwt") {
    return true;
  }

  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : "";
  return /invalid (jwt|token)|token (is )?expired|jwt expired|session (not found|missing|invalid)/i.test(
    message
  );
}

/** Human-readable, non-technical copy for each failure kind. */
export function authFailureMessage(kind: AuthFailureKind): string {
  switch (kind) {
    case "session-unverified":
      return "We couldn't confirm your session because the connection didn't respond. Your account is safe — try again.";
    case "profile-unavailable":
      return "Your account is signed in, but we couldn't load your profile. Try again in a moment.";
  }
}
