"use client";

import { useEffect, useId, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

export type BottomSheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  "data-testid"?: string;
  // TEMP-DIAG ─────────────────────────────────────────────────────────────
  // Called just before each close path fires so callers can identify which
  // event triggered the close. Remove together with LogCloseDiag.tsx and
  // the BottomNav / BarcodeScanner TEMP-DIAG blocks after repro is confirmed.
  onCloseReason?: (reason: string) => void;
  // ────────────────────────────────────────────────────────────────────────
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
 * SSR guard: createPortal requires document, which doesn't exist on the server.
 * `typeof document === "undefined"` returns null during the server pass and the
 * initial hydration render. All sheets start closed (open=false), so there is
 * no visible flash — the dialog is simply absent from server HTML and inserted
 * on the client immediately after hydration. The existing useEffect([open])
 * for showModal/close fires after the portal is in the DOM and handles open
 * transitions correctly. This avoids calling setState inside an effect, which
 * is flagged by the project's react-hooks/set-state-in-effect lint rule.
 */
export function BottomSheet({ open, onClose, title, children, "data-testid": testId, onCloseReason }: BottomSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  // TEMP-DIAG: keep onCloseReason in a ref so the open-effect (which only
  // re-runs on [open]) can always call the latest prop without going stale.
  // useLayoutEffect runs before useEffect cleanup, so the ref is always
  // current when the effect reads it.
  const onCloseReasonRef = useRef(onCloseReason);
  useLayoutEffect(() => { onCloseReasonRef.current = onCloseReason; });

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
      // TEMP-DIAG: effect body closed dialog because open prop flipped false
      onCloseReasonRef.current?.("open-prop-false");
      dialog.close();
    }
    return () => {
      // TEMP-DIAG: effect cleanup closed dialog (normal open→false path)
      if (dialog.open) {
        onCloseReasonRef.current?.("effect-cleanup");
        dialog.close();
      }
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

  // SSR guard: document does not exist on the server or during the initial
  // hydration pass. Return null to skip rendering — all sheets start closed,
  // so there is no flash. The portal renders on the next client commit.
  if (typeof document === "undefined") return null;

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
        onCloseReason?.("cancel"); // TEMP-DIAG
        onClose();
      }}
      // Fires when the dialog actually closes (incl. our own close() call).
      onClose={() => {
        onCloseReason?.("close-event"); // TEMP-DIAG
        onClose();
      }}
      // Click on the backdrop (the dialog element itself, not the panel) closes.
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onCloseReason?.("backdrop"); // TEMP-DIAG
          onClose();
        }
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
            onClick={() => { onCloseReason?.("x-button"); onClose(); }} // TEMP-DIAG
            aria-label="Close"
            className="inline-flex items-center justify-center w-9 h-9 rounded-full text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--border)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
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

        {/* Scrollable content */}
        <div className="overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
          {children}
        </div>
      </div>
    </dialog>,
    document.body
  );
}
