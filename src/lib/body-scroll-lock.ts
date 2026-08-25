/**
 * body-scroll-lock — one refcounted page-scroll lock shared by every overlay.
 *
 * Two problems this solves, both founder-reported on iOS:
 *
 * 1. THE PAN THAT NEVER CAME BACK. iOS pans the layout viewport when a field
 *    inside an overlay focuses (the keyboard, a date/time wheel, a <select>).
 *    `position: fixed` overlays — the sheet dialogs — are anchored to that
 *    panned layout viewport, so they slide up off-screen and stay there: the
 *    next open renders the panel hard against the top of the screen with its
 *    header cut off. `overflow: hidden` alone does NOT undo the pan; only
 *    scrolling back does. ScanFoodSheet and LibraryPickerOverlay already
 *    captured/restored scrollY for exactly this reason — BottomSheet, the one
 *    that hosts the meal composer (the app's most keyboard-heavy surface),
 *    did not.
 *
 * 2. NESTED SHEETS FIGHTING OVER THE LOCK. The Log sheet hosts the saved-meal
 *    sheet, the scan sheet, the library picker and the meal-edit sheet — each
 *    with its own capture/restore. Closing an inner one restored the page
 *    scroll while the outer sheet was still open, and the outer's own restore
 *    then fired against a scroll position that had already moved. Refcounting
 *    makes the OUTERMOST lock own the captured position: inner locks are
 *    no-ops, and the page is restored exactly once, when the last sheet closes.
 *
 * The DOM work sits behind a small target interface so the refcount/restore
 * semantics are unit-testable under the node test environment.
 */

export type ScrollLockTarget = {
  getScrollY(): number;
  /** Restore the page scroll position. Must be instant — never smooth. */
  setScrollY(y: number): void;
  getOverflow(): string;
  setOverflow(value: string): void;
};

export type BodyScrollLock = {
  /** Acquire the lock. Returns an idempotent release function. */
  lock(): () => void;
  /** Current lock depth — test seam. */
  depth(): number;
};

export function createBodyScrollLock(target: ScrollLockTarget): BodyScrollLock {
  let depth = 0;
  let lockedScrollY = 0;
  let prevOverflow = "";

  return {
    depth: () => depth,
    lock() {
      if (depth === 0) {
        // The OUTERMOST lock owns the page position: it captured it before any
        // overlay could pan the viewport, so every inner release restores to
        // this same value rather than to a possibly-already-panned one.
        lockedScrollY = target.getScrollY();
        prevOverflow = target.getOverflow();
        target.setOverflow("hidden");
      }
      depth += 1;

      let released = false;
      return () => {
        // Idempotent: React can run an effect cleanup more than once (StrictMode
        // remounts), and a double release must never underflow the count and
        // unlock the page out from under a still-open sheet.
        if (released) return;
        released = true;
        depth -= 1;
        // Every release un-pans — closing an inner sheet whose keyboard shoved
        // the layout viewport must put it back even while the host sheet stays
        // open (that was ScanFoodSheet's and LibraryPickerOverlay's own fix).
        target.setScrollY(lockedScrollY);
        if (depth === 0) target.setOverflow(prevOverflow);
      };
    },
  };
}

const noop = () => {};

const domTarget: ScrollLockTarget = {
  getScrollY: () => (typeof window === "undefined" ? 0 : window.scrollY),
  setScrollY: (y) => {
    if (typeof window === "undefined") return;
    // "instant", not the default "auto": /progress opts the document into
    // scroll-behavior: smooth, and a restore must not animate.
    window.scrollTo({ top: y, left: 0, behavior: "instant" });
  },
  getOverflow: () =>
    typeof document === "undefined" ? "" : document.body.style.overflow,
  setOverflow: (value) => {
    if (typeof document === "undefined") return;
    document.body.style.overflow = value;
  },
};

const domLock = createBodyScrollLock(domTarget);

/**
 * Lock page scroll behind an overlay. Returns the release function — call it
 * from the effect cleanup:
 *
 *   useEffect(() => { if (!open) return; return lockBodyScroll(); }, [open]);
 */
export function lockBodyScroll(): () => void {
  if (typeof document === "undefined") return noop;
  return domLock.lock();
}
