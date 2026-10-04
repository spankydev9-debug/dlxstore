import { NextResponse } from "next/server";

import {
  isMissingSchemaError,
  requireCaller,
  UserScopeAuthError,
} from "../../../../../../services/server/user-scope";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SendBody = { dryRun?: boolean };

/**
 * Fans a campaign out to its segment, or previews it.
 *
 * `dryRun: true` is the default. A preview reports the segment size and queues
 * nothing at all, so an admin can size a campaign before committing to it. A real
 * send still consent-checks every recipient, and a refusal is recorded as a
 * `skipped` row rather than dropped.
 *
 * Authorization is enforced by `admin_send_campaign` in SQL.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let caller: Awaited<ReturnType<typeof requireCaller>>;
  try {
    caller = await requireCaller(request);
  } catch (error) {
    if (error instanceof UserScopeAuthError) {
      return NextResponse.json({ error: "unauthorized", reason: error.reason }, { status: 401 });
    }
    return NextResponse.json({ error: "server_not_configured" }, { status: 503 });
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid_campaign" }, { status: 400 });
  }

  let body: SendBody;
  try {
    body = (await request.json()) as SendBody;
  } catch {
    body = {};
  }

  // Preview unless the caller explicitly opts into a real send.
  const dryRun = body.dryRun !== false;

  const { data, error } = await caller.client.rpc("admin_send_campaign", {
    p_campaign_id: id,
    p_dry_run: dryRun,
  });

  if (error) {
    if (/Admin access required/.test(error.message)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (isMissingSchemaError(error)) {
      return NextResponse.json(
        { error: "schema_unavailable", detail: "Communication migration is not applied." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "rejected", detail: error.message }, { status: 400 });
  }

  return NextResponse.json({ result: data, dryRun }, { status: dryRun ? 200 : 202 });
}
