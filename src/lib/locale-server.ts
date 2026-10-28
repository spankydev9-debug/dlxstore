import { cookies } from "next/headers";
import { isLanguage, LOCALE_COOKIE, DEFAULT_LANGUAGE } from "./locale";
import type { Language } from "./i18n";

/**
 * The active locale for the current request, read from the mirror cookie set by
 * `LanguageContext`. Server-only (uses `next/headers`); the client-safe constant
 * and validation live in `locale.ts`.
 */
export async function getRequestLocale(): Promise<Language> {
  const store = await cookies();
  const value = store.get(LOCALE_COOKIE)?.value ?? null;
  return isLanguage(value) ? value : DEFAULT_LANGUAGE;
}
