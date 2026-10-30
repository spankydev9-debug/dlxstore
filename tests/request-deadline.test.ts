/**
 * Regression tests for the transport-level request deadline.
 *
 * The P0 freeze was a promise that never settled: `fetch` has no timeout, and the
 * auth layer gates the whole authenticated shell on one Supabase request. A
 * stalled gateway therefore held `isLoading` true forever. `fetchWithDeadline`
 * aborts at the transport layer so *every* request settles.
 *
 * These tests use a real local HTTP server that accepts a connection and never
 * responds — the same shape as a hung proxy — so they exercise the mechanism, not
 * a mocked clock.
 *
 * Run with: npm test   (Node's built-in runner; no extra dependencies)
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  MIN_REQUEST_TIMEOUT_MS,
  createDeadlineFetch,
  resolveRequestTimeoutMs,
} from "../src/lib/request-deadline.ts";

/** Server that accepts requests and never answers. */
async function hungServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(() => {
    /* deliberately never respond */
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/rest/v1/profiles`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

test("the shipped default deadline is 30s", () => {
  assert.equal(DEFAULT_REQUEST_TIMEOUT_MS, 30_000);
  assert.equal(resolveRequestTimeoutMs(undefined), 30_000);
  assert.equal(resolveRequestTimeoutMs(""), 30_000);
  assert.equal(resolveRequestTimeoutMs("nonsense"), 30_000);
  // A deadline shorter than the documented minimum is ignored rather than
  // silently turning every request into a failure on a slow network.
  assert.equal(resolveRequestTimeoutMs(String(MIN_REQUEST_TIMEOUT_MS - 1)), 30_000);
});

test("a configured override is honoured", () => {
  assert.equal(resolveRequestTimeoutMs("5000"), 5_000);
  assert.equal(resolveRequestTimeoutMs(String(MIN_REQUEST_TIMEOUT_MS)), MIN_REQUEST_TIMEOUT_MS);
});

test("a hung request settles by aborting at the deadline", async () => {
  // 1 s is the documented minimum override, so this stays fast without inventing
  // a fake clock.
  const fetchWithDeadline = createDeadlineFetch(MIN_REQUEST_TIMEOUT_MS);
  const server = await hungServer();
  const started = Date.now();
  try {
    await assert.rejects(
      () => fetchWithDeadline(server.url),
      (error: unknown) => {
        const name = (error as { name?: string })?.name ?? "";
        assert.match(name, /^(TimeoutError|AbortError)$/);
        return true;
      }
    );
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 900, `aborted too early (${elapsed}ms)`);
    assert.ok(elapsed < 5_000, `deadline did not fire promptly (${elapsed}ms)`);
  } finally {
    await server.close();
  }
});

test("the caller's own signal still aborts before the deadline", async () => {
  const fetchWithDeadline = createDeadlineFetch(MIN_REQUEST_TIMEOUT_MS);
  const server = await hungServer();
  const controller = new AbortController();
  const started = Date.now();
  setTimeout(() => controller.abort(new DOMException("cancelled", "AbortError")), 100);
  try {
    await assert.rejects(() => fetchWithDeadline(server.url, { signal: controller.signal }));
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 900, `caller cancellation was not honoured (${elapsed}ms)`);
  } finally {
    await server.close();
  }
});

test("a fast request is not disturbed by the deadline", async () => {
  const fetchWithDeadline = createDeadlineFetch(MIN_REQUEST_TIMEOUT_MS);
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"ok":true}');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const response = await fetchWithDeadline(`http://127.0.0.1:${port}/rest/v1/profiles`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
