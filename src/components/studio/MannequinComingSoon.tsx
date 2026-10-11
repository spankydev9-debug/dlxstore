"use client";

import Link from "next/link";
import { ArrowLeft, Shirt, Sparkles, Wand2 } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";

/**
 * Customer-facing preview for the mannequin atelier while the personal
 * mannequin + AI virtual try-on experience is finalised.
 *
 * The full workspace still exists behind `MannequinStudio`; this screen only
 * replaces what customers see so nothing unfinished is presented as working.
 */
export function MannequinComingSoon() {
  const { t } = useLanguage();

  const teasers = [
    { icon: Shirt, label: t.wardrobe },
    { icon: Sparkles, label: t.outfit },
    { icon: Wand2, label: t.looks },
  ];

  return (
    <main className="relative flex min-h-[100dvh] w-full flex-col overflow-hidden bg-[#050506] text-white">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 32%, rgba(212,175,55,0.16), rgba(5,5,6,0) 62%)",
        }}
      />

      <header className="relative z-20 mx-auto flex max-w-[1500px] items-center justify-between gap-3 px-3 pt-3 lg:px-6 lg:pt-5 xl:px-10">
        <Link
          href="/shop"
          className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-black/25 px-2.5 text-[11px] font-medium text-white/70 transition-colors hover:border-[#d4af37]/40 hover:text-white lg:min-h-11 lg:px-3.5 lg:text-xs"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden max-w-[11rem] truncate sm:inline">{t.backToShop}</span>
        </Link>

        <div className="pointer-events-none shrink-0 text-center">
          <p className="text-[9px] font-semibold uppercase leading-none tracking-[0.46em] text-[#d4af37]/60">
            DLX
          </p>
          <hr className="dlx-gold-rule mx-auto mb-1" style={{ width: 44 }} />
          <p className="font-serif text-xl italic leading-none text-[#f2e8cf] lg:text-2xl">
            {t.atelier}
          </p>
        </div>

        <span className="w-10 shrink-0 lg:w-16" aria-hidden />
      </header>

      <section className="relative z-10 mx-auto flex w-full max-w-[620px] flex-1 flex-col items-center justify-center px-5 py-10 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#d4af37]/30 bg-[#d4af37]/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#f0dfae]">
          <Sparkles className="h-3 w-3" aria-hidden />
          {t.studioComingSoonBadge}
        </span>

        <div
          aria-hidden
          className="relative mt-8 flex h-40 w-40 items-center justify-center rounded-full border border-[#d4af37]/25 bg-gradient-to-b from-white/[0.06] to-transparent"
        >
          <div className="absolute inset-0 rounded-full bg-[#d4af37]/10 blur-2xl" />
          <Shirt className="relative h-16 w-16 text-[#d4af37]" />
        </div>

        <h1 className="mt-8 font-serif text-2xl italic leading-tight text-[#f2e8cf] sm:text-3xl">
          {t.studioComingSoonTitle}
        </h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-white/60">
          {t.studioComingSoonBody}
        </p>

        <div className="mt-8 grid w-full grid-cols-3 gap-2.5">
          {teasers.map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="flex flex-col items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-2 py-4"
            >
              <Icon className="h-5 w-5 text-[#d4af37]" aria-hidden />
              <span className="text-[11px] font-medium text-white/70">{label}</span>
            </div>
          ))}
        </div>

        <Link
          href="/shop"
          className="mt-9 inline-flex min-h-11 items-center justify-center rounded-xl bg-gradient-to-b from-[#e6c65a] to-[#c39c22] px-6 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90"
        >
          {t.backToShop}
        </Link>
      </section>
    </main>
  );
}
