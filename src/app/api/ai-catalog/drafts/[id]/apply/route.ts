import { NextResponse } from "next/server";
import {
  isMissingSchemaError,
  readCallerRole,
  requireCaller,
  UserScopeAuthError,
} from "../../../../../../services/server/user-scope";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Publishes an approved draft to the catalogue.
 *
 * `apply_ai_catalog_draft` refuses anything that is not `approved`, so this
 * endpoint cannot be used to bypass human review. It also never touches price,
 * stock, SKU or product visibility.
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

  const { data, error } = await caller.client.rpc("apply_ai_catalog_draft", {
    p_draft_id: id,
  });

  if (error) {
    if (isMissingSchemaError(error)) {
      return NextResponse.json({ error: "schema_unavailable" }, { status: 503 });
    }
    return NextResponse.json({ error: "rejected", detail: error.message }, { status: 400 });
  }

  return NextResponse.json({ result: data });
}
