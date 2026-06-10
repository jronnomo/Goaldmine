"use client";

import { useEffect, useRef, useState } from "react";

type ConfirmButtonVariant = "danger" | "accent";

type ConfirmButtonProps = {
  /** Label shown in the unarmed (idle) state. */
  label: string;
  /** Label shown in the armed state — should convey "tap again to confirm". */
  confirmLabel: string;
  /** Fires when the user taps a second time while the button is armed. */
  onConfirm: () => void;
  /** Visual variant. "danger" (default) ⟶ red on arm; "accent" ⟶ accent color. */
  variant?: ConfirmButtonVariant;
  disabled?: boolean;
  /** Extra Tailwind classes forwarded to the button element (shape, padding, etc). */
  className?: string;
  /** Accessible label for the button (useful when the label is an icon). */
  "aria-label"?: string;
};

/**
 * Two-step confirm button — replaces window.confirm for PWA-safe destructive actions.
 *
 * Tap 1 → button "arms" (label switches to confirmLabel, styling intensifies).
 * Tap 2 → onConfirm fires, button disarms.
 * Auto-disarms after ~4 s or on blur (no second tap).
 *
 * Touch target: min-h-[44px] enforced. No native dialogs, no portals.
 * ARIA: aria-pressed tracks armed state; a visually-hidden aria-live region
 * announces the armed state to screen readers.
 */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  variant = "danger",
  disabled = false,
  className = "",
  "aria-label": ariaLabel,
}: ConfirmButtonProps) {
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Clear the auto-disarm timer, if any. */
  function clearTimer() {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function arm() {
    setArmed(true);
    timerRef.current = setTimeout(() => {
      setArmed(false);
      timerRef.current = null;
    }, 4000);
  }

  function disarm() {
    clearTimer();
    setArmed(false);
  }

  /** Cleanup timer if the component unmounts while armed. */
  useEffect(() => () => clearTimer(), []);

  function handleClick() {
    if (armed) {
      disarm();
      onConfirm();
    } else {
      arm();
    }
  }

  // When armed, inline styles win over class-based styles so the intensified
  // color reliably shows regardless of what the caller's className specifies.
  const armedStyle: React.CSSProperties | undefined = armed
    ? variant === "danger"
      ? {
          backgroundColor: "var(--danger)",
          color: "white",
          borderColor: "var(--danger)",
          opacity: 1,
        }
      : {
          backgroundColor: "var(--accent)",
          color: "var(--accent-fg)",
          borderColor: "var(--accent)",
          opacity: 1,
        }
    : undefined;

  return (
    <>
      {/* Visually hidden live region — announces the armed state to screen readers. */}
      <span className="sr-only" aria-live="polite">
        {armed ? confirmLabel : ""}
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={handleClick}
        onBlur={() => {
          if (armed) disarm();
        }}
        className={`min-h-[44px] transition ${className}`}
        style={armedStyle}
        aria-label={ariaLabel}
        aria-pressed={armed}
      >
        {armed ? confirmLabel : label}
      </button>
    </>
  );
}
