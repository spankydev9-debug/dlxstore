"use client";

import { useEffect, useState } from "react";
import { languages } from "../../lib/i18n";
import { useLanguage } from "../../context/LanguageContext";
import { useOverlay } from "../../context/OverlayContext";

/**
 * First-visit language choice.
 *
 * Registered as a first-class primary overlay (`language`): it produces the same
 * history/back/escape behaviour as the Support sheet or the Account & More
 * drawer, and — crucially — opening any other primary outlet REPLACES it. That
 * guarantee matters: an unregistered full-viewport overlay over the menu drawer
 * would silently eat every tap aimed at the drawer beneath it.
 */
export function LanguagePrompt() {
  const { language, setLanguage, ready, hasSelectedLanguage, t } = useLanguage();
  const { activeOverlay, openOverlay, closeOverlay } = useOverlay();
  const [dismissed, setDismissed] = useState(false);

  const visible = ready && activeOverlay === "language" && !hasSelectedLanguage && !dismissed;

  useEffect(() => {
    if (!ready || hasSelectedLanguage || dismissed) return;
    openOverlay("language");
    return () => {
      if (activeOverlay === "language") closeOverlay();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, hasSelectedLanguage, dismissed]);

  if (!visible) return null;

  return (
    <div className="overlay-backdrop">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="language-title"
        className="overlay-panel overlay-panel--auto w-full max-w-md p-6 animate-fade-in"
      >
        <h2 id="language-title" className="text-xl font-bold">{t.chooseLanguage}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t.chooseLanguageBody}</p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          {languages.map((item) => (
            <button
              key={item.code}
              onClick={() => {
                setLanguage(item.code);
                setDismissed(true);
                closeOverlay();
              }}
              className={`rounded-lg border p-3 text-left text-sm font-medium ${
                language === item.code ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}