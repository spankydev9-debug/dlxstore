import { NextResponse } from "next/server";

import {
  isMissingSchemaError,
  requireCaller,
  UserScopeAuthError,
} from "../../../../services/server/user-scope";
import { dispatchOutbox } from "../../../../services/messaging/dispatcher";

export const dynamic = "force-dynamic";

const CHANNELS = new Set(["in_app", "whatsapp", "email"]);

type DispatchBody = {
  channel?: string;
  limit?: number;
  staleAfterMinutes?: number;
};

/**
 * Runs one dispatcher pass as the calling admin.
 *
 * Authorization lives in SQL: `admin_claim_outbox` raises 'Admin access required'
 * for a non-admin caller, so this route returns 403 on that rather than trusting
 * anything the client sends. The caller JWT is used throughout — no service role.
 *
 * The response is a truthful tally. `delivered` counts only rows a provider
 * confirmed; `requeued` counts rows holding a retryable failure; `abandoned`
 * counts rows parked for an admin to look at.
 */
export async function POST(request: Request) {
  let caller: Awaited<ReturnType<typeof requireCaller>>;
  try {
    caller = await requireCaller(request);
  } catch (error) {
    if (error instanceof UserScopeAuthError) {
      return NextResponse.json(
        { error: "unauthorized", reason: error.reason },
        { status: 401 }
      );
    }
    return NextResponse.json({ error: "server_not_configured" }, { status: 503 });
  }

  let body: DispatchBody = {};
  try {
    body = (await request.json()) as DispatchBody;
  } catch {
    // An empty body is legitimate: dispatch everything claimable.
    body = {};
  }

  const channel = body.channel ? String(body.channel).trim() : null;
  if (channel !== null && !CHANNELS.has(channel)) {
    return NextResponse.json({ error: "invalid_channel" }, { status: 400 });
  }

  const limit = Number(body.limit ?? 25);
  if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit < 1 || limit > 200) {
    return NextResponse.json({ error: "invalid_limit" }, { status: 400 });
  }

  try {
    const summary = await dispatchOutbox(caller.client, {
      channel: channel as never,
      limit,
      staleAfterMinutes:
        typeof body.staleAfterMinutes === "number" ? body.staleAfterMinutes : undefined,
    });
    return NextResponse.json({ summary });
  } catch (error) {
    if (error instanceof Error && /Admin access required/.test(error.message)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const rpcError = (error as { message?: string })?.message ?? "";
    if (isMissingSchemaError({ code: rpcError })) {
      return NextResponse.json(
        { error: "schema_unavailable", detail: "Communication migration is not applied." },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: "dispatch_failed", detail: error instanceof Error ? error.message : "Unknown error." },
      { status: 500 }
    );
  }
}