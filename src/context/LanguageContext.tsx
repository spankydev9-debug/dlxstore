"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { Language, languages, translate } from "../lib/i18n";

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
