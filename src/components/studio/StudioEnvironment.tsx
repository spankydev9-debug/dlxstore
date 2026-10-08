"use client";

import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// DLX Studio environment.
//
// The backdrop for the mannequin: a black void, a warm key light behind the
// figure, a cool fill from the left, a gold floor pool, drifting dust and a
// vignette. Purely decorative and CSS/SVG only — no assets, no images.
// ---------------------------------------------------------------------------

/** Drifting motes. Fixed deterministic positions so SSR and client agree. */
const MOTES = [
  { x: 18, y: 22, r: 1.1, d: 0, dur: 17 },
  { x: 31, y: 61, r: 0.8, d: 2.4, dur: 21 },
  { x: 44, y: 14, r: 1.3, d: 5.1, dur: 19 },
  { x: 57, y: 74, r: 0.9, d: 1.2, dur: 24 },
  { x: 69, y: 33, r: 1.2, d: 3.7, dur: 18 },
  { x: 82, y: 58, r: 0.7, d: 6.5, dur: 22 },
  { x: 24, y: 87, r: 1, d: 4.2, dur: 20 },
  { x: 91, y: 19, r: 0.9, d: 8.1, dur: 25 },
  { x: 11, y: 48, r: 1.2, d: 9.4, dur: 23 },
  { x: 76, y: 92, r: 0.8, d: 7.2, dur: 21 },
];

export function StudioEnvironment() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Base void */}
      <div className="absolute inset-0 bg-[#050506]" />

      {/* Atelier backdrop: a faint cutting grid, the way pattern paper is
          ruled. It fades out at the top and the floor so it reads as texture on
          the wall of the room rather than as a UI overlay. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg, rgba(255,255,255,0.045) 0 1px, rgba(255,255,255,0) 1px 96px), repeating-linear-gradient(0deg, rgba(255,255,255,0.03) 0 1px, rgba(255,255,255,0) 1px 96px)",
          maskImage:
            "linear-gradient(to bottom, rgba(0,0,0,0) 4%, rgba(0,0,0,1) 26%, rgba(0,0,0,1) 62%, rgba(0,0,0,0) 88%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, rgba(0,0,0,0) 4%, rgba(0,0,0,1) 26%, rgba(0,0,0,1) 62%, rgba(0,0,0,0) 88%)",
        }}
      />

      {/* Warm key light directly behind the figure */}
      <div
        className="absolute left-1/2 top-[38%] h-[68vh] w-[min(115vw,860px)] -translate-x-1/2 -translate-y-1/2 rounded-[50%] opacity-90"
        style={{
          background:
            "radial-gradient(closest-side, rgba(212,175,55,0.30), rgba(212,175,55,0.10) 45%, rgba(5,5,6,0) 78%)",
          filter: "blur(14px)",
        }}
      />

      {/* Cool rim from the left, gold rim from the right */}
      <div
        className="absolute -left-[18%] top-[12%] h-[86vh] w-[62vw] rounded-[50%] opacity-70"
        style={{
          background: "radial-gradient(closest-side, rgba(120,150,190,0.20), rgba(5,5,6,0) 72%)",
          filter: "blur(30px)",
        }}
      />
      <div
        className="absolute -right-[16%] top-[26%] h-[78vh] w-[56vw] rounded-[50%] opacity-70"
        style={{
          background: "radial-gradient(closest-side, rgba(212,175,55,0.22), rgba(5,5,6,0) 74%)",
          filter: "blur(30px)",
        }}
      />

      {/* Floor plane + horizon glow */}
      <div className="absolute inset-x-0 bottom-0 h-[34%]">
        {/* The seam where the backdrop meets the floor — the room has a
            horizon, so the figure stands somewhere instead of floating. */}
        <div className="absolute inset-x-[6%] top-0 h-px bg-gradient-to-r from-transparent via-white/[0.16] to-transparent" />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to bottom, rgba(5,5,6,0) 0%, rgba(9,9,11,0.85) 42%, rgba(14,13,10,1) 100%)",
          }}
        />
        <div
          className="absolute inset-x-[12%] bottom-0 h-[46%]"
          style={{
            background:
              "radial-gradient(ellipse at 50% 100%, rgba(212,175,55,0.20), rgba(212,175,55,0.05) 46%, rgba(5,5,6,0) 74%)",
          }}
        />
      </div>

      {/* Drifting motes */}
      <div className="absolute inset-0">
        {MOTES.map((mote) => (
          <span
            key={`${mote.x}-${mote.y}`}
            className="absolute rounded-full bg-[#e8d9a4] opacity-40 motion-safe:animate-[dlx-drift_linear_infinite]"
            style={{
              left: `${mote.x}%`,
              top: `${mote.y}%`,
              width: `${mote.r * 2}px`,
              height: `${mote.r * 2}px`,
              boxShadow: "0 0 6px rgba(212,175,55,0.7)",
              animationDelay: `${mote.d}s`,
              animationDuration: `${mote.dur}s`,
            }}
          />
        ))}
      </div>

      {/* Vignette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 45%, rgba(5,5,6,0) 32%, rgba(5,5,6,0.55) 68%, rgba(3,3,4,0.96) 100%)",
        }}
      />

      {/* Subtle scanline/grain to avoid flat banding on large gradients */}
      <div
        className="absolute inset-0 opacity-[0.16] mix-blend-overlay"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 1px, rgba(0,0,0,0) 1px, rgba(0,0,0,0) 3px)",
        }}
      />
    </div>
  );
}

/** Frosted panel used for every floating control surface in the studio. */
export function StudioPanel({
  children,
  className = "",
  tone = "default",
}: {
  children: ReactNode;
  className?: string;
  tone?: "default" | "quiet" | "accent";
}) {
  const toneClass =
    tone === "accent"
      ? "border-[#d4af37]/35 bg-[#12110d]/80 shadow-[0_18px_60px_-24px_rgba(212,175,55,0.5)]"
      : tone === "quiet"
        ? "border-white/[0.07] bg-white/[0.03]"
        : "border-white/[0.09] bg-[#0d0d10]/72";
  return (
    <div
      className={`rounded-2xl border backdrop-blur-xl ${toneClass} ${className}`}
      style={{ WebkitBackdropFilter: "blur(20px)" }}
    >
      {children}
    </div>
  );
}

/** Small uppercase caption used to title a floating rail. */
export function StudioLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`block text-[10px] font-medium uppercase tracking-[0.22em] text-[#d4af37]/75 ${className}`}
    >
      {children}
    </span>
  );
}