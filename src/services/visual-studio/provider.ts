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
