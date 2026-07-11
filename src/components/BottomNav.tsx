"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bullseye } from "@/components/Bullseye";
import { BottomSheet } from "@/components/BottomSheet";
import { LogLauncher } from "@/components/LogLauncher";
import { MoreSheet } from "@/components/MoreSheet";

// ──────────────────────────────────────────────────────────────────────────────
// Tab definitions
// ──────────────────────────────────────────────────────────────────────────────

type LinkTab = {
  type: "link";
  href: string;
  label: string;
  match: (pathname: string) => boolean;
};

type SheetTab = {
  type: "sheet";
  key: "log" | "more";
  label: string;
};

type Tab = LinkTab | SheetTab;

const TABS: Tab[] = [
  {
    type: "link",
    href: "/",
    label: "Today",
    match: (p) => p === "/",
  },
  {
    type: "link",
    href: "/calendar",
    label: "Plan",
    // Plan = /calendar OR /days only — NOT /history, /workouts, or /import
    match: (p) => p.startsWith("/calendar") || p.startsWith("/days"),
  },
  {
    type: "sheet",
    key: "log",
    label: "Log",
  },
  {
    type: "link",
    href: "/progress",
    label: "Progress",
    // Progress active for /progress, /baselines, /recap, and /compare — the
    // latter two are kinship routes (progress-comparison views) that live
    // under MoreSheet but light Progress, not More (PRD-249 §1.3).
    match: (p) =>
      p.startsWith("/progress") ||
      p.startsWith("/baselines") ||
      p.startsWith("/recap") ||
      p.startsWith("/compare"),
  },
  {
    type: "sheet",
    key: "more",
    label: "More",
  },
];

// Visual-only route match for the More sheet-trigger (PRD-249 §1.3): these six
// routes are More's own home-menu destinations, so the tab should look "lit"
// even though the sheet itself is closed. This is deliberately NOT a shared
// constant with MoreSheet.tsx's navRows (src/components/MoreSheet.tsx:98-147)
// — navRows also includes /recap and /compare, which light Progress instead
// (kinship mapping above), so "subset of navRows" isn't a clean relationship.
// Mirrors navRows MINUS /recap and /compare. If MoreSheet's destinations
// change, update this list to match.
// Deliberately excluded (not More destinations): /settings, /stats, /import,
// /workouts/[id].
const MORE_ROUTES = ["/coach", "/journal", "/character", "/goals", "/history", "/nutrition"];

// ──────────────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────────────

export function BottomNav({
  goalCount,
}: {
  goalCount: number;
}) {
  const pathname = usePathname();
  const [logOpen, setLogOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  // Close any open sheet on route change to avoid stuck backdrop on browser-back.
  // setState-in-effect is intentional here: pathname is an external signal (the
  // browser URL), not a piece of React state we own. Clearing the sheet-open
  // flag in response to a route change is the correct synchronization pattern
  // (analogous to "subscribe to an external system and call setState in the
  // callback"). The cascading render cost is negligible — two booleans → false.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLogOpen(false);
    setMoreOpen(false);
  }, [pathname]);

  return (
    <>
      <nav className="fixed bottom-0 inset-x-0 border-t border-[var(--border)] bg-[var(--card)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--card)]/80 z-40">
        <ul className="grid grid-cols-5 max-w-md mx-auto">
          {TABS.map((tab) => {
            if (tab.type === "link") {
              const active = tab.match(pathname ?? "");
              return (
                <li key={tab.href} className="flex">
                  <Link
                    href={tab.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex-1 py-3 text-sm font-medium transition-colors flex flex-col items-center gap-0.5 ${
                      active
                        ? "text-[var(--accent)]"
                        : "text-[var(--muted)] hover:text-foreground"
                    }`}
                  >
                    {/* Active: filled Bullseye; Inactive: hollow Bullseye (real glyph, not blank spacer) */}
                    {active ? (
                      <Bullseye filled size={6} aria-hidden />
                    ) : (
                      <Bullseye size={6} aria-hidden />
                    )}
                    <span>{tab.label}</span>
                  </Link>
                </li>
              );
            }

            // Sheet-trigger buttons never get aria-current/aria-pressed=route-match — only
            // real "sheet is open" reflects in aria-pressed. Route-match drives visual
            // "lit" styling only (see isOnMoreRoute); aria-pressed stays isSheetOpen.
            const isLog = tab.key === "log";
            const isSheetOpen = isLog ? logOpen : moreOpen;
            const isOnMoreRoute =
              tab.key === "more" && MORE_ROUTES.some((r) => (pathname ?? "").startsWith(r));
            const lit = isSheetOpen || isOnMoreRoute;

            return (
              <li key={tab.key} className="flex">
                <button
                  type="button"
                  onClick={() => {
                    if (isLog) {
                      setLogOpen((prev) => !prev);
                      setMoreOpen(false);
                    } else {
                      setMoreOpen((prev) => !prev);
                      setLogOpen(false);
                    }
                  }}
                  aria-pressed={isSheetOpen}
                  className={`flex-1 py-3 text-sm font-medium transition-colors flex flex-col items-center gap-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-inset ${
                    lit
                      ? "text-[var(--accent)]"
                      : "text-[var(--muted)] hover:text-foreground"
                  }`}
                >
                  {/* Show filled Bullseye when sheet is open or on a More-menu route, hollow otherwise */}
                  {lit ? (
                    <Bullseye filled size={6} aria-hidden />
                  ) : (
                    <Bullseye size={6} aria-hidden />
                  )}
                  <span>{tab.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Log sheet */}
      <BottomSheet
        open={logOpen}
        onClose={() => setLogOpen(false)}
        title="Log"
      >
        <LogLauncher
          latestWeight={null}
          onClose={() => setLogOpen(false)}
          open={logOpen}
        />
      </BottomSheet>

      {/* More sheet */}
      <BottomSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        title="More"
      >
        <MoreSheet onClose={() => setMoreOpen(false)} goalCount={goalCount} />
      </BottomSheet>
    </>
  );
}
