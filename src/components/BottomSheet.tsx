"use client";

import { useEffect, useRef, useCallback } from "react";

export type BottomSheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
};

/**
 * BottomSheet — native <dialog>-based bottom sheet.
 *
 * Uses showModal() / close() for:
 *   - Native focus-trapping (including dynamically-added form fields)
 *   - Esc key handling via the `cancel` event
 *   - aria-modal semantics for free
 *   - iOS body-scroll lock (dialog blocks interaction with content behind)
 *   - Return-focus to the trigger element automatically
 *
 * Animation: backdrop fades in 160ms; panel slides up 220ms cubic-bezier(.16,1,.3,1).
 * On close: reverse animation runs, then close() is called after transitionend (or fallback timeout).
 * Reduced-motion: see globals.css for the @media guard.
 */
export function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Track whether we are currently in the closing animation to prevent double-close
  const isClosingRef = useRef(false);

  // Trigger the close animation then call dialog.close()
  const animateOut = useCallback(() => {
    const dialog = dialogRef.current;
    const panel = panelRef.current;
    if (!dialog || !panel || isClosingRef.current) return;
    isClosingRef.current = true;

    // Apply the closing class which reverses the slide
    panel.classList.add("bottom-sheet-panel--closing");
    dialog.classList.add("bottom-sheet--closing");

    const done = () => {
      panel.classList.remove("bottom-sheet-panel--closing");
      dialog.classList.remove("bottom-sheet--closing");
      isClosingRef.current = false;
      dialog.close();
      onClose();
    };

    // Use transitionend on the panel; fall back to timeout matching 180ms
    const fallback = setTimeout(done, 200);
    panel.addEventListener(
      "transitionend",
      () => {
        clearTimeout(fallback);
        done();
      },
      { once: true },
    );
  }, [onClose]);

  // Open / close the native dialog in sync with the `open` prop
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) {
        isClosingRef.current = false;
        dialog.showModal();
      }
    } else {
      // Only run close animation if dialog is actually open
      if (dialog.open && !isClosingRef.current) {
        animateOut();
      }
    }
  }, [open, animateOut]);

  // Sync React state when native Esc fires (browser fires `cancel` before `close`)
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleCancel = (e: Event) => {
      // Prevent the browser from immediately closing — we animate out instead
      e.preventDefault();
      if (!isClosingRef.current) {
        animateOut();
      }
    };

    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
  }, [animateOut]);

  // Backdrop tap: clicks on the <dialog> element itself (not the panel) close the sheet
  const handleDialogClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current && !isClosingRef.current) {
      animateOut();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onClick={handleDialogClick}
      aria-labelledby="bottom-sheet-title"
      className="bottom-sheet"
    >
      {/* Panel */}
      <div ref={panelRef} className="bottom-sheet-panel">
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2 border-b border-[var(--border)]">
          <h2
            id="bottom-sheet-title"
            className="text-base font-semibold text-[var(--foreground)]"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={() => !isClosingRef.current && animateOut()}
            aria-label="Close"
            className="inline-flex items-center justify-center w-8 h-8 rounded-full text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--border)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
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
