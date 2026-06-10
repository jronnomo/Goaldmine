"use client";

import { useEffect, useId, useRef } from "react";

export type BottomSheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  "data-testid"?: string;
};

/**
 * BottomSheet — native <dialog>-based bottom sheet.
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
 */
export function BottomSheet({ open, onClose, title, children, "data-testid": testId }: BottomSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  // Keep the native dialog in sync with the `open` prop.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
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

  return (
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
    </dialog>
  );
}
