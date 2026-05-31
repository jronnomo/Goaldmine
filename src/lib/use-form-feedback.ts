"use client";

/**
 * useFormFeedback — reusable hook for server-action form submission.
 *
 * USAGE PATTERN (load-bearing):
 *   const { pending, error, saved, formRef, submit } = useFormFeedback();
 *
 *   // Attach ref to the form AND use onSubmit — do NOT use <form action={...}>
 *   // Using the native action= prop causes the browser to submit natively;
 *   // the hook's submit() never runs, leading to double-submit or no feedback.
 *   <form ref={formRef} onSubmit={(e) => { e.preventDefault(); submit(myAction); }}>
 *
 * FEEDBACK LINE (reserve height to avoid layout shift):
 *   <p className="text-xs min-h-[1rem]" aria-live="polite">
 *     {saved && <span className="text-[var(--success)]">{saved}</span>}
 *     {error && !saved && <span className="text-[var(--danger)]">{error}</span>}
 *   </p>
 */

import { useRef, useState, useTransition } from "react";

export type FormFeedbackState = {
  /** True while the server action is in-flight (inside startTransition). */
  pending: boolean;
  /** Non-null when the last submit threw an error. Cleared on the next submit. */
  error: string | null;
  /** Non-null for ~1500 ms after a successful submit; null otherwise. */
  saved: string | null;
  /** Attach this ref to your <form> element. */
  formRef: React.RefObject<HTMLFormElement | null>;
  /**
   * Call from onSubmit. Reads FormData from formRef, clears error, awaits the
   * action, resets the form, fires onSuccess, and shows a transient saved message.
   * On throw: sets error string; does NOT reset the form.
   *
   * @param action  A server action (or any async fn) that accepts FormData.
   * @param opts    Optional: successMsg overrides the default "Saved ✓" message;
   *                onSuccess is called synchronously after reset (good for resetting
   *                controlled state like a <select> back to a default value).
   */
  submit: (
    action: (fd: FormData) => Promise<void>,
    opts?: { successMsg?: string; onSuccess?: () => void },
  ) => void;
};

export function useFormFeedback(): FormFeedbackState {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  function submit(
    action: (fd: FormData) => Promise<void>,
    opts?: { successMsg?: string; onSuccess?: () => void },
  ) {
    startTransition(async () => {
      setError(null);
      const fd = new FormData(formRef.current!);
      try {
        await action(fd);
        formRef.current?.reset();
        opts?.onSuccess?.();
        const msg = opts?.successMsg ?? "Saved ✓";
        setSaved(msg);
        setTimeout(() => setSaved(null), 1500);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save — tap to retry");
      }
    });
  }

  return { pending: isPending, error, saved, formRef, submit };
}
