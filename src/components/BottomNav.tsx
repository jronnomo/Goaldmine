"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/", label: "Today", match: (p: string) => p === "/" },
  { href: "/history", label: "History", match: (p: string) => p.startsWith("/history") || p.startsWith("/workouts") || p.startsWith("/import") },
  { href: "/baselines", label: "Records", match: (p: string) => p.startsWith("/baselines") },
  { href: "/goals", label: "Goals", match: (p: string) => p.startsWith("/goals") },
  { href: "/stats", label: "Stats", match: (p: string) => p.startsWith("/stats") },
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
                className={`flex-1 text-center py-3 text-sm font-medium transition-colors ${
                  active ? "text-[var(--accent)]" : "text-[var(--muted)] hover:text-foreground"
                }`}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
