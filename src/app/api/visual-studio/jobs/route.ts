import { NextResponse } from "next/server";
import {
  describeVisualProviderCapability,
} from "../../../../services/visual-studio/provider";
import {
  isMissingSchemaError,
  requireCaller,
  UserScopeAuthError,
} from "../../../../services/server/user-scope";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const WORKFLOWS = new Set(["try_on", "product_visualization", "ghost_mannequin"]);

type CreateBody = {
  workflow?: string;
  productId?: string;
  sourceProductImageId?: string;
  avatarId?: string;
  requestKey?: string;
  constraints?: Record<string, unknown>;
};

function authFailure(error: UserScopeAuthError) {
  return NextResponse.json(
    { error: "unauthorized", reason: error.reason },
    { status: 401 }
  );
}

/**
 * Creates a visual job using the caller's own session.
 *
 * The job is written through the `create_visual_job` SECURITY DEFINER RPC, which
 * owns every authorization and validation decision (active product, real media
 * row, own Avatar, admin-only supplier workflows, 8 KB constraint cap). The route
 * adds only idempotency-key validation and an honest capability report.
 *
 * When no provider is configured the job is still recorded as `queued`: that is
 * the true state of a request that has been accepted but not yet dispatched. The
 * response tells the client generation is unavailable so the UI never implies a
 * result is coming.
 */
export async function POST(request: Request) {
  let caller: Awaited<ReturnType<typeof requireCaller>>;
  try {
    caller = await requireCaller(request);
  } catch (error) {
    if (error instanceof UserScopeAuthError) return authFailure(error);
    return NextResponse.json(
      { error: "server_not_configured" },
      { status: 503 }
    );
  }

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const workflow = String(body.workflow ?? "").trim();
  const productId = String(body.productId ?? "").trim();
  const sourceProductImageId = String(body.sourceProductImageId ?? "").trim();
  const requestKey = String(body.requestKey ?? "").trim();
  // Required by `create_visual_job` for try_on; optional for admin-only
  // supplier workflows, which may run without a customer mannequin.
  const avatarId = body.avatarId ? String(body.avatarId).trim() : "";

  if (!WORKFLOWS.has(workflow)) {
    return NextResponse.json({ error: "invalid_workflow" }, { status: 400 });
  }
  if (!UUID_RE.test(productId) || !UUID_RE.test(sourceProductImageId)) {
    return NextResponse.json({ error: "invalid_reference" }, { status: 400 });
  }
  if (workflow === "try_on" && !UUID_RE.test(avatarId)) {
    return NextResponse.json({ error: "avatar_required" }, { status: 400 });
  }
  if (!UUID_RE.test(requestKey)) {
    return NextResponse.json({ error: "request_key_required" }, { status: 400 });
  }

  const constraints =
    body.constraints && typeof body.constraints === "object" && !Array.isArray(body.constraints)
      ? body.constraints
      : {};

  const { data, error } = await caller.client.rpc("create_visual_job", {
    p_workflow: workflow,
    p_product_id: productId,
    p_avatar_id: avatarId === "" ? null : avatarId,
    p_source_product_image_id: sourceProductImageId,
    p_request_key: requestKey,
    p_constraints: constraints,
  });

  if (error) {
    if (isMissingSchemaError(error)) {
      return NextResponse.json(
        { error: "schema_unavailable", detail: "Visual Studio migration is not applied." },
        { status: 503 }
      );
    }
    // The RPC raises plain exceptions for every validation rule; surface the
    // message without leaking SQL internals.
    return NextResponse.json({ error: "rejected", detail: error.message }, { status: 400 });
  }

  const capability = describeVisualProviderCapability();

  return NextResponse.json(
    {
      job: data,
      generation: capability.available ? "dispatching" : "unavailable",
      capability: {
        reason: capability.reason,
        serviceRolePresent: capability.serviceRolePresent,
      },
    },
    { status: 202 }
  );
}
