"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bullseye } from "@/components/Bullseye";

const tabs = [
  { href: "/", label: "Today", match: (p: string) => p === "/" },
  {
    href: "/calendar",
    label: "Calendar",
    match: (p: string) =>
      p.startsWith("/calendar") ||
      p.startsWith("/days") ||
      p.startsWith("/history") ||
      p.startsWith("/workouts") ||
      p.startsWith("/import"),
  },
  { href: "/baselines", label: "Records", match: (p: string) => p.startsWith("/baselines") },
  { href: "/goals", label: "Goals", match: (p: string) => p.startsWith("/goals") },
  { href: "/journal", label: "Journal", match: (p: string) => p.startsWith("/journal") },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed bottom-0 inset-x-0 border-t border-[var(--border)] bg-[var(--card)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--card)]/80 z-40">
      <ul className="grid grid-cols-5 max-w-md mx-auto">
        {tabs.map((t) => {
          const active = t.match(pathname ?? "");
          return (
            <li key={t.href} className="flex">
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`flex-1 py-3 text-sm font-medium transition-colors flex flex-col items-center gap-0.5 ${
                  active ? "text-[var(--accent)]" : "text-[var(--muted)] hover:text-foreground"
                }`}
              >
                {active ? (
                  <Bullseye filled size={6} aria-hidden />
                ) : (
                  <span className="h-[6px] block" aria-hidden />
                )}
                <span>{t.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
