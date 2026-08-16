"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { Language, translate } from "../lib/i18n";

type LanguageContextValue = { language: Language; setLanguage: (language: Language) => void; t: ReturnType<typeof translate>; ready: boolean };
const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>("fr");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const saved = window.localStorage.getItem("dlxstore_language") as Language | null;
    if (saved && ["fr", "en", "sw", "ln", "kg", "lu"].includes(saved)) setLanguageState(saved);
    setReady(true);
  }, []);
  const setLanguage = (next: Language) => { window.localStorage.setItem("dlxstore_language", next); setLanguageState(next); };
  return <LanguageContext.Provider value={{ language, setLanguage, t: translate(language), ready }}>{children}</LanguageContext.Provider>;
}
export function useLanguage() { const context = useContext(LanguageContext); if (!context) throw new Error("useLanguage must be used within LanguageProvider"); return context; }
