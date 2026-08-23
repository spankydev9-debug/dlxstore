"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, Download, Play, Plus, Share, X } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

/** PWA install UX for the DLXSTORE storefront (no third-party install services). */
export function DownloadApp({ variant = "footer" }: { variant?: "drawer" | "footer" }) {
  const { t } = useLanguage();
  const standaloneMode = useSyncExternalStore(subscribeStandalone, readStandalone, () => false);
  const [installedByPrompt, setInstalledByPrompt] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dialog, setDialog] = useState<"ios" | "fallback" | "tutorial" | null>(null);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDialog(null);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  if (standaloneMode || installedByPrompt) return null;

  const handleClick = async () => {
    if (deferredPrompt) {
      const prompt = deferredPrompt;
      setDeferredPrompt(null);
      try {
        await prompt.prompt();
        const result = await prompt.userChoice;
        if (result.outcome === "accepted") setInstalledByPrompt(true);
      } catch (error) {
        console.warn("[DLXSTORE] The native install prompt could not be shown.", error);
      }
      return;
    }
    setDialog(isIosSafari() ? "ios" : "fallback");
  };

  const handleTutorialClick = () => {
    setDialog("tutorial");
  };

  const isDrawer = variant === "drawer";

  return (
    <>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleTutorialClick}
          aria-label={t.watchTutorial}
          className={
            isDrawer
              ? "flex items-center justify-center gap-2 rounded-full border border-border bg-card py-3 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
              : "inline-flex items-center justify-center gap-2 rounded-full border border-border bg-card px-4 py-3 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          }
        >
          <Play className="h-4 w-4" aria-hidden="true" />
          <span>{t.watchTutorial}</span>
        </button>
        
        <button
          type="button"
          onClick={handleClick}
          aria-label={t.downloadApp}
          className={
            isDrawer
              ? "flex items-center justify-center gap-2 rounded-full bg-primary py-3 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
              : "inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          }
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          <span>{t.downloadApp}</span>
        </button>
      </div>

      {dialog && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="dlx-install-dialog-title"
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-5 backdrop-blur-sm sm:items-center"
        >
          <section className="w-full max-w-lg animate-fade-in rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div className="grid h-11 w-11 place-items-center rounded-full bg-primary/10 text-primary">
                {dialog === "ios" ? (
                  <Share className="h-5 w-5" aria-hidden="true" />
                ) : dialog === "tutorial" ? (
                  <Play className="h-5 w-5" aria-hidden="true" />
                ) : (
                  <Download className="h-5 w-5" aria-hidden="true" />
                )}
              </div>
              <button
                type="button"
                onClick={() => setDialog(null)}
                aria-label={t.installClose}
                className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            {dialog === "tutorial" ? (
              <>
                <h2 id="dlx-install-dialog-title" className="mt-4 text-lg font-bold text-foreground">
                  {t.tutorialTitle}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t.tutorialBody}</p>
                <div className="mt-5 aspect-video w-full overflow-hidden rounded-xl bg-black">
                  <video
                    controls
                    className="h-full w-full object-contain"
                    preload="metadata"
                  >
                    <source src="/dlxstore-tutorial.mov" type="video/mp4" />
                    <source src="/dlxstore-tutorial.mov" type="video/quicktime" />
                    {t.videoNotSupported}
                  </video>
                </div>
              </>
            ) : (
              <>
                <h2 id="dlx-install-dialog-title" className="mt-4 text-lg font-bold text-foreground">
                  {t.installTitle}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t.installBody}</p>
                {dialog === "ios" ? (
                  <ol className="mt-5 space-y-4">
                    {[
                      { icon: Share, label: t.iosStep1 },
                      { icon: Plus, label: t.iosStep2 },
                      { icon: Check, label: t.iosStep3 },
                    ].map((step, index) => (
                      <li key={index} className="flex items-start gap-3 text-sm">
                        <span className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-full bg-muted text-foreground">
                          <step.icon className="h-3.5 w-3.5" aria-hidden="true" />
                        </span>
                        <span className="text-muted-foreground">{step.label}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="mt-5 rounded-xl bg-muted/40 p-4 text-sm leading-relaxed text-muted-foreground">
                    {t.installFallback}
                  </div>
                )}
              </>
            )}

            <button
              type="button"
              onClick={() => setDialog(null)}
              className="mt-6 flex h-11 w-full items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/95"
            >
              {t.installClose}
            </button>
          </section>
        </div>
      )}
    </>
  );
}

function readStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

function subscribeStandalone(onChange: () => void): () => void {
  const mediaQuery = window.matchMedia("(display-mode: standalone)");
  mediaQuery.addEventListener("change", onChange);
  window.addEventListener("appinstalled", onChange);
  return () => {
    mediaQuery.removeEventListener("change", onChange);
    window.removeEventListener("appinstalled", onChange);
  };
}

function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const userAgent = navigator.userAgent;
  const isIPhoneOrIPad = /iPhone|iPad|iPod/.test(userAgent);
  const isIPadOSDesktop = /Macintosh/.test(userAgent) && navigator.maxTouchPoints > 1;
  const isNotChromeFamily = !/CriOS|FxiOS|OPiOS|EdgiOS/.test(userAgent);
  return (isIPhoneOrIPad || isIPadOSDesktop) && isNotChromeFamily;
}