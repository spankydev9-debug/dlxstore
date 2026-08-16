"use client";

import { languages } from "../../lib/i18n";
import { useLanguage } from "../../context/LanguageContext";

export function LanguageSwitcher() {
  const { language, setLanguage, t } = useLanguage();
  return <label className="sr-only">
    {t.language}
    <select aria-label={t.language} value={language} onChange={(event) => setLanguage(event.target.value as typeof language)} className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground">
      {languages.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
    </select>
  </label>;
}
