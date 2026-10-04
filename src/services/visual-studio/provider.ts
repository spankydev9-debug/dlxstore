import "server-only";

/**
 * Provider-neutral server boundary for the future Avatar / Visual Studio.
 *
 * This module deliberately has no provider implementation. It prevents a
 * browser bundle from accessing provider credentials and ensures that a UI can
 * surface an honest unavailable state until a provider is selected.
 */
export type VisualWorkflow = "try_on" | "product_visualization" | "ghost_mannequin";

export type VisualJobRequest = {
  jobId: string;
  workflow: VisualWorkflow;
  productId: string;
  sourceProductImageId: string;
  sourceImageUrl: string;
  avatarAttributes?: Record<string, string>;
  constraints: Record<string, unknown>;
};

export type VisualJobSubmission = {
  providerJobId: string;
};

export type VisualJobResult = {
  state: "processing" | "completed" | "failed";
  outputObjectPath?: string;
  errorCode?: string;
  errorMessage?: string;
};

export interface VisualGenerationProvider {
  submit(request: VisualJobRequest): Promise<VisualJobSubmission>;
  getResult(providerJobId: string): Promise<VisualJobResult>;
}

export class VisualProviderNotConfiguredError extends Error {
  constructor() {
    super("DLX Visual Studio is not configured with an image-generation provider.");
    this.name = "VisualProviderNotConfiguredError";
  }
}

/**
 * The eventual implementation must select a reviewed provider using only
 * server-side environment variables such as DLX_VISUAL_AI_PROVIDER and
 * DLX_VISUAL_AI_API_KEY. Never add a NEXT_PUBLIC provider key.
 */
export function getVisualGenerationProvider(): VisualGenerationProvider {
  throw new VisualProviderNotConfiguredError();
}

// ---------------------------------------------------------------------------
// Capability probing
// ---------------------------------------------------------------------------

/**
 * What the server can actually do right now. This is intentionally a
 * description of configuration, never of a simulated result: `available` is only
 * true when a reviewed provider adapter is compiled in, and the flags below say
 * precisely which external dependency is still missing.
 */
export type VisualProviderCapability = {
  /** A reviewed provider adapter is present and can accept a job. */
  available: boolean;
  /** A provider name is configured but no adapter is compiled in yet. */
  providerNamePresent: boolean;
  /** A server-side provider credential is present. */
  credentialPresent: boolean;
  /**
   * A service-role credential is present. Required for copying generated
   * objects out of the private `visual-workspace` bucket and for minting signed
   * result URLs. Intentionally absent today.
   */
  serviceRolePresent: boolean;
  /** Machine-readable reason the capability is not available. */
  reason:
    | "ready"
    | "provider_not_configured"
    | "provider_not_implemented"
    | "service_role_required";
};

const PROVIDER_NAME = process.env.DLX_VISUAL_AI_PROVIDER?.trim();
const PROVIDER_KEY = process.env.DLX_VISUAL_AI_API_KEY?.trim();
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

/**
 * Reads configuration only. No provider SDK is imported and no network call is
 * made, so this is safe to call on every capability request.
 */
export function describeVisualProviderCapability(): VisualProviderCapability {
  const providerNamePresent = Boolean(PROVIDER_NAME);
  const credentialPresent = Boolean(PROVIDER_KEY);
  const serviceRolePresent = Boolean(SERVICE_ROLE_KEY);

  // A reviewed adapter is not compiled in. Until one is, a configured provider
  // name is still reported as unavailable rather than being treated as working.
  const available = false;

  const reason: VisualProviderCapability["reason"] = available
    ? "ready"
    : providerNamePresent || credentialPresent
      ? "provider_not_implemented"
      : "provider_not_configured";

  return {
    available,
    providerNamePresent,
    credentialPresent,
    serviceRolePresent,
    reason,
  };
}

/**
 * Exact server-only environment variables still required before any generation
 * request can succeed. Surfaced to the client as booleans only — never the
 * values, and never the variable contents.
 */
export const VISUAL_STUDIO_REQUIRED_ENV = [
  "DLX_VISUAL_AI_PROVIDER",
  "DLX_VISUAL_AI_API_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;
