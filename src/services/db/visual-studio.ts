import { CustomerAvatar, Product, ProductMediaAsset } from "../../types";
import { isDemoMode, isSupabaseConfigured, supabase } from "./index";

export type VisualWorkflow = "try_on" | "product_visualization" | "ghost_mannequin";
export type VisualJobStatus = "queued" | "processing" | "completed" | "failed" | "canceled";

export interface VisualJob {
  id: string;
  profile_id: string;
  product_id: string;
  avatar_id: string | null;
  workflow: VisualWorkflow;
  request_key: string | null;
  status: VisualJobStatus;
  provider: string | null;
  provider_job_id: string | null;
  source_product_image_id: string | null;
  result_asset_path: string | null;
  result_image_url: string | null;
  approved_product_image_id: string | null;
  error: string | null;
  error_code: string | null;
  attempt_count: number;
  constraints: Record<string, unknown>;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface VisualJobAsset {
  id: string;
  job_id: string;
  asset_role: "catalog_source" | "customer_input" | "provider_output" | "approved_catalog_output";
  source_product_image_id: string | null;
  storage_object_path: string | null;
  source_url: string | null;
  created_at: string;
}

export class VisualStudioUnavailableError extends Error {
  constructor(message = "Visual Studio is awaiting secure backend activation.") {
    super(message);
    this.name = "VisualStudioUnavailableError";
  }
}

function isSchemaUnavailable(error: { code?: string; message?: string } | null) {
  return error?.code === "PGRST202"
    || error?.code === "PGRST205"
    || error?.code === "42P01"
    || error?.code === "42703";
}

function requireConfiguredClient() {
  if (!isSupabaseConfigured || !supabase) {
    throw new VisualStudioUnavailableError(
      isDemoMode
        ? "Visual Studio jobs are unavailable in demo mode."
        : "Visual Studio requires Supabase configuration."
    );
  }
  return supabase;
}

const JOB_COLUMNS =
  "id, profile_id, product_id, avatar_id, workflow, request_key, status, provider, " +
  "provider_job_id, source_product_image_id, result_asset_path, result_image_url, " +
  "approved_product_image_id, error, error_code, attempt_count, constraints, " +
  "created_at, updated_at, started_at, completed_at";

export async function getVisualJobs(profileId: string): Promise<VisualJob[]> {
  const client = requireConfiguredClient();
  const { data, error } = await client
    .from("try_on_jobs")
    .select(JOB_COLUMNS)
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false });

  if (error) {
    if (isSchemaUnavailable(error)) throw new VisualStudioUnavailableError();
    throw new Error(error.message || "Unable to load Visual Studio jobs.");
  }
  return (data ?? []) as unknown as VisualJob[];
}

export async function getVisualJobAssets(jobId: string): Promise<VisualJobAsset[]> {
  const client = requireConfiguredClient();
  const { data, error } = await client
    .from("visual_job_assets")
    .select("id, job_id, asset_role, source_product_image_id, storage_object_path, source_url, created_at")
    .eq("job_id", jobId)
    .order("created_at", { ascending: true });

  if (error) {
    if (isSchemaUnavailable(error)) throw new VisualStudioUnavailableError();
    throw new Error(error.message || "Unable to load Visual Studio assets.");
  }
  return (data ?? []) as VisualJobAsset[];
}

export async function createVisualJob(input: {
  workflow: VisualWorkflow;
  product: Product;
  sourceMedia: ProductMediaAsset;
  avatar: CustomerAvatar;
  constraints?: Record<string, unknown>;
}): Promise<VisualJob> {
  const client = requireConfiguredClient();
  const { data, error } = await client.rpc("create_visual_job", {
    p_workflow: input.workflow,
    p_product_id: input.product.id,
    p_avatar_id: input.avatar.id,
    p_source_product_image_id: input.sourceMedia.id,
    p_request_key: crypto.randomUUID(),
    p_constraints: input.constraints ?? {},
  });

  if (error) {
    if (isSchemaUnavailable(error)) throw new VisualStudioUnavailableError();
    throw new Error(error.message || "Unable to queue a Visual Studio job.");
  }
  return data as VisualJob;
}

// ---------------------------------------------------------------------------
// Job lifecycle
// ---------------------------------------------------------------------------

/** A job is still moving and the workspace should keep observing it. */
export function isVisualJobActive(job: VisualJob): boolean {
  return job.status === "queued" || job.status === "processing";
}

/** Only a failed or canceled job may be retried. */
export function canRetryVisualJob(job: VisualJob): boolean {
  return job.status === "failed" || job.status === "canceled";
}

/** A queued or failed job can be stopped; a running one is left to the worker. */
export function canCancelVisualJob(job: VisualJob): boolean {
  return job.status === "queued" || job.status === "failed";
}

async function callJobLifecycle(
  rpc: "cancel_visual_job" | "retry_visual_job",
  jobId: string
): Promise<VisualJob> {
  const client = requireConfiguredClient();
  const { data, error } = await client.rpc(rpc, { p_job_id: jobId });

  if (error) {
    if (isSchemaUnavailable(error)) throw new VisualStudioUnavailableError();
    throw new Error(error.message || "Unable to update this Visual Studio job.");
  }
  return data as VisualJob;
}

export function cancelVisualJob(jobId: string): Promise<VisualJob> {
  return callJobLifecycle("cancel_visual_job", jobId);
}

export function retryVisualJob(jobId: string): Promise<VisualJob> {
  return callJobLifecycle("retry_visual_job", jobId);
}

// ---------------------------------------------------------------------------
// Wardrobe — the customer's saved product/media pairings
// ---------------------------------------------------------------------------

export interface WardrobeItem {
  id: string;
  profile_id: string;
  product_id: string;
  source_product_image_id: string | null;
  label: string | null;
  created_at: string;
  updated_at: string;
}

export async function getWardrobeItems(profileId: string): Promise<WardrobeItem[]> {
  const client = requireConfiguredClient();
  const { data, error } = await client
    .from("visual_wardrobe_items")
    .select("id, profile_id, product_id, source_product_image_id, label, created_at, updated_at")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false });

  if (error) {
    if (isSchemaUnavailable(error)) throw new VisualStudioUnavailableError();
    throw new Error(error.message || "Unable to load your wardrobe.");
  }
  return (data ?? []) as WardrobeItem[];
}

/**
 * Saves a product/media pairing to the wardrobe via the `save_wardrobe_item` RPC,
 * which derives the owner from `auth.uid()` and updates the existing row when the
 * same pairing is saved again. Tapping "save" twice is therefore harmless.
 */
export async function saveWardrobeItem(input: {
  productId: string;
  sourceProductImageId?: string | null;
  label?: string | null;
}): Promise<WardrobeItem> {
  const client = requireConfiguredClient();
  const { data, error } = await client.rpc("save_wardrobe_item", {
    p_product_id: input.productId,
    p_source_product_image_id: input.sourceProductImageId ?? null,
    p_label: input.label?.trim() || null,
  });

  if (error) {
    if (isSchemaUnavailable(error)) throw new VisualStudioUnavailableError();
    throw new Error(error.message || "Unable to save to your wardrobe.");
  }
  return data as WardrobeItem;
}

export async function removeWardrobeItem(itemId: string): Promise<void> {
  const client = requireConfiguredClient();
  const { error } = await client
    .from("visual_wardrobe_items")
    .delete()
    .eq("id", itemId);

  if (error) {
    if (isSchemaUnavailable(error)) throw new VisualStudioUnavailableError();
    throw new Error(error.message || "Unable to remove that wardrobe item.");
  }
}
