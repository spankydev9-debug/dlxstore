"use client";

import { useState } from "react";
import { languages } from "../../lib/i18n";
import { useLanguage } from "../../context/LanguageContext";

export function LanguagePrompt() {
  const { language, setLanguage, ready } = useLanguage();
  const [dismissed, setDismissed] = useState(false);
  if (!ready || dismissed || window.localStorage.getItem("dlxstore_language")) return null;
  return <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-4 sm:items-center"><section role="dialog" aria-modal="true" aria-labelledby="language-title" className="w-full max-w-md rounded-2xl bg-card p-6 shadow-2xl"><h2 id="language-title" className="text-xl font-bold">Choose your language</h2><p className="mt-2 text-sm text-muted-foreground">Sélectionnez votre langue pour DLXSTORE.</p><div className="mt-5 grid grid-cols-2 gap-2">{languages.map((item) => <button key={item.code} onClick={() => { setLanguage(item.code); setDismissed(true); }} className={`rounded-lg border p-3 text-left text-sm font-medium ${language === item.code ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}>{item.label}</button>)}</div></section></div>;
}
