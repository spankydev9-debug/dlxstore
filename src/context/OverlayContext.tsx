"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

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
 */
export type OverlayId = "chat" | "mobile-menu";

interface OverlayContextValue {
  activeOverlay: OverlayId | null;
  openOverlay: (id: OverlayId) => void;
  closeOverlay: () => void;
  toggleOverlay: (id: OverlayId) => void;
}

const HISTORY_MARKER = "__dlx_overlay__";

const OverlayContext = createContext<OverlayContextValue | undefined>(undefined);

export function OverlayProvider({ children }: { children: React.ReactNode }) {
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
  // the sheet cannot pan (the overlay owns scrolling).
  useEffect(() => {
    if (typeof document === "undefined" || activeOverlay === null) return;
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
      value={{ activeOverlay, openOverlay, closeOverlay, toggleOverlay }}
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