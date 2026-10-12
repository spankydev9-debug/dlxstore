"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useBodyScrollLock } from "../../hooks/useBodyScrollLock";

/**
 * Viewport-safe dialog primitive.
 *
 * Root cause it fixes: dialogs that hard-coded `fixed inset-0 … items-end` with a
 * content-sized panel and no max-height let tall content run off the top of the
 * screen on short/landscape viewports, with no way to scroll to the hidden
 * options. This primitive renders through the shared `.overlay-backdrop` /
 * `.overlay-panel` system, which is:
 *   - pinned to the *visual* viewport (mobile bottom sheet, desktop centred),
 *   - inset by the safe-area insets (notch / home indicator),
 *   - raised by `--kb-offset` so the on-screen keyboard cannot cover the actions,
 *   - internally scrollable (`overlay-panel--auto`) so tall content stays reachable.
 *
 * It also owns an order-independent body scroll lock and Escape-to-close, so an
 * inner dialog can no longer leave the page frozen or unfreeze it prematurely.
 *
 * Portalled to `document.body`: `position: fixed` is resolved against the nearest
 * ancestor that establishes a containing block (any `transform`, `filter`,
 * `backdrop-filter`, `will-change` or `contain`). Page shells animate in with
 * `animation-fill-mode: forwards` and `translateY`, which leaves a permanent
 * `transform` on the page root — the fixed backdrop would then be positioned
 * relative to that element (e.g. a dialog pinned to the bottom of the document
 * instead of the viewport). Rendering through a portal escapes every such
 * ancestor, so the dialog is always pinned to the visual viewport.
 */
export type ModalSize = "sm" | "md" | "lg" | "xl";

const SIZES: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-4xl",
};

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  size?: ModalSize;
  ariaLabel?: string;
  labelledBy?: string;
  /** Additional classes for the scrollable panel. */
  panelClassName?: string;
  /** Dismiss when the backdrop (not the panel) is pressed. Defaults to true. */
  closeOnBackdrop?: boolean;
}

export function Modal({
  open,
  onClose,
  children,
  size = "md",
  ariaLabel,
  labelledBy,
  panelClassName = "",
  closeOnBackdrop = true,
}: ModalProps) {
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!open || !mounted || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="overlay-backdrop animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      aria-labelledby={labelledBy}
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`overlay-panel overlay-panel--auto w-full ${SIZES[size]} ${panelClassName}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
