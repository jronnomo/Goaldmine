// src/components/progress/JumpChips.tsx
//
// The non-sticky anchor-chip row (R12 / UXR-PROG-54): plain <a href="#…">,
// scrolls away with the page — a second sticky bar would be 13% of the fold
// on top of the 49px AppHeader. Chips are 44px (⚑ UXR-PROG-55: the
// touch-target invariant outranks the ⚠[32–40] estimate). Smooth scrolling is
// scoped to /progress via globals.css (UXR-PROG-89 ⚑ resolved: SCOPED — the
// global layout.tsx line was NOT approved); targets carry scroll-mt-16
// (UXR-PROG-56, clears the sticky header).
//
// Server component.

export type JumpChip = { href: string; label: string };

export function JumpChips({ chips }: { chips: JumpChip[] }) {
  if (chips.length === 0) return null;
  return (
    <nav aria-label="Page sections" data-testid="progress-jump-chips">
      <ul className="flex gap-2 overflow-x-auto list-none p-0 -mx-1 px-1">
        {chips.map((c) => (
          <li key={c.href} className="shrink-0">
            <a
              href={c.href}
              className="flex h-11 items-center rounded-full border border-[var(--border)] bg-[var(--card)] px-3.5 text-sm text-[var(--muted)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              {c.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
