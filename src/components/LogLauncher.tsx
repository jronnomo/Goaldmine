"use client";

import { useState } from "react";
import Link from "next/link";
import { LogMeasurementForm } from "@/components/LogMeasurementForm";
import { LogNutritionForm } from "@/components/LogNutritionForm";
import { LogNoteForm } from "@/components/LogNoteForm";

export type LogLauncherProps = {
  /** Latest recorded weight in lb, or null. Passed to LogMeasurementForm as defaultValue.
   *  Defaults to null (weight input starts empty — by design; BottomNav cannot query Prisma). */
  latestWeight?: number | null;
  onClose: () => void;
};

type ExpandedRow = "weight" | "meal" | "note" | null;

type RowConfig = {
  key: ExpandedRow & string;
  label: string;
  sub: string;
  icon: React.ReactNode;
};

const ChevronDown = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ChevronUp = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path d="M4 10l4-4 4 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const rows: RowConfig[] = [
  {
    key: "weight",
    label: "Weight",
    sub: "Log today's weigh-in",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M10 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" stroke="currentColor" strokeWidth="1.5" />
        <path d="M5 17a5 5 0 0 1 10 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: "meal",
    label: "Meal",
    sub: "Log what you ate",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M6 3v6a4 4 0 0 0 8 0V3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M10 13v4M8 17h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: "note",
    label: "Note",
    sub: "Journal, audible, or feedback",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
        <rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7 7h6M7 10h6M7 13h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
];

const ImportIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
    <path d="M3 13v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M10 3v10M7 10l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function LogLauncher({ latestWeight = null, onClose }: LogLauncherProps) {
  const [expanded, setExpanded] = useState<ExpandedRow>(null);

  const toggle = (key: ExpandedRow & string) => {
    setExpanded((prev) => (prev === key ? null : key));
  };

  return (
    <div className="py-2">
      {rows.map(({ key, label, sub, icon }) => {
        const isOpen = expanded === key;
        return (
          <div key={key}>
            {/* Row button — ≥48px tap target */}
            <button
              type="button"
              onClick={() => toggle(key)}
              aria-expanded={isOpen}
              className="w-full flex items-center gap-3 px-4 py-3 min-h-[48px] text-left hover:bg-[var(--border)]/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-inset"
            >
              <span className="text-[var(--accent)] shrink-0">{icon}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-[var(--foreground)]">{label}</span>
                <span className="block text-xs text-[var(--muted)]">{sub}</span>
              </span>
              <span className="text-[var(--muted)] shrink-0">
                {isOpen ? <ChevronUp /> : <ChevronDown />}
              </span>
            </button>

            {/* Inline expanded form */}
            {isOpen && (
              <div className="px-4 pb-4 pt-1 border-t border-[var(--border)]">
                {key === "weight" && <LogMeasurementForm latestWeight={latestWeight} />}
                {key === "meal" && <LogNutritionForm />}
                {key === "note" && <LogNoteForm />}
              </div>
            )}
          </div>
        );
      })}

      {/* Import row — Link, not a button */}
      <Link
        href="/import"
        onClick={onClose}
        className="flex items-center gap-3 px-4 py-3 min-h-[48px] hover:bg-[var(--border)]/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-inset"
      >
        <span className="text-[var(--accent)] shrink-0">
          <ImportIcon />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-[var(--foreground)]">Import</span>
          <span className="block text-xs text-[var(--muted)]">Paste a Strong-app export</span>
        </span>
      </Link>
    </div>
  );
}
