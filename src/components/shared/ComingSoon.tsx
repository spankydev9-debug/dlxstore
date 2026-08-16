"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Building2 } from "lucide-react";
import { StoreSettings } from "../../types";
import { useLanguage } from "../../context/LanguageContext";

function remaining(start: string | null): string {
  if (!start) return "";
  const delta = Math.max(0, new Date(start).getTime() - Date.now());
  const days = Math.floor(delta / 86_400_000); const hours = Math.floor((delta / 3_600_000) % 24); const minutes = Math.floor((delta / 60_000) % 60); const seconds = Math.floor((delta / 1_000) % 60);
  return `${days}j ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
}

export function ComingSoon({ settings }: { settings: StoreSettings }) {
  const { t } = useLanguage();
  const [countdown, setCountdown] = useState(() => remaining(settings.launch.starts_at));
  useEffect(() => { const timer = window.setInterval(() => setCountdown(remaining(settings.launch.starts_at)), 1000); return () => window.clearInterval(timer); }, [settings.launch.starts_at]);
  return <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-white">
    <section className="relative w-full max-w-3xl overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center shadow-2xl sm:p-16">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(212,175,55,.22),transparent_46%)]" />
      <div className="relative space-y-8">
        <p className="text-xs font-semibold tracking-[.32em] text-[#d4af37]">DLXSTORE</p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">{t.launchTitle}</h1>
        <p className="mx-auto max-w-xl text-base leading-relaxed text-neutral-300">{settings.launch.announcement || t.launchBody}</p>
        {countdown && <p aria-live="polite" className="font-mono text-2xl tracking-wider text-[#f3e5ab] sm:text-4xl">{countdown}</p>}
        {!settings.launch.starts_at && <p className="text-sm text-neutral-400">La date de lancement sera annoncée prochainement.</p>}
        <div className="flex flex-col justify-center gap-3 sm:flex-row">
          <Link href="/partner" className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-black"><Building2 className="h-4 w-4" />{t.partner}</Link>
          <a href="#updates" className="inline-flex items-center justify-center gap-2 rounded-full border border-white/20 px-5 py-3 text-sm font-semibold">Suivre le lancement <ArrowRight className="h-4 w-4" /></a>
        </div>
      </div>
    </section>
  </main>;
}
