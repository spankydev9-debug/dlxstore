import { CustomerAvatar, Product, ProductMediaAsset } from "../../types";
import { isDemoMode, isSupabaseConfigured, supabase } from "./index";

export type VisualWorkflow = "try_on" | "product_visualization" | "ghost_mannequin";
export type VisualJobStatus = "queued" | "processing" | "completed" | "failed";

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

export async function getVisualJobs(profileId: string): Promise<VisualJob[]> {
  const client = requireConfiguredClient();
  const { data, error } = await client
    .from("try_on_jobs")
    .select("id, profile_id, product_id, avatar_id, workflow, request_key, status, provider, provider_job_id, source_product_image_id, result_asset_path, result_image_url, approved_product_image_id, error, error_code, created_at, updated_at")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false });

  if (error) {
    if (isSchemaUnavailable(error)) throw new VisualStudioUnavailableError();
    throw new Error(error.message || "Unable to load Visual Studio jobs.");
  }
  return (data ?? []) as VisualJob[];
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
