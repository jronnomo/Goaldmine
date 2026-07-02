"use client";

import { useSyncExternalStore } from "react";

type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "goaldmine.theme";
const ORDER: Theme[] = ["system", "light", "dark"];

function applyTheme(theme: Theme) {
  const html = document.documentElement;
  if (theme === "system") html.removeAttribute("data-theme");
  else html.setAttribute("data-theme", theme);
}

function getSnapshot(): Theme {
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

function getServerSnapshot(): Theme {
  return "system";
}

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function cycle() {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]!;
    window.localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
    // Same-tab updates don't fire a `storage` event; nudge subscribers.
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
  }

  const glyph = theme === "light" ? "☀" : theme === "dark" ? "☾" : "◐";
  const aria = `Theme: ${theme} (click to change)`;

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={aria}
      title={aria}
      suppressHydrationWarning
      className="ml-auto inline-flex items-center justify-center w-9 h-9 rounded-full border border-[var(--border)] text-[var(--foreground)] hover:border-[var(--accent)] transition-colors"
    >
      <span aria-hidden className="text-base leading-none" suppressHydrationWarning>{glyph}</span>
    </button>
  );
}
