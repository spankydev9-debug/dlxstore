import { NextResponse } from "next/server";

import { describeDispatchReadiness } from "../../../../services/messaging/dispatcher";

export const dynamic = "force-dynamic";

/**
 * Public, non-sensitive capability signal for the messaging workspace.
 *
 * Only booleans and variable *names* cross this boundary — never a token, never a
 * template value, never a recipient address. Safe to poll from any page.
 */
export async function GET() {
  const readiness = describeDispatchReadiness();

  return NextResponse.json({
    ...readiness,
    // `in_app_only` is a working state: transactional notifications deliver
    // natively and external channels record an honest failure instead of
    // disappearing. The client renders the missing configuration from
    // `requiredEnvironment` rather than being told "something went wrong".
  });
}
