/**
 * Regression tests for the in-flight request de-duplicator used to collapse
 * duplicate catalogue/campaign reads.
 *
 * The contract matters for correctness, not just traffic: callers rely on two
 * simultaneous reads resolving from one request, and on a *failed* request not
 * poisoning the key (the next caller must retry rather than receive a cached
 * rejection forever).
 *
 * Run with: npm test   (Node's built-in runner; no extra dependencies)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { shareInFlight } from "../src/lib/inflight.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("concurrent callers share one request", async () => {
  let runs = 0;
  const run = async () => {
    runs += 1;
    await tick();
    return "value";
  };

  const [a, b, c] = await Promise.all([
    shareInFlight("shared-key", run),
    shareInFlight("shared-key", run),
    shareInFlight("shared-key", run),
  ]);

  assert.equal(runs, 1);
  assert.deepEqual([a, b, c], ["value", "value", "value"]);
});

test("an independent key is not de-duplicated against another", async () => {
  let runs = 0;
  const run = async () => {
    runs += 1;
    // Capture the call's own id *before* yielding: both bodies run before either
    // resolves, so reading the shared counter afterwards would make them equal.
    const id = runs;
    await tick();
    return id;
  };

  const [a, b] = await Promise.all([
    shareInFlight("key-a", run),
    shareInFlight("key-b", run),
  ]);

  assert.equal(runs, 2);
  assert.notEqual(a, b);
});

test("the key is released after success, so the next call re-reads", async () => {
  let runs = 0;
  const run = async () => {
    runs += 1;
    return runs;
  };

  assert.equal(await shareInFlight("release-after-success", run), 1);
  await tick();
  assert.equal(await shareInFlight("release-after-success", run), 2);
});

test("a rejected request does not poison the key", async () => {
  let runs = 0;
  const failing = async () => {
    runs += 1;
    throw new Error("boom");
  };

  await assert.rejects(() => shareInFlight("release-after-failure", failing), /boom/);
  await tick();

  const recovered = await shareInFlight("release-after-failure", async () => {
    runs += 1;
    return "ok";
  });

  assert.equal(runs, 2);
  assert.equal(recovered, "ok");
});
