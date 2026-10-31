/**
 * Regression tests for chat history pagination.
 *
 * These cover the failure modes that are invisible in a short test conversation
 * but destroy long threads in production:
 *
 *   - a realtime insert refreshing the newest page must not drop history the
 *     reader already loaded (the thread shows the new message and keeps the rest);
 *   - switching conversations must never leak the previous thread's messages;
 *   - prepending an older page must be idempotent (no duplicate bubbles);
 *   - an empty server page must clear the thread rather than show stale rows;
 *   - page sizes are clamped to what the queries actually support.
 *
 * Run with: npm test   (Node's built-in runner; no extra dependencies)
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  MESSAGE_PAGE_SIZE,
  isBeforeCursor,
  mergeNewestPage,
  normalizePageSize,
  prependOlderPage,
} from "../src/lib/chat-pagination.ts";

type Msg = { id: string; conversation_id: string; created_at: string };

function msg(id: string, createdAt: string, conversationId = "conv-1"): Msg {
  return { id, conversation_id: conversationId, created_at: createdAt };
}

const t = (minute: number) => `2026-10-31T10:${String(minute).padStart(2, "0")}:00.000000+00:00`;

test("the default page size is bounded", () => {
  assert.equal(MESSAGE_PAGE_SIZE, 40);
  assert.equal(normalizePageSize(undefined), MESSAGE_PAGE_SIZE);
  assert.equal(normalizePageSize(0), 1);
  assert.equal(normalizePageSize(-5), 1);
  assert.equal(normalizePageSize(10_000), 100);
  assert.equal(normalizePageSize(12.7), 12);
  assert.equal(normalizePageSize(Number.NaN), MESSAGE_PAGE_SIZE);
});

test("a newer page keeps older loaded history", () => {
  const current = [msg("m1", t(1)), msg("m2", t(2)), msg("m3", t(3))];
  const newest = [msg("m4", t(4))];

  const merged = mergeNewestPage("conv-1", current, newest);

  assert.deepEqual(
    merged.map((m) => m.id),
    ["m1", "m2", "m3", "m4"],
    "history must survive a realtime insert"
  );
});

test("messages inside the newest page are replaced by the server copy", () => {
  const current = [msg("m2", t(2)), msg("m3", t(3))];
  const newest = [msg("m2", t(2)), msg("m3", t(3)), msg("m4", t(4))];

  const merged = mergeNewestPage("conv-1", current, newest);

  assert.deepEqual(
    merged.map((m) => m.id),
    ["m2", "m3", "m4"],
    "no duplicated bubbles when the page overlaps loaded messages"
  );
});

test("a page for another conversation never leaks into the open thread", () => {
  const current = [msg("a1", t(1), "conv-a"), msg("a2", t(2), "conv-a")];
  const stalePage = [msg("b9", t(9), "conv-b")];

  // A fetch for conv-a that resolves holding conv-b rows must contribute nothing;
  // the caller also discards results for a conversation that is no longer open.
  const merged = mergeNewestPage("conv-a", current, stalePage);

  assert.deepEqual(merged, [], "rows from another thread are never mixed in");
});

test("an empty page clears the thread instead of showing stale rows", () => {
  const current = [msg("m1", t(1))];
  assert.deepEqual(mergeNewestPage("conv-1", current, []), []);
});

test("prepending an older page is idempotent", () => {
  const current = [msg("m3", t(3)), msg("m4", t(4))];
  const older = [msg("m1", t(1)), msg("m2", t(2)), msg("m3", t(3))];

  const first = prependOlderPage(current, older);
  assert.deepEqual(first.map((m) => m.id), ["m1", "m2", "m3", "m4"]);

  const second = prependOlderPage(first, older);
  assert.equal(second, first, "re-loading the same page is a no-op");
});

test("the older-page cursor is strict about the boundary message", () => {
  const cursor = { createdAt: t(5), id: "m5" };

  assert.equal(isBeforeCursor({ id: "m4", created_at: t(4) }, cursor), true);
  assert.equal(isBeforeCursor({ id: "m6", created_at: t(6) }, cursor), false);
  assert.equal(
    isBeforeCursor({ id: "m5", created_at: t(5) }, cursor),
    false,
    "the cursor message itself is not re-fetched"
  );
  assert.equal(
    isBeforeCursor({ id: "a5", created_at: t(5) }, cursor),
    true,
    "same-timestamp messages are ordered by id"
  );
});
