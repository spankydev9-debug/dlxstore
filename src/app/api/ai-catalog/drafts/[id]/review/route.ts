import { NextResponse } from "next/server";
import {
  isMissingSchemaError,
  readCallerRole,
  requireCaller,
  UserScopeAuthError,
} from "../../../../../../services/server/user-scope";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ReviewBody = {
  decision?: string;
  reviewNote?: string;
  patch?: Record<string, unknown>;
};

/**
 * Records a human review decision and any field edits made during review.
 *
 * Authorization, the editable-field allowlist and the state transition all live
 * in `review_ai_catalog_draft`; this route only validates the request shape.
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
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const role = await readCallerRole(caller.client, caller.userId);
  if (role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: ReviewBody;
  try {
    body = (await request.json()) as ReviewBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const decision = String(body.decision ?? "").trim();
  if (decision !== "approve" && decision !== "reject" && decision !== "reopen") {
    return NextResponse.json({ error: "invalid_decision" }, { status: 400 });
  }

  const { data, error } = await caller.client.rpc("review_ai_catalog_draft", {
    p_draft_id: id,
    p_decision: decision,
    p_review_note: body.reviewNote?.trim() || null,
    p_patch: body.patch ?? {},
  });

  if (error) {
    if (isMissingSchemaError(error)) {
      return NextResponse.json({ error: "schema_unavailable" }, { status: 503 });
    }
    return NextResponse.json({ error: "rejected", detail: error.message }, { status: 400 });
  }

  return NextResponse.json({ draft: (data ?? {}) as Record<string, unknown> });
}
