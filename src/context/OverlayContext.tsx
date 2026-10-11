"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";

/**
 * Shared primary-overlay / navigation state.
 *
 * DLXSTORE has several full-screen outlets (Support chat, the mobile menu
 * drawer, install/language prompts). This context guarantees that only ONE
 * primary overlay is open at a time: opening one replaces whatever was open
 * before. Small temporary UI (search autocomplete, notification/user dropdowns,
 * tooltips) is intentionally NOT registered here and can coexist anywhere.
 *
 * It also integrates with the browser history so that:
 *  - pressing browser/mobile Back while an overlay is open closes the overlay
 *    first (instead of navigating away), and
 *  - opening a new primary outlet automatically closes/replaces the previous one
 *    without leaving orphan history entries behind.
 *
 * `mobile-menu` is the *Account & More* drawer (secondary navigation) and
 * `mobile-search` is the full-screen search surface. They are separate ids so
 * neither can be mistaken for the other: search is a primary destination of the
 * mobile layout, the drawer is where secondary links live.
 */
export type OverlayId = "chat" | "mobile-menu" | "mobile-search" | "language" | "assistant";

interface OverlayContextValue {
  activeOverlay: OverlayId | null;
  openOverlay: (id: OverlayId) => void;
  closeOverlay: () => void;
  toggleOverlay: (id: OverlayId) => void;
  navigateFromOverlay: (href: string) => void;
}

const HISTORY_MARKER = "__dlx_overlay__";

const OverlayContext = createContext<OverlayContextValue | undefined>(undefined);

export function OverlayProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [activeOverlay, setActiveOverlay] = useState<OverlayId | null>(null);
  const activeOverlayRef = useRef<OverlayId | null>(null);
  const markerOnStackRef = useRef(false);

  const commitOverlay = useCallback((next: OverlayId | null) => {
    activeOverlayRef.current = next;
    setActiveOverlay(next);
  }, []);

  const openOverlay = useCallback(
    (id: OverlayId) => {
      if (activeOverlayRef.current === id) return;
      if (activeOverlayRef.current === null && typeof window !== "undefined") {
        // First primary overlay of this interaction: push a virtual history
        // entry so browser/mobile Back closes the overlay instead of navigating.
        window.history.pushState({ [HISTORY_MARKER]: true }, "");
        markerOnStackRef.current = true;
      }
      // If another primary overlay was already open, it is simply replaced —
      // no extra history entries are created.
      commitOverlay(id);
    },
    [commitOverlay]
  );

  const closeOverlay = useCallback(() => {
    if (activeOverlayRef.current === null) return;
    commitOverlay(null);
    // Pop our virtual entry, but ONLY when it is still the top-most history
    // entry. If the user navigated (e.g. via a router push) while the overlay
    // was open, we must not navigate backwards — the popstate handler covers
    // that when the user presses Back.
    if (markerOnStackRef.current && typeof window !== "undefined") {
      const topState = window.history.state as Record<string, unknown> | null;
      if (topState && topState[HISTORY_MARKER] === true) {
        markerOnStackRef.current = false;
        window.history.back();
      }
    }
  }, [commitOverlay]);

  const toggleOverlay = useCallback(
    (id: OverlayId) => {
      if (activeOverlayRef.current === id) {
        closeOverlay();
      } else {
        openOverlay(id);
      }
    },
    [closeOverlay, openOverlay]
  );

  /**
   * Navigate to a real route from inside an open overlay.
   *
   * Callers must NOT use `closeOverlay()` immediately before a navigation.
   * `closeOverlay` pops the virtual history marker with `history.back()`, and
   * Next's `<Link>` runs our click handler *before* it pushes the destination
   * (see next/dist/client/app-dir/link.js). The queued `history.back()` then
   * lands on the destination and immediately backs out of it — the classic
   * "tap does nothing / returns to the previous screen" bug.
   *
   * Instead we consume the marker by *replacing* it with the destination, so the
   * destination is a single, correct history entry and Back still returns to the
   * page the overlay was opened from.
   */
  const navigateFromOverlay = useCallback(
    (href: string) => {
      if (activeOverlayRef.current === null) {
        router.push(href);
        return;
      }
      commitOverlay(null);
      const topState =
        typeof window !== "undefined"
          ? (window.history.state as Record<string, unknown> | null)
          : null;
      const markerIsTop =
        markerOnStackRef.current && !!topState && topState[HISTORY_MARKER] === true;
      markerOnStackRef.current = false;
      if (markerIsTop) {
        router.replace(href);
      } else {
        router.push(href);
      }
    },
    [commitOverlay, router]
  );

  // Browser/device Back: when the user lands back on our virtual history entry,
  // close the overlay instead of letting the navigation escape past it.
  useEffect(() => {
    const onPopState = () => {
      if (markerOnStackRef.current) {
        markerOnStackRef.current = false;
        commitOverlay(null);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [commitOverlay]);

  // Lock background scrolling while a primary overlay is open so the page behind
  // the sheet cannot pan. The assistant is a small popover, not a full-screen
  // sheet, so it must NOT lock the page — locking it freezes the document the
  // popover floats above, which feels broken on desktop and mobile alike.
  useEffect(() => {
    if (
      typeof document === "undefined" ||
      activeOverlay === null ||
      activeOverlay === "assistant"
    )
      return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [activeOverlay]);

  // Escape closes the current primary overlay.
  useEffect(() => {
    if (activeOverlay === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeOverlay();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeOverlay, closeOverlay]);

  return (
    <OverlayContext.Provider
      value={{ activeOverlay, openOverlay, closeOverlay, toggleOverlay, navigateFromOverlay }}
    >
      {children}
    </OverlayContext.Provider>
  );
}

export function useOverlay() {
  const ctx = useContext(OverlayContext);
  if (!ctx) {
    throw new Error("useOverlay must be used within an OverlayProvider");
  }
  return ctx;
}