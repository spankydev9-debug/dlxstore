import "server-only";

/**
 * Provider boundary for outbound messaging (P13).
 *
 * Two very different delivery paths exist and they are deliberately kept apart:
 *
 *  - `in_app` is native. Delivering it means writing one row to the existing P9
 *    `notifications` table through the `deliver_in_app_message` RPC. It needs no
 *    credential, no network call, and cannot fail for external reasons, so it is
 *    always available.
 *
 *  - `whatsapp` and `email` are external. They are sent through a
 *    `MessagingProvider` and every one of them is gated on server-side
 *    configuration. When configuration is missing the caller gets a
 *    `NotConfigured` outcome; no adapter ever invents a delivery receipt.
 *
 * The most important rule in this file: a row only becomes `sent` when a provider
 * reports a real success. A transport error, a rejected payload, or a missing
 * credential all produce a failure that is recorded against the row, so the admin
 * outbox always reflects reality.
 *
 * WhatsApp note: Meta only permits free-form text inside a 24-hour customer
 * service window. Business-initiated order messages therefore need a template that
 * Meta has approved. Set `DLX_WHATSAPP_TEMPLATE_<TEMPLATE_KEY>` (upper snake case,
 * e.g. `DLX_WHATSAPP_TEMPLATE_ORDER_CONFIRMATION`) to the approved template name
 * and the adapter switches to a template payload. Without it the adapter still
 * sends text and Meta decides: a rejection is reported honestly as a failure
 * rather than being swallowed.
 */

export type ExternalChannel = "whatsapp" | "email";
export type DeliverableChannel = "in_app" | ExternalChannel;

export const EXTERNAL_CHANNELS: readonly ExternalChannel[] = ["whatsapp", "email"];

export type OutgoingMessage = {
  outboxId: string;
  channel: DeliverableChannel;
  /** Resolved destination. Never a customer-supplied address. */
  to: string;
  subject: string | null;
  body: string;
  locale: string;
  templateKey: string;
  isTransactional: boolean;
};

export type DeliveryOutcome =
  | { ok: true; provider: string; providerMessageId: string }
  | {
      ok: false;
      provider: string;
      error: string;
      /**
       * Permanent failures are not retried. Meta's own error codes tell us which:
       * an invalid number or an unapproved template will never succeed on a retry,
       * whereas a 429 or a 5xx is worth another attempt.
       */
      permanent: boolean;
    };

export interface MessagingProvider {
  readonly name: string;
  send(message: OutgoingMessage): Promise<DeliveryOutcome>;
}

export class MessagingProviderNotConfiguredError extends Error {
  readonly channel: ExternalChannel;

  constructor(channel: ExternalChannel) {
    super(`No messaging provider is configured for ${channel}.`);
    this.name = "MessagingProviderNotConfiguredError";
    this.channel = channel;
  }
}

// ---------------------------------------------------------------------------
// WhatsApp Cloud API adapter
// ---------------------------------------------------------------------------

const WHATSAPP_GRAPH_VERSION = process.env.DLX_WHATSAPP_GRAPH_VERSION?.trim() || "v21.0";
const WHATSAPP_TOKEN = process.env.DLX_WHATSAPP_ACCESS_TOKEN?.trim();
const WHATSAPP_PHONE_NUMBER_ID = process.env.DLX_WHATSAPP_PHONE_NUMBER_ID?.trim();

/** Meta error codes that cannot be fixed by resending the same payload. */
const WHATSAPP_PERMANENT_CODES = new Set([
  100, // invalid parameter
  131, // message content undeliverable
  132, // template does not exist
  133, // template hydration failed
  135, // not a registered template
]);

/**
 * Maps `order.confirmation` to `ORDER_CONFIRMATION`, the suffix convention used
 * by the documented `DLX_WHATSAPP_TEMPLATE_*` variables.
 */
function approvedTemplateFor(templateKey: string): string | null {
  const suffix = templateKey.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase();
  const name = process.env[`DLX_WHATSAPP_TEMPLATE_${suffix}`]?.trim();
  return name ? name : null;
}

