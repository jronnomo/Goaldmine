"use client";

import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";

export type MoreSheetProps = {
  onClose: () => void;
};

type NavRow = {
  href: string;
  label: string;
  sub: string;
  icon: React.ReactNode;
};

const GoalsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
    <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="10" cy="10" r="3.5" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="10" cy="10" r="0.75" fill="currentColor" />
  </svg>
);

const CoachIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
    <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
    <path d="M7 9c0-1.657 1.343-3 3-3s3 1.343 3 3c0 1.2-.7 2.24-1.715 2.745L11 14H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="10" cy="16" r="0.75" fill="currentColor" />
  </svg>
);

const NutritionIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
    <path d="M6 3v6a4 4 0 0 0 8 0V3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M10 13v4M8 17h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const HistoryIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
    <path d="M3 10a7 7 0 1 0 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M3 4v6h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M10 7v4l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const JournalIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
    <rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
    <path d="M7 7h6M7 10h6M7 13h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const ThemeIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
    <circle cx="10" cy="10" r="3.5" stroke="currentColor" strokeWidth="1.5" />
    <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.93 4.93l1.41 1.41M13.66 13.66l1.41 1.41M4.93 15.07l1.41-1.41M13.66 6.34l1.41-1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

// Character icon — bust silhouette (head + shoulders), 20px / stroke 1.5, house style.
// Reads as "RPG character sheet" at a glance alongside the other line icons.
const CharacterIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
    {/* Head */}
    <circle cx="10" cy="7" r="3" stroke="currentColor" strokeWidth="1.5" />
    {/* Shoulders — rounded arc that reads as a bust / character card */}
    <path
      d="M4 17c0-3.314 2.686-6 6-6s6 2.686 6 6"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);

const navRows: NavRow[] = [
  {
    href: "/character",
    label: "Character",
    sub: "RPG stats, badges, and XP history",
    icon: <CharacterIcon />,
  },
  {
    href: "/goals",
    label: "Goals",
    sub: "View goals or create a new one",
    icon: <GoalsIcon />,
  },
  {
    href: "/coach",
    label: "Coach prompts",
    sub: "Coaching tips and workout cues",
    icon: <CoachIcon />,
  },
  {
    href: "/nutrition",
    label: "Nutrition",
    sub: "Meal plan and nutrition log",
    icon: <NutritionIcon />,
  },
  {
    href: "/history",
    label: "History",
    sub: "Past workouts and sessions",
    icon: <HistoryIcon />,
  },
  {
    href: "/journal",
    label: "Journal",
    sub: "Notes, audibles, and reflections",
    icon: <JournalIcon />,
  },
];

export function MoreSheet({ onClose }: MoreSheetProps) {
  return (
    <div className="py-2">
      {navRows.map(({ href, label, sub, icon }) => (
        <Link
          key={href}
          href={href}
          onClick={onClose}
          className="flex items-center gap-3 px-4 py-3 min-h-[48px] hover:bg-[var(--border)]/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-inset"
        >
          <span className="text-[var(--accent)] shrink-0">{icon}</span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-medium text-[var(--foreground)]">{label}</span>
            <span className="block text-xs text-[var(--muted)]">{sub}</span>
          </span>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className="text-[var(--muted)] shrink-0">
            <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      ))}

      {/* Divider */}
      <div className="mx-4 my-1 border-t border-[var(--border)]" />

      {/* Theme control — label row wrapping ThemeToggle (zero-prop component) */}
      <div className="flex items-center justify-between px-4 py-3 min-h-[48px]">
        <div className="flex items-center gap-3">
          <span className="text-[var(--accent)] shrink-0">
            <ThemeIcon />
          </span>
          <span>
            <span className="block text-sm font-medium text-[var(--foreground)]">Theme</span>
            <span className="block text-xs text-[var(--muted)]">System, light, or dark</span>
          </span>
        </div>
        <ThemeToggle />
      </div>
    </div>
  );
}
