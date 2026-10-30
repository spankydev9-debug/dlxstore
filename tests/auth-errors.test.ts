/**
 * Regression tests for the auth failure classification.
 *
 * These pin the distinction that caused the original defect: an unsettled
 * request (abort/timeout/network) must never be treated as a definitive
 * "signed out" verdict, because that turns a slow connection into a silent
 * sign-out, while treating it as "still loading" turns it into a spinner that
 * never resolves.
 *
 * Run with: npm test   (Node's built-in runner; no extra dependencies)
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  ProfileUnavailableError,
  SessionVerificationError,
  authFailureMessage,
  isInvalidSessionError,
  isUnsettledError,
} from "../src/lib/auth-errors.ts";

const abort = () => new DOMException("The operation was aborted.", "AbortError");
const timeout = () => new DOMException("Request exceeded the deadline", "TimeoutError");

test("aborts and timeouts are unsettled, never a sign-out verdict", () => {
  assert.equal(isUnsettledError(abort()), true);
  assert.equal(isUnsettledError(timeout()), true);
  assert.equal(isInvalidSessionError(abort()), false);
  assert.equal(isInvalidSessionError(timeout()), false);
});

test("transport failures are unsettled", () => {
  assert.equal(isUnsettledError(new TypeError("Failed to fetch")), true);
  assert.equal(isUnsettledError(new Error("fetch failed")), true);
  assert.equal(isUnsettledError({ message: "network error" }), true);
  assert.equal(isUnsettledError({ code: "ETIMEDOUT" }), true);
  assert.equal(isUnsettledError({ code: "NETWORK_ERROR" }), true);
});

test("definite auth verdicts are not unsettled", () => {
  assert.equal(isUnsettledError({ status: 401 }), false);
  assert.equal(isUnsettledError({ code: "bad_jwt" }), false);
  assert.equal(isUnsettledError({ code: "PGRST116" }), false);
  assert.equal(isUnsettledError(null), false);
  assert.equal(isUnsettledError(undefined), false);
});

test("only a definite verdict may clear the session", () => {
  assert.equal(isInvalidSessionError({ status: 401 }), true);
  assert.equal(isInvalidSessionError({ status: 403 }), true);
  assert.equal(isInvalidSessionError({ code: "bad_jwt" }), true);
  assert.equal(isInvalidSessionError({ code: "refresh_token_not_found" }), true);
  assert.equal(isInvalidSessionError(new Error("JWT expired")), true);
  assert.equal(isInvalidSessionError({ status: 500 }), false);
  assert.equal(isInvalidSessionError({ code: "PGRST116" }), false);
  assert.equal(isInvalidSessionError(new Error("some unrelated failure")), false);
});

test("errors carry the kind the UI branches on", () => {
  assert.equal(new SessionVerificationError().kind, "session-unverified");
  assert.equal(new ProfileUnavailableError().kind, "profile-unavailable");
  assert.equal(new SessionVerificationError().name, "SessionVerificationError");
  assert.equal(new ProfileUnavailableError().name, "ProfileUnavailableError");
});

test("both failure kinds have distinct, non-empty customer copy", () => {
  const session = authFailureMessage("session-unverified");
  const profile = authFailureMessage("profile-unavailable");
  assert.ok(session.length > 0);
  assert.ok(profile.length > 0);
  assert.notEqual(session, profile);
  // The copy must not leak implementation detail or blame the customer.
  for (const copy of [session, profile]) {
    assert.doesNotMatch(copy, /PGRST|jwt|RLS|supabase|row-level/i);
  }
});
