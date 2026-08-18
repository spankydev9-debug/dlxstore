"use client";

import { languages } from "../../lib/i18n";
import { useLanguage } from "../../context/LanguageContext";
import { Globe } from "lucide-react";

export function LanguageSwitcher() {
  const { language, setLanguage, t } = useLanguage();
  return (
    <label className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-background/50 px-2.5 py-1.5 text-xs font-semibold text-foreground">
      <Globe className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      <span className="sr-only">{t.language}</span>
      <select
        aria-label={t.language}
        value={language}
        onChange={(event) => setLanguage(event.target.value as typeof language)}
        className="bg-transparent text-xs font-semibold outline-none cursor-pointer"
      >
        {languages.map((item) => (
          <option key={item.code} value={item.code}>{item.label}</option>
        ))}
      </select>
    </label>
  );
}
