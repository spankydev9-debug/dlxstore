/**
 * DLXSTORE canonical site URL.
 *
 * Production MUST define `NEXT_PUBLIC_SITE_URL` (e.g. in the Vercel project
 * environment). The localhost fallback exists only so local builds/tests do
 * not emit the retired `dlxstore.cd` domain. Canonical/sitemap/robots/OG URLs
 * are derived from this value everywhere.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") || "http://localhost:3000";

export const SITE_NAME = "DLXSTORE";
export const SITE_TAGLINE = "Digital marketplace for the DRC";

export function absoluteUrl(path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${SITE_URL}${clean}`;
}