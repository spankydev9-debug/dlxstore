import { NextResponse } from "next/server";
import {
  isMissingSchemaError,
  requireCaller,
  UserScopeAuthError,
} from "../../../../../services/server/user-scope";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const JOB_COLUMNS =
  "id, profile_id, product_id, avatar_id, workflow, request_key, status, provider, " +
  "provider_job_id, source_product_image_id, result_asset_path, result_image_url, " +
  "approved_product_image_id, error, error_code, attempt_count, constraints, " +
  "created_at, updated_at, started_at, completed_at";

/**
 * Reads one visual job and its provenance assets with the caller's own session.
 *
 * Row-level security decides visibility: a customer sees only their own job, an
 * admin sees any job. The route never filters by profile id itself.
 *
 * `result_url` is intentionally omitted. A generated result lives in the private
 * `visual-workspace` bucket, and minting a signed URL requires a service-role
 * credential that this project does not have. The client is told this explicitly
 * instead of receiving a URL that would 403, or a fabricated image.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const { data: job, error } = await caller.client
    .from("try_on_jobs")
    .select(JOB_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    if (isMissingSchemaError(error)) {
      return NextResponse.json({ error: "schema_unavailable" }, { status: 503 });
    }
    return NextResponse.json({ error: "read_failed" }, { status: 400 });
  }

  // RLS hides other people's jobs, so a null result means "not yours or gone".
  if (!job) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const jobRecord = job as unknown as Record<string, unknown>;

  const { data: assets } = await caller.client
    .from("visual_job_assets")
    .select(
      "id, job_id, asset_role, source_product_image_id, storage_object_path, " +
        "source_url, mime_type, byte_size, width, height, created_at"
    )
    .eq("job_id", id)
    .order("created_at", { ascending: true });

  const status = String(jobRecord.status ?? "");
  const hasCompletedResult = status === "completed" && Boolean(jobRecord.result_asset_path);

  return NextResponse.json({
    job: jobRecord,
    assets: assets ?? [],
    result: {
      available: hasCompletedResult,
      // Honest reason: the bytes exist but no service-role credential exists to
      // sign a delivery URL.
      reason: hasCompletedResult ? "service_role_required" : "not_ready",
    },
  });
}
