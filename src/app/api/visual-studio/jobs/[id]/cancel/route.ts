import { NextResponse } from "next/server";
import {
  isMissingSchemaError,
  requireCaller,
  UserScopeAuthError,
} from "../../../../../../services/server/user-scope";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function failure(error: unknown) {
  if (error instanceof UserScopeAuthError) {
    return NextResponse.json({ error: "unauthorized", reason: error.reason }, { status: 401 });
  }
  return NextResponse.json({ error: "server_not_configured" }, { status: 503 });
}

/** Cancels a queued or failed visual job. Ownership and state rules live in RLS/RPC. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let caller: Awaited<ReturnType<typeof requireCaller>>;
  try {
    caller = await requireCaller(request);
  } catch (error) {
    return failure(error);
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const { data, error } = await caller.client.rpc("cancel_visual_job", { p_job_id: id });

  if (error) {
    if (isMissingSchemaError(error)) {
      return NextResponse.json({ error: "schema_unavailable" }, { status: 503 });
    }
    return NextResponse.json({ error: "rejected", detail: error.message }, { status: 400 });
  }

  return NextResponse.json({ job: data });
}
