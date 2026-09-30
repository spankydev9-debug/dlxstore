import { NextResponse } from "next/server";
import {
  getVisualGenerationProvider,
  VisualProviderNotConfiguredError,
} from "../../../../services/visual-studio/provider";

export const dynamic = "force-dynamic";

/**
 * Public, non-sensitive capability signal for the client workspace.
 * Provider credentials and provider-specific details never leave the server.
 */
export async function GET() {
  try {
    getVisualGenerationProvider();
    return NextResponse.json({ available: true });
  } catch (error) {
    if (error instanceof VisualProviderNotConfiguredError) {
      return NextResponse.json({ available: false, reason: "provider_not_configured" });
    }
    return NextResponse.json(
      { available: false, reason: "provider_unavailable" },
      { status: 503 }
    );
  }
}
