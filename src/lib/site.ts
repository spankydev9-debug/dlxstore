/**
 * DLXSTORE canonical site URL.
 *
 * Production must define `NEXT_PUBLIC_SITE_URL` (e.g. in the Vercel project
 * environment, currently `https://dlxstore-flax.vercel.app`). Canonical,
 * sitemap, robots and Open Graph URLs are derived from this value everywhere.
 *
 * Fallbacks (only used when the env var is absent):
 *  - In a production build on Vercel, fall back to VERCEL_PROJECT_PRODUCTION_URL
 *    (the stable production alias, e.g. dlxstore-flax.vercel.app) so deployed
 *    metadata never points at localhost.
 *  - Local dev/tests keep the localhost fallback.
 */
function buildSiteUrl(): string {
  const nextPublic = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");
  if (nextPublic) return nextPublic;

  const isProd = process.env.NODE_ENV === "production";

  // Vercel: the stable production-domain alias (no protocol in the env value).
  const productionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (isProd && productionUrl) {
    return `https://${productionUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  }

  return "http://localhost:3000";
}

export const SITE_NAME = "DLXSTORE";
export const SITE_TAGLINE = "Digital marketplace for the DRC";
export const SITE_URL = buildSiteUrl();

export function absoluteUrl(path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${SITE_URL}${clean}`;
}