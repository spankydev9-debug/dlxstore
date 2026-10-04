"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { Language, languages, translate } from "../lib/i18n";
import { setMyMessageLocale } from "../services/db/messaging";

const LANGUAGE_STORAGE_KEY = "dlxstore_language";
const LANGUAGE_CHANGE_EVENT = "dlxstore-language-change";
const defaultLanguage: Language = "fr";

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: ReturnType<typeof translate>;
  ready: boolean;
  hasSelectedLanguage: boolean;
};
const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

function isLanguage(value: string | null): value is Language {
  return value !== null && languages.some((language) => language.code === value);
}

function subscribe(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(LANGUAGE_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(LANGUAGE_CHANGE_EVENT, onStoreChange);
  };
}

function getStoredLanguage(): Language {
  const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return isLanguage(stored) ? stored : defaultLanguage;
}

function getHasSelectedLanguage() {
  return isLanguage(window.localStorage.getItem(LANGUAGE_STORAGE_KEY));
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const language = useSyncExternalStore(subscribe, getStoredLanguage, () => defaultLanguage);
  const hasSelectedLanguage = useSyncExternalStore(subscribe, getHasSelectedLanguage, () => false);
  const ready = useSyncExternalStore(() => () => undefined, () => true, () => false);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback((next: Language) => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    window.dispatchEvent(new Event(LANGUAGE_CHANGE_EVENT));

    // Best-effort mirror onto `profiles.preferred_locale` so order confirmations
    // arrive in the language the customer actually picked.
    //
    // This is deliberately fire-and-forget and never allowed to reject:
    // localStorage stays the single source of truth for the UI, so an anonymous
    // visitor (no session, RPC denies), an offline visitor, or a backend error
    // must not break switching language. The unhandled rejection is swallowed
    // here deliberately -- the user's screen has already changed correctly and
    // the failure is not actionable by them.
    void setMyMessageLocale(next).catch(() => undefined);
  }, []);

  const value = useMemo(() => ({
    language,
    setLanguage,
    t: translate(language),
    ready,
    hasSelectedLanguage,
  }), [hasSelectedLanguage, language, ready, setLanguage]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
export function useLanguage() { const context = useContext(LanguageContext); if (!context) throw new Error("useLanguage must be used within LanguageProvider"); return context; }
