"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { Truck, ShieldCheck, Smile } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";

export default function AboutPage() {
  const { t } = useLanguage();

  return (
    <div className="mx-auto max-w-4xl py-12 px-4 space-y-16 animate-fade-in">
      
      {/* Hero */}
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-extrabold tracking-tight">{t.aboutTitle}</h1>
        <p className="text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto leading-relaxed">
          {t.aboutDescription}
        </p>
      </div>

      <section className="rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        <h2 className="text-2xl font-bold tracking-tight">{t.aboutFounders}</h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">{t.aboutFoundersDescription}</p>
      </section>

      {/* Grid: Our Mission */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center border-t border-border/40 pt-12">
        <div className="space-y-4">
          <h2 className="text-2xl font-bold tracking-tight">{t.aboutMission}</h2>
          <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
            {t.aboutMissionDescription1}
          </p>
          <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
            {t.aboutMissionDescription2}
          </p>
        </div>
        <div className="relative rounded-2xl overflow-hidden aspect-video border bg-muted">
          <Image 
            src="https://images.unsplash.com/photo-1556740758-90de374c12ad?w=500&auto=format&fit=crop&q=60" 
            alt="E-commerce Goma" 
            fill
            sizes="(max-width: 768px) 100vw, 50vw"
            className="object-cover"
          />
        </div>
      </div>

      {/* Grid: Core Pillars */}
      <div className="space-y-6">
        <h2 className="text-2xl font-bold tracking-tight text-center">{t.aboutCommitments}</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="rounded-2xl border border-border p-6 space-y-3 bg-card shadow-sm text-center">
            <div className="rounded-full bg-primary/10 p-3 text-primary w-fit mx-auto">
              <Truck className="h-6 w-6" />
            </div>
            <h4 className="font-bold text-sm sm:text-base">{t.aboutCommitment1}</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t.aboutCommitment1Desc}
            </p>
          </div>

          <div className="rounded-2xl border border-border p-6 space-y-3 bg-card shadow-sm text-center">
            <div className="rounded-full bg-primary/10 p-3 text-primary w-fit mx-auto">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <h4 className="font-bold text-sm sm:text-base">{t.aboutCommitment2}</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t.aboutCommitment2Desc}
            </p>
          </div>

          <div className="rounded-2xl border border-border p-6 space-y-3 bg-card shadow-sm text-center">
            <div className="rounded-full bg-primary/10 p-3 text-primary w-fit mx-auto">
              <Smile className="h-6 w-6" />
            </div>
            <h4 className="font-bold text-sm sm:text-base">{t.aboutCommitment3}</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t.aboutCommitment3Desc}
            </p>
          </div>
        </div>
      </div>

      {/* CTA Box */}
      <div className="rounded-2xl bg-neutral-950 text-white p-8 text-center space-y-4">
        <h3 className="text-xl sm:text-2xl font-bold">{t.aboutCTATitle}</h3>
        <p className="text-xs text-neutral-300 max-w-sm mx-auto">{t.aboutCTADescription}</p>
        <div className="pt-2">
          <Link
            href="/shop"
            className="inline-flex h-10 items-center justify-center rounded-full bg-white text-black px-6 text-xs font-semibold hover:bg-neutral-100 transition-colors"
          >
            {t.aboutCTAButton}
          </Link>
        </div>
      </div>

    </div>
  );
}
