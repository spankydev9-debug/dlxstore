"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, X } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { useOverlay } from "../../context/OverlayContext";
import { ShoppingAssistantPanel } from "../account/ShoppingAssistantPanel";

// ---------------------------------------------------------------------------
// DLX Assistant — a movable product surface, not a fixed button.
//
// The control can be dragged anywhere in the viewport with pointer or touch,
// it never lands on top of the tab bar (or the studio's sticky sheet trigger),
// it docks to the nearest side when released, and its position is remembered
// across sessions as viewport fractions so a rotated or resized screen keeps a
// sensible placement.
//
// The panel is anchored to the button, so moving the button moves the surface
// with it: it opens above the button when there is room, below it otherwise,
// and always flips away from the viewport edges.
// ---------------------------------------------------------------------------

const POS_KEY = "dlx.assistant.fab.pos.v1";
const FAB = 48; // h-12 / w-12
const EDGE = 12; // side margin (right-3 / left-3)

type Pos = { x: number; y: number };

function cssPx(name: string): number {
  if (typeof window === "undefined") return 0;
  const raw = window.getComputedStyle(document.documentElement).getPropertyValue(name);
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : 0;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

/** Distance from the viewport bottom the button must stay clear of. */
function bottomZone(vw: number): number {
  const safeBottom = cssPx("--safe-bottom");
  // Floating tab bar: bottom 0.625rem + 3.75rem height + breathing room.
  const tabbar = vw < 768 ? 10 + 60 + 12 : 0;
  // The studio's sticky sheet trigger sits above the tab bar on mobile only.
  let trigger = 0;
  const el =
    typeof document !== "undefined"
      ? document.querySelector("[data-studio-sheet-trigger]")
      : null;
  if (el) {
    const rect = el.getBoundingClientRect();
    if (rect.bottom > 0 && rect.top < window.innerHeight) {
      trigger = Math.max(0, window.innerHeight - rect.top) + 10;
    }
  }
  return safeBottom + Math.max(tabbar, trigger) + 8;
}

/** The button must not sit under a sticky header while it is docked at the top. */
function topZone(): number {
  const safeTop = cssPx("--safe-top");
  const header = typeof document !== "undefined" ? document.querySelector("header") : null;
  if (header) {
    const bottom = header.getBoundingClientRect().bottom;
    if (bottom > 40) return bottom + 8;
  }
  return safeTop + 8;
}

function clampPos(pos: Pos, vw: number, vh: number): Pos {
  const minX = EDGE;
  const maxX = Math.max(minX, vw - FAB - EDGE);
  const maxY = Math.max(EDGE, vh - FAB - bottomZone(vw));
  const minY = Math.min(Math.max(topZone(), EDGE), maxY);
  return { x: clamp(pos.x, minX, maxX), y: clamp(pos.y, minY, maxY) };
}

function defaultPos(vw: number, vh: number): Pos {
  return clampPos({ x: vw - FAB - EDGE, y: vh - FAB - 24 - 92 }, vw, vh);
}

/** Stored as fractions of the free space so rotation/resize stays sane. */
function loadPos(vw: number, vh: number): Pos {
  try {
    const raw = window.localStorage.getItem(POS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { fx?: unknown; fy?: unknown };
      if (typeof parsed.fx === "number" && typeof parsed.fy === "number") {
        return clampPos(
          {
            x: parsed.fx * Math.max(1, vw - FAB),
            y: parsed.fy * Math.max(1, vh - FAB),
          },
          vw,
          vh
        );
      }
    }
  } catch {
    // Private mode / corrupt value: fall back to the default corner.
  }
  return defaultPos(vw, vh);
}

function savePos(pos: Pos, vw: number, vh: number): void {
  try {
    window.localStorage.setItem(
      POS_KEY,
      JSON.stringify({
        fx: pos.x / Math.max(1, vw - FAB),
        fy: pos.y / Math.max(1, vh - FAB),
      })
    );
  } catch {
    // Storage unavailable — position simply is not remembered.
  }
}

export function DLXAssistantFab() {
  const { t } = useLanguage();
  const { activeOverlay, openOverlay, closeOverlay } = useOverlay();
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const [dragging, setDragging] = useState(false);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origin: Pos;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);

  const open = activeOverlay === "assistant";

  // Mount: measure the viewport, restore (or place) the control.
  useEffect(() => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    setViewport({ w, h });
    setPos(loadPos(w, h));
    setMounted(true);
  }, []);

  // Keep the control inside the safe area when the screen changes.
  useEffect(() => {
    if (!mounted) return;
    const onResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setViewport({ w, h });
      setPos((current) => (current ? clampPos(current, w, h) : current));
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [mounted]);

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

  // ---- dragging ----------------------------------------------------------
  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !pos) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: pos,
      moved: false,
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !viewport.w) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    setDragging(true);
    setPos(
      clampPos({ x: drag.origin.x + dx, y: drag.origin.y + dy }, viewport.w, viewport.h)
    );
  };

  const endDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!drag.moved) return;
    suppressClickRef.current = true;
    setDragging(false);
    // Dock to the side the user dropped it towards — the vertical position is
    // always theirs, the horizontal one snaps so the control reads as parked.
    setPos((current) => {
      if (!current || !viewport.w) return current;
      const maxX = Math.max(EDGE, viewport.w - FAB - EDGE);
      const x = current.x + FAB / 2 < viewport.w / 2 ? EDGE : maxX;
      const next = clampPos({ x, y: current.y }, viewport.w, viewport.h);
      savePos(next, viewport.w, viewport.h);
      return next;
    });
  };

  const handleClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    handleToggle();
  };

  if (!mounted || !pos || !viewport.w) return null;

  // ---- panel geometry, anchored to the button ---------------------------
  const safeBottom = cssPx("--safe-bottom");
  const panelW = Math.min(viewport.w - 24, viewport.w < 768 ? 360 : 380);
  const panelLeft = clamp(pos.x + FAB - panelW, 12, Math.max(12, viewport.w - panelW - 12));
  const roomAbove = pos.y - 12;
  const roomBelow = viewport.h - (pos.y + FAB + 10) - safeBottom;
  const above = roomAbove >= 320 || roomAbove >= roomBelow;
  const maxHeight = Math.max(
    200,
    Math.min(viewport.h - 24, above ? roomAbove : roomBelow)
  );
  const panelStyle: React.CSSProperties = above
    ? { left: panelLeft, bottom: viewport.h - pos.y + 10, maxHeight, width: panelW }
    : { left: panelLeft, top: pos.y + FAB + 10, maxHeight, width: panelW };

  return (
    <>
      {open && (
        <div
          ref={panelRef}
          className="fixed z-50"
          style={panelStyle}
          data-fab-panel
        >
          <div className="rounded-2xl border border-border/60 bg-card/95 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.9)] backdrop-blur-2xl ring-1 ring-black/5 dark:ring-white/5">
            <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Bot className="h-4 w-4" />
                </span>
                <span className="min-w-0 truncate text-sm font-semibold">
                  {t.assistantTitle}
                </span>
              </div>
              <button
                type="button"
                onClick={closeOverlay}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted"
                aria-label={t.assistantFloatingClose}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-y-auto p-3" style={{ maxHeight: maxHeight - 54 }}>
              <ShoppingAssistantPanel />
            </div>
          </div>
        </div>
      )}
      <button
        ref={buttonRef}
        type="button"
        data-fab="assistant"
        data-fab-dragging={dragging ? "true" : "false"}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={handleClick}
        aria-expanded={open}
        aria-label={open ? t.assistantFloatingClose : t.assistantFloatingOpen}
        title={
          open
            ? t.assistantFloatingClose
            : `${t.assistantFloatingHint} — ${t.assistantDragHint}`
        }
        className={`fixed z-40 flex h-12 w-12 touch-none items-center justify-center rounded-full bg-gradient-to-b from-[#e6c65a] to-[#c39c22] text-black shadow-[0_20px_50px_-15px_rgba(212,175,55,0.95)] ring-2 ring-black/10 transition-transform select-none ${
          dragging ? "cursor-grabbing scale-105" : "cursor-grab hover:scale-105 active:scale-95"
        }`}
        style={{
          left: pos.x,
          top: pos.y,
          WebkitUserSelect: "none",
          userSelect: "none",
        }}
      >
        <Bot className="h-5 w-5 pointer-events-none" aria-hidden />
      </button>
    </>
  );
}
