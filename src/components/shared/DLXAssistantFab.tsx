"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, X } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { useOverlay } from "../../context/OverlayContext";
import { ShoppingAssistantPanel } from "../account/ShoppingAssistantPanel";
import { usePathname } from "next/navigation";

export function DLXAssistantFab() {
  const { t } = useLanguage();
  const { activeOverlay, openOverlay, closeOverlay } = useOverlay();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const open = activeOverlay === "assistant";

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleToggle = useCallback(() => {
    if (open) closeOverlay();
    else openOverlay("assistant");
  }, [open, closeOverlay, openOverlay]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        closeOverlay();
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeOverlay();
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, closeOverlay]);

  // Hide on auth pages or when chat overlay is open? but assistant is separate
  if (!mounted) return null;

  // Hide on very narrow mobile when tab bar might compete? keep visible but respect safe area
  return (
    <>
      {open && (
        <div
          ref={panelRef}
          className="fixed bottom-[calc(5.5rem+var(--safe-bottom))] right-3 z-50 w-[calc(100vw-1.5rem)] max-w-[360px] md:right-6 md:bottom-[calc(6rem+var(--safe-bottom))] md:w-[380px]"
          style={{ maxHeight: "calc(100vh - 10rem)" }}
        >
          <div className="rounded-2xl border border-border/60 bg-card/95 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.9)] backdrop-blur-2xl ring-1 ring-black/5 dark:ring-white/5">
            <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Bot className="h-4 w-4" />
                </span>
                <span className="text-sm font-semibold">{t.assistantTitle}</span>
              </div>
              <button
                type="button"
                onClick={closeOverlay}
                className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted"
                aria-label={t.assistantFloatingClose}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[calc(100vh-16rem)] overflow-y-auto p-3">
              <ShoppingAssistantPanel />
            </div>
          </div>
        </div>
      )}
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        aria-expanded={open}
        aria-label={open ? t.assistantFloatingClose : t.assistantFloatingOpen}
        title={open ? t.assistantFloatingClose : t.assistantFloatingHint}
        className="fixed bottom-[calc(4.25rem+var(--safe-bottom))] right-3 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-b from-[#e6c65a] to-[#c39c22] text-black shadow-[0_20px_50px_-15px_rgba(212,175,55,0.95)] ring-2 ring-black/10 transition-transform hover:scale-105 active:scale-95 md:bottom-[calc(5rem+var(--safe-bottom))] md:right-6"
      >
        <Bot className="h-5 w-5" />
      </button>
    </>
  );
}
