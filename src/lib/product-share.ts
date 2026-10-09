const PREFIX = "[[dlx-product:";
const SUFFIX = "]]";

export function encodeProductShareMessage(slug: string, name: string) {
  return `${PREFIX}${slug}${SUFFIX}\n${name}`;
}

export function parseProductShareSlug(body: string | null | undefined): string | null {
  if (!body) return null;
  const start = body.indexOf(PREFIX);
  if (start !== 0) return null;
  const end = body.indexOf(SUFFIX, PREFIX.length);
  if (end <= PREFIX.length) return null;
  const slug = body.slice(PREFIX.length, end).trim();
  return slug || null;
}

/** A product-card message fully decoded into its parts, or null if not a card. */
export interface ParsedProductShare {
  slug: string;
  /** The name the sender included (a fallback if the live fetch fails). */
  name: string | null;
  /** Any free-text note the sender added after the product name. */
  note: string | null;
}

/**
 * Decode a product-card message body.
 *
 * The body is `[[dlx-product:<slug>]]\n<name>` with an optional `\n<note>`. The
 * slug is authoritative — the sender-supplied name is only a display fallback
 * for when the live catalogue lookup fails, so navigation always uses the slug.
 */
export function parseProductShareMessage(body: string | null | undefined): ParsedProductShare | null {
  if (!body) return null;
  const start = body.indexOf(PREFIX);
  if (start !== 0) return null;
  const end = body.indexOf(SUFFIX, PREFIX.length);
  if (end <= PREFIX.length) return null;
  const slug = body.slice(PREFIX.length, end).trim();
  if (!slug) return null;
  const rest = body.slice(end + SUFFIX.length).replace(/^\n/, "");
  const lines = rest.split("\n");
  const name = lines[0]?.trim() || null;
  const note = lines.slice(1).join("\n").trim() || null;
  return { slug, name, note };
}

/**
 * A human preview for a conversation list. Returns null for a normal message so
 * callers can fall back to the raw body — the raw `[[dlx-product:…]]` token must
 * never leak into an inbox preview.
 */
export function productSharePreview(body: string | null | undefined): string | null {
  const parsed = parseProductShareMessage(body);
  if (!parsed) return null;
  return parsed.name ? `📦 ${parsed.name}` : "📦";
}

export async function visualIdempotencyKey(parts: string[]): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join("|")));
  const bytes = Array.from(new Uint8Array(digest).slice(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
