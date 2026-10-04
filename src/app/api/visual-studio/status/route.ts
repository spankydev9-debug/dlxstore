import { NextResponse } from "next/server";
import {
  describeVisualProviderCapability,
  getVisualGenerationProvider,
  VISUAL_STUDIO_REQUIRED_ENV,
  VisualProviderNotConfiguredError,
} from "../../../../services/visual-studio/provider";

export const dynamic = "force-dynamic";

/**
 * Public, non-sensitive capability signal for the client workspace.
 * Provider credentials and provider-specific details never leave the server.
 */
export async function GET() {
  const capability = describeVisualProviderCapability();

  // `capability` is spread first so the explicit two-field contract below always
  // wins: `getVisualGenerationProvider()` is the authoritative liveness check, and
  // it will succeed the moment a reviewed adapter is compiled in.
  try {
    getVisualGenerationProvider();
    return NextResponse.json({ ...capability, available: true, reason: "ready" });
  } catch (error) {
    if (error instanceof VisualProviderNotConfiguredError) {
      return NextResponse.json({
        ...capability,
        available: false,
        reason: capability.available ? "ready" : capability.reason,
        requiredEnvironment: VISUAL_STUDIO_REQUIRED_ENV,
      });
    }
    return NextResponse.json(
      { ...capability, available: false, reason: "provider_unavailable" },
      { status: 503 }
    );
  }
}
