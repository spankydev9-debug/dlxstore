"use client";

import { useEffect } from "react";
import { lockBodyScroll } from "../lib/body-scroll-lock";

/**
 * Locks background scrolling while `active` is true, using the ref-counted lock
 * so nested surfaces restore the page correctly regardless of dismissal order.
 */
export function useBodyScrollLock(active = true) {
  useEffect(() => {
    if (!active) return;
    return lockBodyScroll();
  }, [active]);
}