const whatsappProvider: MessagingProvider = {
  name: "meta_whatsapp_cloud",

  async send(message: OutgoingMessage): Promise<DeliveryOutcome> {
    if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
      return {
        ok: false,
        provider: "meta_whatsapp_cloud",
        error: "WhatsApp credentials are not configured on the server.",
        permanent: true,
      };
    }

    const template = approvedTemplateFor(message.templateKey);

    // A language tag lets Meta pick the customer's approved translation. The
    // supported codes are the template's, not ours, so an unknown locale simply
    // falls back to the default language rather than failing the send.
    const text =
      template === null
        ? { messaging_product: "whatsapp", to: message.to, text: { body: message.body } }
        : {
            messaging_product: "whatsapp",
            to: message.to,
            type: "template",
            template: {
              name: template,
              language: { code: message.locale },
            },
          };

    try {
      const response = await fetch(
        `https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${WHATSAPP_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(text),
        }
      );

      const payload = (await response.json().catch(() => null)) as {
        messages?: { id?: string }[];
        error?: { message?: string; code?: number; error_data?: { details?: string } };
      } | null;

      const messageId = payload?.messages?.[0]?.id;

      if (response.ok && messageId) {
        return { ok: true, provider: "meta_whatsapp_cloud", providerMessageId: messageId };
      }

      const code = payload?.error?.code;
      const detail =
        payload?.error?.error_data?.details || payload?.error?.message || response.statusText;

      return {
        ok: false,
        provider: "meta_whatsapp_cloud",
        error: typeof code === "number" ? `${code}: ${detail}` : String(detail),
        permanent: typeof code === "number" ? WHATSAPP_PERMANENT_CODES.has(code) : false,
      };
    } catch (error) {
      // Network-level failure: worth retrying, because the message may never have
      // reached Meta at all.
      return {
        ok: false,
        provider: "meta_whatsapp_cloud",
        error: error instanceof Error ? error.message : "Unreachable WhatsApp API.",
        permanent: false,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Provider resolution
// ---------------------------------------------------------------------------

export function isExternalChannel(channel: DeliverableChannel): channel is ExternalChannel {
  return channel !== "in_app";
}

const PROVIDERS: Partial<Record<ExternalChannel, MessagingProvider>> = {
  whatsapp: whatsappProvider,
};

export function getMessagingProvider(channel: DeliverableChannel): MessagingProvider | null {
  if (!isExternalChannel(channel)) return null;
  return PROVIDERS[channel] ?? null;
}

// ---------------------------------------------------------------------------
// Capability probing
// ---------------------------------------------------------------------------

export type ChannelReadiness = "ready" | "unconfigured";

export type MessagingCapability = {
  /** True when at least one external channel can actually send. */
  available: boolean;
  /** The native notification channel needs no provider and is always usable. */
  inAppAvailable: true;
  channels: Record<DeliverableChannel, ChannelReadiness>;
  providerNamePresent: boolean;
  credentialPresent: boolean;
  /** Approved Meta template mappings are required for business-initiated sends. */
  templatesConfigured: boolean;
  reason: "ready" | "in_app_only" | "provider_not_configured";
  /** Exact server-only variables still missing, as names only. */
  requiredEnvironment: string[];
};

/**
 * Reads configuration only. No network call and no credential value leaves the
 * server, so this is safe to answer on every status request.
 */
export function describeMessagingProviderCapability(): MessagingCapability {
  const whatsappReady = Boolean(WHATSAPP_TOKEN && WHATSAPP_PHONE_NUMBER_ID);
  const providerNamePresent = whatsappReady;
  const credentialPresent = whatsappReady;
  const templatesConfigured = approvedTemplateFor("order.confirmation") !== null;

  const requiredEnvironment: string[] = [];
  if (!WHATSAPP_TOKEN) requiredEnvironment.push("DLX_WHATSAPP_ACCESS_TOKEN");
  if (!WHATSAPP_PHONE_NUMBER_ID) {
    requiredEnvironment.push("DLX_WHATSAPP_PHONE_NUMBER_ID");
  }
  if (whatsappReady && !templatesConfigured) {
    // Not fatal: transactional sends inside a 24h window work without a template.
    requiredEnvironment.push("DLX_WHATSAPP_TEMPLATE_ORDER_CONFIRMATION");
  }

  return {
    available: whatsappReady,
    inAppAvailable: true,
    channels: {
      in_app: "ready",
      whatsapp: whatsappReady ? "ready" : "unconfigured",
      email: "unconfigured",
    },
    providerNamePresent,
    credentialPresent,
    templatesConfigured,
    reason: whatsappReady ? "ready" : "in_app_only",
    requiredEnvironment,
  };
}
