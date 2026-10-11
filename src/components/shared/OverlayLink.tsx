"use client";

import Link from "next/link";
import { useOverlay } from "../../context/OverlayContext";

/**
 * A `<Link>` that behaves correctly when the click originates inside an open
 * primary overlay (the Account & More drawer, mobile search, assistant popover).
 *
 * Why this exists: `useOverlay().closeOverlay()` pops the overlay's virtual
 * history entry with `history.back()`. Next's `<Link>` runs our `onClick`
 * *before* it pushes the destination, so `closeOverlay()` + Link races — the
 * queued `history.back()` undoes the navigation (or, for a same-path query link
 * such as `/dashboard?tab=orders`, silently does nothing). This wrapper routes a
 * plain click through `navigateFromOverlay`, which replaces the marker with the
 * destination instead.
 *
 * Modified / middle clicks are left to the browser (open in new tab) and only
 * dismiss the overlay. When no overlay is open, it is an ordinary `<Link>`.
 */
export function OverlayLink({ onClick, href, children, ...rest }: React.ComponentProps<typeof Link>) {
  const { activeOverlay, closeOverlay, navigateFromOverlay } = useOverlay();

  return (
    <Link
      href={href}
      {...rest}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;

        const modified =
          event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
        if (modified) {
          if (activeOverlay) closeOverlay();
          return;
        }

        if (!activeOverlay || typeof href !== "string") return;
        event.preventDefault();
        navigateFromOverlay(href);
      }}
    >
      {children}
    </Link>
  );
}
