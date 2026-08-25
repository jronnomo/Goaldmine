/**
 * body-scroll-lock — one refcounted page freeze shared by every overlay, plus
 * the visual-viewport anchoring that keeps a top-layer <dialog> where the user
 * can actually see it.
 *
 * THE BUG THIS EXISTS FOR (founder-reported, iOS, twice). Focus a field inside
 * a sheet — a macro input, the estimate box, the save-as-meal name — and iOS
 * moves the page to reveal it above the keyboard. `position: fixed` elements
 * (the bottom nav) ride along and stay put on screen; an element in the TOP
 * LAYER does not. The Log sheet ends up shifted up by roughly a keyboard's
 * height: its header and ✕ sit above the top edge of the screen and its bottom
 * edge lands mid-viewport, with the page showing through underneath. The pan
 * outlives the keyboard, so the sheet stays wrong until the page is scrolled
 * back — and `overflow: hidden` on <body> does not stop iOS from panning.
 *
 * Two defenses, and they compose:
 *
 *   1. FREEZE THE PAGE, don't just hide its overflow. `position: fixed` on
 *      <body> at `-scrollY` collapses the document to viewport height, so there
 *      is no page scroll for iOS to move — and document coordinates and layout
 *      viewport coordinates become the same thing, which makes (2) correct no
 *      matter how a given engine anchors top-layer elements.
 *
 *   2. ANCHOR THE DIALOG TO THE VISUAL VIEWPORT. While anything is locked, the
 *      `--vv-*` custom properties track window.visualViewport (offset + size)
 *      and the sheet dialogs size/position off them (see `.bottom-sheet` and
 *      `.viewport-dialog` in globals.css). Whatever the browser does with the
 *      top layer, the sheet lands exactly over what the user is looking at —
 *      and with the keyboard up it sits directly above it instead of behind it.
 *      Absent visualViewport the vars are never set and the CSS falls back to
 *      the old full-viewport values.
 *
 * REFCOUNTING. The Log sheet hosts four other sheets (saved-meal, scan, library
 * picker, meal-edit), each of which used to freeze/restore the page itself — so
 * closing an inner one unlocked the page under a still-open outer one and the
 * outer's later restore fired against a position that had already moved. Now
 * the OUTERMOST lock owns the captured position; inner locks only bump a count.
 *
 * The DOM work sits behind a small target interface so the refcount semantics
 * are unit-testable under the node test environment.
 */

export type ScrollLockTarget = {
  getScrollY(): number;
  /** Freeze the page at `scrollY` and start tracking the visual viewport. */
  freeze(scrollY: number): void;
  /** Undo freeze() and put the page back at `scrollY`. */
  thaw(scrollY: number): void;
  /** Re-assert the frozen geometry — used when an inner overlay closes. */
  reassert(scrollY: number): void;
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

  return {
    depth: () => depth,
    lock() {
      if (depth === 0) {
        // The OUTERMOST lock owns the page position: it captured it before any
        // overlay could move the viewport, so this is the value everything
        // restores to.
        lockedScrollY = target.getScrollY();
        target.freeze(lockedScrollY);
      }
      depth += 1;

      let released = false;
      return () => {
        // Idempotent: React can run an effect cleanup more than once (StrictMode
        // remounts), and a double release must never underflow the count and
        // unfreeze the page out from under a still-open sheet.
        if (released) return;
        released = true;
        depth -= 1;
        if (depth === 0) target.thaw(lockedScrollY);
        // An inner sheet closing is the moment a leaked pan is most visible —
        // re-assert rather than wait for the host sheet to close.
        else target.reassert(lockedScrollY);
      };
    },
  };
}

// ── DOM implementation ────────────────────────────────────────────────────────

const VV_VARS = ["--vv-top", "--vv-left", "--vv-width", "--vv-height"] as const;

/** Saved inline <body> styles, restored verbatim on thaw. */
type SavedBodyStyle = Record<
  "position" | "top" | "left" | "right" | "width" | "overflow" | "paddingRight",
  string
>;

let savedBodyStyle: SavedBodyStyle | null = null;
let vvFrame = 0;

function syncViewportVars() {
  const vv = typeof window === "undefined" ? null : window.visualViewport;
  if (!vv) return;
  const root = document.documentElement.style;
  root.setProperty("--vv-top", `${vv.offsetTop}px`);
  root.setProperty("--vv-left", `${vv.offsetLeft}px`);
  root.setProperty("--vv-width", `${vv.width}px`);
  root.setProperty("--vv-height", `${vv.height}px`);
}

function onViewportChange() {
  // Coalesce: iOS fires a burst of these while the keyboard animates.
  if (vvFrame) return;
  vvFrame = requestAnimationFrame(() => {
    vvFrame = 0;
    syncViewportVars();
  });
}

function startViewportTracking() {
  const vv = window.visualViewport;
  if (!vv) return; // no visualViewport → CSS falls back to the full viewport
  syncViewportVars();
  vv.addEventListener("resize", onViewportChange);
  vv.addEventListener("scroll", onViewportChange);
}

function stopViewportTracking() {
  const vv = window.visualViewport;
  if (vv) {
    vv.removeEventListener("resize", onViewportChange);
    vv.removeEventListener("scroll", onViewportChange);
  }
  if (vvFrame) {
    cancelAnimationFrame(vvFrame);
    vvFrame = 0;
  }
  const root = document.documentElement.style;
  for (const v of VV_VARS) root.removeProperty(v);
}

const domTarget: ScrollLockTarget = {
  getScrollY: () => window.scrollY,

  freeze(scrollY) {
    const style = document.body.style;
    savedBodyStyle = {
      position: style.position,
      top: style.top,
      left: style.left,
      right: style.right,
      width: style.width,
      overflow: style.overflow,
      paddingRight: style.paddingRight,
    };
    // Desktop: a classic scrollbar disappears when the document stops
    // overflowing, which would shove the page sideways. Hold its width.
    const gutter = window.innerWidth - document.documentElement.clientWidth;
    if (gutter > 0) style.paddingRight = `${gutter}px`;
    style.position = "fixed";
    style.top = `-${scrollY}px`;
    style.left = "0";
    style.right = "0";
    style.width = "100%";
    style.overflow = "hidden";
    startViewportTracking();
  },

  thaw(scrollY) {
    stopViewportTracking();
    const style = document.body.style;
    const saved = savedBodyStyle;
    savedBodyStyle = null;
    if (saved) {
      style.position = saved.position;
      style.top = saved.top;
      style.left = saved.left;
      style.right = saved.right;
      style.width = saved.width;
      style.overflow = saved.overflow;
      style.paddingRight = saved.paddingRight;
    }
    // "instant", not the default "auto": /progress opts the document into
    // scroll-behavior: smooth, and a restore must not animate.
    window.scrollTo({ top: scrollY, left: 0, behavior: "instant" });
  },

  reassert() {
    syncViewportVars();
  },
};

const domLock = createBodyScrollLock(domTarget);

const noop = () => {};

/**
 * Freeze the page behind an overlay. Returns the release function — call it
 * from the effect cleanup:
 *
 *   useEffect(() => { if (!open) return; return lockBodyScroll(); }, [open]);
 */
export function lockBodyScroll(): () => void {
  if (typeof document === "undefined") return noop;
  return domLock.lock();
}
