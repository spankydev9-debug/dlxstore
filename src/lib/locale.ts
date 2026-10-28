import { languages, type Language } from "./i18n";

/**
 * Cookie that mirrors the customer's chosen locale so a **server** component can
 * emit locale-correct metadata (structured data, breadcrumb labels) in the HTML
 * a crawler receives without running JavaScript.
 *
 * `localStorage` stays the single source of truth for the UI (see
 * `LanguageContext`); this cookie is a best-effort mirror written on the same
 * change, never read on the client. Before a customer has ever chosen a language
 * there is no cookie, and we fall back to the storefront default (`fr`) —
 * crawlers, which send no cookie, therefore always see that default.
 *
 * This module is client-safe (no `next/headers`); the server-side reader lives
 * in `locale-server.ts` so importing the constant never pulls server-only code
 * into the browser bundle.
 */
export const LOCALE_COOKIE = "dlxstore_language";

export const DEFAULT_LANGUAGE: Language = "fr";

export function isLanguage(value: string | null | undefined): value is Language {
  return typeof value === "string" && languages.some((language) => language.code === value);
}
