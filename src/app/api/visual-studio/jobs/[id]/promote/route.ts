import { NextResponse } from "next/server";
import { describeVisualProviderCapability } from "../../../../../../services/visual-studio/provider";
import {
  isMissingSchemaError,
  readCallerRole,
  requireCaller,
  UserScopeAuthError,
} from "../../../../../../services/server/user-scope";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PromoteBody = {
  publicUrl?: string;
  storageObjectPath?: string;
  altText?: string;
  makePrimary?: boolean;
};

/**
 * Publishes an APPROVED generated asset into the public catalogue.
 *
 * This is the admin side of the Ghost Mannequin flow: an operator reviews a
 * generated result and explicitly approves it, and only then may it become
 * normal product media. `promote_visual_job_output` re-checks admin status, the
 * workflow, the completed state and the presence of a provider output, so a
 * browser cannot self-approve an image into the catalogue.
 *
 * The prerequisite step — copying the object out of the private
 * `visual-workspace` bucket into the public `product-images` bucket — requires a
 * service-role credential. This project has none, so the route validates and
 * authorizes the request and then reports the exact missing dependency instead of
 * pretending the copy happened. The original supplier image is never touched by
 * any of these paths.
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

  let body: PromoteBody;
  try {
    body = (await request.json()) as PromoteBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const publicUrl = String(body.publicUrl ?? "").trim();
  const storageObjectPath = String(body.storageObjectPath ?? "").trim();

  if (!publicUrl || !storageObjectPath) {
    return NextResponse.json(
      { error: "invalid_reference", detail: "publicUrl and storageObjectPath are required." },
      { status: 400 }
    );
  }

  // Read the job first so an operator gets a precise refusal rather than a
  // generic dependency error when the job is not actually publishable.
  const { data: job, error: jobError } = await caller.client
    .from("try_on_jobs")
    .select("id, status, workflow, approved_product_image_id, result_asset_path")
    .eq("id", id)
    .maybeSingle();

  if (jobError) {
    if (isMissingSchemaError(jobError)) {
      return NextResponse.json({ error: "schema_unavailable" }, { status: 503 });
    }
    return NextResponse.json({ error: "read_failed" }, { status: 400 });
  }
  if (!job) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (job.approved_product_image_id) {
    return NextResponse.json({ error: "already_promoted", productImageId: job.approved_product_image_id });
  }
  if (job.status !== "completed") {
    return NextResponse.json(
      { error: "rejected", detail: "Only a completed visual job can be published." },
      { status: 400 }
    );
  }

  const capability = describeVisualProviderCapability();
  if (!capability.serviceRolePresent) {
    return NextResponse.json(
      {
        error: "service_role_required",
        detail:
          "Copying a generated object from the private visual-workspace bucket to the " +
          "public product-images bucket requires SUPABASE_SERVICE_ROLE_KEY.",
        job,
      },
      { status: 503 }
    );
  }

  // Reached only once a service-role credential exists. `promote_visual_job_output`
  // still performs the authoritative authorization.
  const { data, error } = await caller.client.rpc("promote_visual_job_output", {
    p_job_id: id,
    p_public_url: publicUrl,
    p_storage_object_path: storageObjectPath,
    p_alt_text: body.altText?.trim() || null,
    p_make_primary: body.makePrimary === true,
  });

  if (error) {
    if (isMissingSchemaError(error)) {
      return NextResponse.json({ error: "schema_unavailable" }, { status: 503 });
    }
    return NextResponse.json({ error: "rejected", detail: error.message }, { status: 400 });
  }

  return NextResponse.json({ productImage: data });
}
