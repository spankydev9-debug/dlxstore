import { NextResponse } from "next/server";
import {
  AI_CATALOG_REQUIRED_ENV,
  describeCatalogProviderCapability,
  getCatalogAnalysisProvider,
  CatalogProviderNotConfiguredError,
} from "../../../../services/ai-catalog/provider";

export const dynamic = "force-dynamic";

/**
 * Non-sensitive capability signal for the catalog assistant.
 * Never exposes a provider name, key, or any internal detail.
 */
export async function GET() {
  const capability = describeCatalogProviderCapability();

  try {
    getCatalogAnalysisProvider();
    return NextResponse.json({ ...capability, available: true, reason: "ready" });
  } catch (error) {
    if (error instanceof CatalogProviderNotConfiguredError) {
      return NextResponse.json({
        ...capability,
        available: false,
        reason: capability.available ? "ready" : capability.reason,
        requiredEnvironment: AI_CATALOG_REQUIRED_ENV,
      });
    }
    return NextResponse.json(
      { ...capability, available: false, reason: "provider_unavailable" },
      { status: 503 }
    );
  }
}
