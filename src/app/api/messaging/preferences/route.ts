import { NextResponse } from "next/server";

import {
  isMissingSchemaError,
  requireCaller,
  UserScopeAuthError,
} from "../../../../services/server/user-scope";

export const dynamic = "force-dynamic";

const LOCALES = new Set(["fr", "en", "sw", "ln", "tl", "kg"]);
const CHANNELS = new Set(["whatsapp", "email"]);

type UpdateBody = {
  locale?: string;
  whatsappMarketing?: boolean;
  emailMarketing?: boolean;
};

function unauthorized(error: UserScopeAuthError) {
  return NextResponse.json({ error: "unauthorized", reason: error.reason }, { status: 401 });
}

/**
 * The caller's own communication preferences.
 *
 * Both directions go through the self-service RPCs, which resolve the target
 * from `auth.uid()` and never accept a profile id from the request. That is why
 * there is no way to read or edit somebody else's consent through this route.
 */
export async function GET(request: Request) {
  let caller: Awaited<ReturnType<typeof requireCaller>>;
  try {
    caller = await requireCaller(request);
  } catch (error) {
    if (error instanceof UserScopeAuthError) return unauthorized(error);
    return NextResponse.json({ error: "server_not_configured" }, { status: 503 });
  }

  const { data, error } = await caller.client.rpc("get_my_message_opt_ins");
  if (error) {
    if (isMissingSchemaError(error)) {
      return NextResponse.json(
        { error: "schema_unavailable", detail: "Communication migration is not applied." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "unavailable", detail: error.message }, { status: 400 });
  }

  return NextResponse.json({ preferences: data });
}

export async function PUT(request: Request) {
  let caller: Awaited<ReturnType<typeof requireCaller>>;
  try {
    caller = await requireCaller(request);
  } catch (error) {
    if (error instanceof UserScopeAuthError) return unauthorized(error);
    return NextResponse.json({ error: "server_not_configured" }, { status: 503 });
  }

  let body: UpdateBody;
  try {
    body = (await request.json()) as UpdateBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // Validate everything before writing anything, so a bad request cannot leave a
  // half-applied change behind.
  if (body.locale !== undefined && !LOCALES.has(String(body.locale))) {
    return NextResponse.json({ error: "invalid_locale" }, { status: 400 });
  }
  if (
    body.whatsappMarketing !== undefined &&
    typeof body.whatsappMarketing !== "boolean"
  ) {
    return NextResponse.json({ error: "invalid_flag" }, { status: 400 });
  }
  if (body.emailMarketing !== undefined && typeof body.emailMarketing !== "boolean") {
    return NextResponse.json({ error: "invalid_flag" }, { status: 400 });
  }

  if (body.locale !== undefined) {
    const { error } = await caller.client.rpc("set_my_message_locale", {
      p_locale: String(body.locale),
    });
    if (error) {
      return NextResponse.json({ error: "rejected", detail: error.message }, { status: 400 });
    }
  }

  for (const [flag, field] of [
    [body.whatsappMarketing, "whatsapp"],
    [body.emailMarketing, "email"],
  ] as const) {
    if (flag === undefined) continue;
    if (!CHANNELS.has(field)) continue;
    const { error } = await caller.client.rpc("set_my_message_opt_in", {
      p_channel: field,
      p_enabled: flag,
    });
    if (error) {
      return NextResponse.json({ error: "rejected", detail: error.message }, { status: 400 });
    }
  }

  const { data, error } = await caller.client.rpc("get_my_message_opt_ins");
  if (error) {
    return NextResponse.json({ error: "unavailable", detail: error.message }, { status: 400 });
  }

  return NextResponse.json({ preferences: data });
}
