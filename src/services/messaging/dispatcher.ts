import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  describeMessagingProviderCapability,
  getMessagingProvider,
  isExternalChannel,
  type DeliverableChannel,
} from "./provider";

/**
 * Outbox dispatcher (P13).
 *
 * Drains claimed `message_outbox` rows using the caller's own admin session. It
 * never uses a service-role credential: `admin_claim_outbox`,
 * `admin_record_outbox_result` and `deliver_in_app_message` each re-check
 * `public.is_admin()` in SQL, so this file is a transport loop, not an
 * authorization decision.
 *
 * Exactly-once handling lives in the database, not here. `admin_claim_outbox`
 * claims with `FOR UPDATE SKIP LOCKED`, so two concurrent dispatchers cannot take
 * the same row, and every outcome is written back per row. A row that fails is
 * requeued with backoff until `max_attempts`, then marked `failed` for an admin
 * to inspect — it is never dropped and never reported as delivered.
 */
export type DispatchSummary = {
  claimed: number;
  delivered: number;
  failed: number;
  requeued: number;
  /** Rows a permanent failure or a missing credential parked. */
  abandoned: number;
  /** Claimed rows that had no usable destination. */
  undeliverable: number;
  /** Rows released back to pending because their worker never reported back. */
  released: number;
};

export type DispatchOptions = {
  channel?: DeliverableChannel | null;
  limit?: number;
  staleAfterMinutes?: number;
};

/** A claimed row, narrowed to the fields the transport loop needs. */
type ClaimedRow = {
  id: string;
  channel: DeliverableChannel;
  template_key: string;
  locale: string;
  recipient_address: string | null;
  subject: string | null;
  body: string;
  is_transactional: boolean;
};

const num = (value: unknown, fallback: number): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function asRows(data: unknown): ClaimedRow[] {
  return (Array.isArray(data) ? data : []) as ClaimedRow[];
}

async function recordOutcome(
  client: SupabaseClient,
  row: ClaimedRow,
  outcome: { ok: true; provider: string; providerMessageId: string } | {
    ok: false;
    provider: string;
    error: string;
    permanent: boolean;
  }
): Promise<"sent" | "failed" | "pending"> {
  const { data, error } = await client.rpc("admin_record_outbox_result", {
    p_outbox_id: row.id,
    p_success: outcome.ok,
    p_provider: outcome.ok ? outcome.provider : outcome.provider,
    p_provider_message_id: outcome.ok ? outcome.providerMessageId : null,
    p_error: outcome.ok ? null : outcome.error.slice(0, 500),
    p_permanent_failure: outcome.ok ? false : outcome.permanent,
  });

  if (error) {
    // Losing the outcome write would otherwise strand the row in `sending`
    // until the stale sweep releases it, so surface it rather than swallow it.
    throw new Error(`Unable to record delivery for ${row.id}: ${error.message}`);
  }

  const status = typeof data === "string" ? data : outcome.ok ? "sent" : "pending";
  return status === "sent" ? "sent" : status === "failed" ? "failed" : "pending";
}

/**
 * Claims a batch and delivers it.
 *
 * Returns a truthful summary. `delivered` counts only rows a provider confirmed.
 */
export async function dispatchOutbox(
  client: SupabaseClient,
  options: DispatchOptions = {}
): Promise<DispatchSummary> {
  const limit = Math.min(Math.max(num(options.limit, 25), 1), 200);
  const staleAfter = Math.min(Math.max(num(options.staleAfterMinutes, 15), 1), 1440);

  const summary: DispatchSummary = {
    claimed: 0,
    delivered: 0,
    failed: 0,
    requeued: 0,
    abandoned: 0,
    undeliverable: 0,
    released: 0,
  };

  // Recover rows whose worker died mid-flight before claiming anything new.
  // A failure here means rows stay parked in `sending` forever, so it is raised
  // rather than swallowed -- an invisible release failure looks identical to
  // "there was nothing to recover".
  const released = await client.rpc("admin_release_stale_outbox", {
    p_older_than_minutes: staleAfter,
  });
  if (released.error) {
    throw new Error(`Unable to release stale outbox rows: ${released.error.message}`);
  }
  if (typeof released.data === "number") {
    summary.released = released.data;
  }

  const claimed = await client.rpc("admin_claim_outbox", {
    p_limit: limit,
    p_channel: options.channel ?? null,
  });
  if (claimed.error) {
    throw new Error(`Unable to claim outbox rows: ${claimed.error.message}`);
  }

  const rows = asRows(claimed.data);
  summary.claimed = rows.length;

  for (const row of rows) {
    // The native channel is a single RPC that writes the P9 notification and
    // marks the row sent atomically, so it needs no provider and no loop.
    if (!isExternalChannel(row.channel)) {
      const { error } = await client.rpc("deliver_in_app_message", { p_outbox_id: row.id });
      if (error) {
        await recordOutcome(client, row, {
          ok: false,
          provider: "notifications",
          error: error.message,
          permanent: true,
        });
        summary.abandoned += 1;
        continue;
      }
      summary.delivered += 1;
      continue;
    }

    const destination = row.recipient_address?.trim() ?? "";

    if (destination === "") {
      // Should not happen: enqueue parks these as `skipped`. Treated as permanent
      // so a malformed row cannot occupy the retry budget forever.
      const status = await recordOutcome(client, row, {
        ok: false,
        provider: "none",
        error: "No destination address on this row.",
        permanent: true,
      });
      summary.undeliverable += 1;
      if (status === "failed") summary.abandoned += 1;
      continue;
    }

    const provider = getMessagingProvider(row.channel);

    if (!provider) {
      const status = await recordOutcome(client, row, {
        ok: false,
        provider: row.channel,
        error: `No provider is configured for ${row.channel}.`,
        permanent: true,
      });
      summary.abandoned += 1;
      void status;
      continue;
    }

    let outcome: Awaited<ReturnType<typeof provider.send>>;
    try {
      outcome = await provider.send({
        outboxId: row.id,
        channel: row.channel,
        to: destination,
        subject: row.subject,
        body: row.body,
        locale: row.locale,
        templateKey: row.template_key,
        isTransactional: row.is_transactional,
      });
    } catch (error) {
      outcome = {
        ok: false,
        provider: provider.name,
        error: error instanceof Error ? error.message : "Provider threw unexpectedly.",
        permanent: false,
      };
    }

    const status = await recordOutcome(client, row, outcome);

    if (status === "sent") {
      summary.delivered += 1;
    } else if (status === "failed") {
      summary.failed += 1;
      summary.abandoned += 1;
    } else {
      summary.requeued += 1;
    }
  }

  return summary;
}

/** Convenience for a status response: configuration plus a one-line reason. */
export function describeDispatchReadiness() {
  const capability = describeMessagingProviderCapability();
  return {
    ...capability,
    // `in_app_only` is a working state, not an error: transactional notifications
    // still deliver, and external channels park their rows as failed rather than
    // silently vanishing.
    externalDeliveryPossible: capability.available,
  };
}
