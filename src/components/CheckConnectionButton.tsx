"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";

/**
 * "Check for connection" button — triggers a router.refresh() to re-run the
 * server component and pick up a newly-established OAuth connection.
 *
 * Auto-refresh on tab return (DEBOUNCED):
 * When `connected === false`, registers a `visibilitychange` listener that
 * fires router.refresh() when the user tabs back from claude.ai. A useRef
 * guards against rapid-fire triggers (1 s debounce). When `connected === true`
 * no listener is registered — self-terminating via useEffect deps.
 *
 * NO setInterval — single-event, debounced visibilitychange only.
 */
export function CheckConnectionButton({ connected }: { connected: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const lastFired = useRef<number>(0);

  function check() {
    startTransition(() => {
      router.refresh();
    });
  }

  useEffect(() => {
    // Only register the listener when not yet connected — no pointless refresh
    // if the user is already confirmed connected.
    if (connected) return;

    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      // 1 s debounce — guard against rapid successive tab-switches
      if (Date.now() - lastFired.current < 1000) return;
      lastFired.current = Date.now();
      startTransition(() => {
        router.refresh();
      });
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [connected, router]);
  // `router` is stable across renders in Next.js App Router; in deps for
  // strict-mode correctness. Does not cause extra effect re-runs in practice.

  return (
    <button
      type="button"
      onClick={check}
      disabled={isPending}
      className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]/10 active:bg-[var(--accent)]/20 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
    >
      {isPending ? "Checking…" : "Check for connection"}
    </button>
  );
}
