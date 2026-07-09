"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bullseye } from "@/components/Bullseye";
import { BottomSheet } from "@/components/BottomSheet";
import { LogLauncher } from "@/components/LogLauncher";
import { MoreSheet } from "@/components/MoreSheet";
import type { TodayMealLite } from "@/app/layout";
import type { LibraryFood } from "@/lib/food-types";
import type { DayMacros } from "@/lib/nutrition-macros";

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
    // Progress active for /progress, /baselines (those pages are sub-routes of Progress)
    match: (p) =>
      p.startsWith("/progress") ||
      p.startsWith("/baselines") ||
      p.startsWith("/recap"),
  },
  {
    type: "sheet",
    key: "more",
    label: "More",
  },
];

// ──────────────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────────────

export function BottomNav({
  todaysMeals,
  quickPickFoods,
  libraryFoods,
  trackedSoFar,
  dayTarget,
  goalCount,
}: {
  todaysMeals?: TodayMealLite[];
  quickPickFoods?: LibraryFood[];
  libraryFoods?: LibraryFood[];
  trackedSoFar?: DayMacros;
  dayTarget?: DayMacros | null;
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

            // Sheet-trigger buttons — never show "active/page" state
            const isLog = tab.key === "log";
            const isSheetOpen = isLog ? logOpen : moreOpen;

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
                    isSheetOpen
                      ? "text-[var(--accent)]"
                      : "text-[var(--muted)] hover:text-foreground"
                  }`}
                >
                  {/* Show filled Bullseye when sheet is open, hollow when closed */}
                  {isSheetOpen ? (
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
          todaysMeals={todaysMeals}
          quickPickFoods={quickPickFoods}
          libraryFoods={libraryFoods}
          trackedSoFar={trackedSoFar}
          dayTarget={dayTarget}
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
