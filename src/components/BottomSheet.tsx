"use client";

import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

// Module-level: React keys the effect that (re)subscribes to this store off
// the identity of the `subscribe` function passed to useSyncExternalStore. An
// inline arrow would be a new identity every render, forcing a needless
// resubscribe each time. This store never actually changes (see the
// docstring below for why the flip doesn't come from a subscription event),
// so the callback is never invoked — but the identity still needs to be
// stable.
function subscribeNever() {
  return () => {};
}

export type BottomSheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  "data-testid"?: string;
};

/**
 * BottomSheet — native <dialog>-based bottom sheet, portaled to document.body.
 *
 * The native dialog is driven entirely off the `open` prop: showModal() when
 * open, close() when not. This is the canonical, race-free pattern — no custom
 * animation state machine. The dialog gives us focus-trapping, Esc handling,
 * and aria-modal semantics for free.
 *
 * Animation lives purely in CSS (globals.css): the panel slides up via a
 * transition + @starting-style on the `[open]` state. On browsers without
 * @starting-style support the sheet simply appears instantly — still fully
 * functional. Reduced-motion users get no transition.
 *
 * Portal rationale: the <dialog> is rendered into document.body via
 * createPortal, making every BottomSheet a direct body child regardless of
 * where it is used in the component tree. This prevents nested-dialog ancestry
 * (e.g. ScanFoodSheet rendered inside LogNutritionForm's <form>, itself inside
 * the Log sheet's <dialog>) from causing iOS to close the outer dialog when the
 * inner one is dismissed. Both dialogs become body siblings in the DOM — the
 * native top-layer stacking is unchanged; only DOM ancestry is fixed.
 *
 * Two-phase mount: createPortal requires document, which doesn't exist on the
 * server. We gate the portal on a `mounted` flag read via useSyncExternalStore,
 * whose getServerSnapshot always returns false. Both the server render AND the
 * client's first (hydration) render call getServerSnapshot — not getSnapshot —
 * so both produce `mounted === false` and both return null. Server HTML and
 * the hydration output agree; no mismatch.
 *
 * After hydration completes, React runs its own built-in post-hydration
 * consistency check: it re-reads getSnapshot() (which returns true), sees
 * that this differs from the value used at render time, and force-rerenders
 * the component — flipping `mounted` to true and mounting the portal on that
 * second client commit. Note this flip does NOT come from subscribeNever's
 * callback firing (it's a permanent no-op subscription, see above the
 * component) — it comes from React's internal recheck. Don't "simplify" this
 * by replacing it with useState + useEffect(() => setMounted(true), []); that
 * idiom trips the project's react-hooks/set-state-in-effect lint rule, which
 * is exactly why this useSyncExternalStore idiom was chosen instead
 * (precedent: ThemeToggle.tsx).
 *
 * All sheets start closed (open=false), so there is no visible flash — the
 * dialog is simply absent until the second client commit. The existing
 * useEffect([open]) for showModal/close no-ops on a null dialogRef until the
 * portal exists, then fires normally and handles open transitions correctly.
 */
export function BottomSheet({ open, onClose, title, children, "data-testid": testId }: BottomSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);

  // Keep the native dialog in sync with the `open` prop.
  // Cleanup (blueprint v2 §7.2): close the dialog on unmount or open→false
  // transition. The guard `dialog.open` prevents a double-close: the cleanup
  // runs first, closes the dialog (which fires the native close event →
  // onClose once), then the new effect body sees `!dialog.open` → skips its
  // own close call. Net result: onClose fires exactly once per close cycle,
  // same as without the cleanup — but we gain a defensive guard on unmount.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [open]);

  // Lock body scroll while the sheet is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Two-phase mount guard (see docstring above): `mounted` is false on the
  // server render and the client hydration render alike (both call
  // getServerSnapshot), so this returns null for both — no hydration
  // mismatch. React's post-hydration consistency recheck flips it to true on
  // the next client commit, at which point the portal mounts.
  if (!mounted) return null;

  return createPortal(
    <dialog
      ref={dialogRef}
      className="bottom-sheet"
      aria-labelledby={titleId}
      data-testid={testId}
      // Esc key: the browser fires `cancel`; prevent the default instant close
      // and route through React state so `open` stays the source of truth.
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // Fires when the dialog actually closes (incl. our own close() call).
      onClose={onClose}
      // Click on the backdrop (the dialog element itself, not the panel) closes.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bottom-sheet-panel">
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2 border-b border-[var(--border)]">
          <h2 id={titleId} className="text-base font-semibold text-[var(--foreground)]">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex items-center justify-center w-11 h-11 rounded-full text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--border)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M12 4L4 12M4 4l8 8"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Scrollable content. flex-1 + min-h-0 make THIS div the real scroll
            container (the panel is a flex column capped at max-height), so a
            child `position: sticky; top/bottom` pins to the sheet viewport
            rather than scrolling away (UXR-meal-edit-14/29). */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
          {children}
        </div>
      </div>
    </dialog>,
    document.body
  );
}
