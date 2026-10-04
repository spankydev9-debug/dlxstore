import { NextResponse } from "next/server";

import {
  isMissingSchemaError,
  requireCaller,
  UserScopeAuthError,
} from "../../../../services/server/user-scope";

export const dynamic = "force-dynamic";

const E164 = /^\+[1-9]\d{7,14}$/;
// Deliberately loose: this guards typos, it does not adjudicate deliverability.
// Only the provider can say whether a mailbox exists, and claiming otherwise
// here would reject valid addresses. `EMAIL_NO_DOT` is rejected because an
// address with no dot cannot have a deliverable domain.
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const CHANNELS = new Set(["in_app", "whatsapp", "email"]);

type TestBody = {
  channel?: string;
  address?: string | null;
  templateKey?: string;
};

/**
 * Queues an admin test message to a destination the admin types in.
 *
 * This is the one path where an arbitrary destination is legitimate, so it is
 * admin-gated in SQL and `is_admin()` is re-checked by `queue_message`. The
 * message is non-transactional and therefore still consent-checked: with no
 * WhatsApp opt-in the row is recorded as `skipped`, which is the truthful result
 * rather than a silent no-op.
 */
export async function POST(request: Request) {
  let caller: Awaited<ReturnType<typeof requireCaller>>;
  try {
    caller = await requireCaller(request);
  } catch (error) {
    if (error instanceof UserScopeAuthError) {
      return NextResponse.json({ error: "unauthorized", reason: error.reason }, { status: 401 });
    }
    return NextResponse.json({ error: "server_not_configured" }, { status: 503 });
  }

  let body: TestBody;
  try {
    body = (await request.json()) as TestBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const channel = String(body.channel ?? "").trim();
  const templateKey = String(body.templateKey ?? "campaign.whatsapp").trim();
  const address = body.address === null || body.address === undefined
    ? null
    : String(body.address).trim();

  if (!CHANNELS.has(channel)) {
    return NextResponse.json({ error: "invalid_channel" }, { status: 400 });
  }

  // in_app needs no destination. WhatsApp is E.164; email is not, and applying
  // E.164 to it rejected every legitimate mailbox.
  if (channel === "in_app") {
    if (address !== null) {
      return NextResponse.json({ error: "unexpected_address" }, { status: 400 });
    }
  } else if (address === null || address === "") {
    return NextResponse.json({ error: "missing_address" }, { status: 400 });
  } else if (channel === "whatsapp" && !E164.test(address)) {
    return NextResponse.json({ error: "invalid_address", expected: "e164" }, { status: 400 });
  } else if (channel === "email" && !EMAIL.test(address)) {
    return NextResponse.json({ error: "invalid_address", expected: "email" }, { status: 400 });
  }

  const { data, error } = await caller.client.rpc("admin_enqueue_test_message", {
    p_channel: channel,
    p_address: channel === "in_app" ? null : address,
    p_template_key: templateKey,
  });

  if (error) {
    if (/Admin access required/.test(error.message)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (isMissingSchemaError(error)) {
      return NextResponse.json(
        { error: "schema_unavailable", detail: "Communication migration is not applied." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "rejected", detail: error.message }, { status: 400 });
  }

  return NextResponse.json(
    { queued: Boolean(data), outboxId: data ?? null },
    { status: 202 }
  );
}
