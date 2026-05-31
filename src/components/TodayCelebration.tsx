"use client";
import { useEffect, useRef } from "react";
import { Bullseye } from "@/components/Bullseye";

export function TodayCelebration({
  completed,
  dateKey,
}: {
  completed: boolean;
  dateKey: string;
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
    const key = "goaldmine.celebrated." + dateKey;
    try {
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, "1");
        // Imperatively add the pop class — no setState, no re-render, no mismatch.
        wrapRef.current?.classList.add("bullseye-pop");
      }
    } catch {
      // localStorage blocked (private browsing, storage quota, etc.) — degrade silently.
    }
  }, [completed, dateKey]);

  return (
    // inline-block so CSS transform (scale) applies on the wrapper span.
    <span ref={wrapRef} style={{ display: "inline-block" }}>
      <Bullseye
        filled={completed}
        size={28}
        aria-label={completed ? "Completed" : "In progress"}
      />
    </span>
  );
}
