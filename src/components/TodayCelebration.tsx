"use client";
import { useEffect, useRef } from "react";
import { Bullseye } from "@/components/Bullseye";

export function TodayCelebration({
  completed,
  dateKey,
  storageKey,  // [v2] if provided, overrides the default "goaldmine.celebrated.<dateKey>" key
  progress,    // [v2] HIGH-2: if provided (0..1), renders progressive rings instead of binary filled/hollow
  ariaLabel,   // [v2] HIGH-2/MIS-2: if provided, overrides the default "Completed"/"In progress" label
}: {
  completed: boolean;
  dateKey: string;
  storageKey?: string;  // [v2]
  progress?: number;    // [v2] 0..1
  ariaLabel?: string;   // [v2]
}) {
  // Use a ref for the wrapper span so we can imperatively add "bullseye-pop"
  // after mount. This avoids both:
  //   1. React 19 hydration mismatch (className differs between SSR and first
  //      client render when localStorage is read eagerly), and
  //   2. the react-hooks/set-state-in-effect lint error (no setState in effect).
  // The Bullseye className stays "" forever in React's virtual DOM; the pop
  // animation is applied directly to the wrapper span via the ref.
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!completed) return;
    // [v2] REQ-002: project path passes a goal-scoped key; fitness path uses the default.
    const key = storageKey ?? "goaldmine.celebrated." + dateKey;
    try {
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, "1");
        // Imperatively add the pop class — no setState, no re-render, no mismatch.
        wrapRef.current?.classList.add("bullseye-pop");
      }
    } catch {
      // localStorage blocked (private browsing, storage quota, etc.) — degrade silently.
    }
  }, [completed, dateKey, storageKey]);

  // Effective aria-label: caller-provided wins; else binary completed/in-progress.
  // [v2] The project path passes a progress-aware label: "${doneToday} of ${total} items done today".
  const label = ariaLabel ?? (completed ? "Completed" : "In progress");

  return (
    // inline-block so CSS transform (scale) applies on the wrapper span.
    <span ref={wrapRef} style={{ display: "inline-block" }}>
      {typeof progress === "number" ? (
        // [v2] HIGH-2: progressive rings — project path passes progress=doneToday/total.
        // Bullseye.progressToRings(28, p) → {0,1,2,3,4} rings, always at least 1 when p>0.
        // Pop useEffect is unchanged: it fires when completed===true regardless of progress value.
        // Fitness path never passes progress → falls through to the filled/hollow branch below.
        <Bullseye progress={progress} size={28} aria-label={label} />
      ) : (
        // Fitness path (progress prop absent) — binary filled/hollow; byte-identical behavior.
        <Bullseye filled={completed} size={28} aria-label={label} />
      )}
    </span>
  );
}
