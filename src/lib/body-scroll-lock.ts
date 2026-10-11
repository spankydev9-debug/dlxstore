/**
 * Reference-counted body scroll lock.
 *
 * Multiple independent surfaces can be open at once (a primary overlay plus a
 * modal launched from inside it). A naive `document.body.style.overflow = "hidden"`
 * followed by `= ""` clobbers whichever lock was set first: dismissing the inner
 * surface re-enables page scroll beneath the outer one, and the reverse order can
 * leave the page frozen. Counting acquires and only restoring the *saved* value
 * when the last lock is released makes the behaviour order-independent.
 *
 * The scrollbar-width compensation prevents the classic layout shift when the
 * scrollbar disappears on desktop.
 */
let lockCount = 0;
let previousOverflow = "";
let previousPaddingRight = "";

export function lockBodyScroll(): () => void {
  if (typeof document === "undefined") return () => {};

  if (lockCount === 0) {
    const body = document.body;
    previousOverflow = body.style.overflow;
    previousPaddingRight = body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`;
    }
  }
  lockCount += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
    }
  };
}
