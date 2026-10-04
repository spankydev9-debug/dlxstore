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

export async function visualIdempotencyKey(parts: string[]): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join("|")));
  const bytes = Array.from(new Uint8Array(digest).slice(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
