import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SessionMenu } from "@/components/SessionMenu";
import { auth } from "@/lib/auth/auth";

/**
 * Sticky brand strip rendered at the top of every page by `app/layout.tsx`.
 * Spans the full viewport (intentional per architecture-blueprint-v2 §C.2.3,
 * fix H4) so the brand reads on wide screens. Height is 48 px; the wordmark
 * uses both the Tailwind `font-display` utility AND inline `style.fontFamily`
 * for safety — redundancy is intentional (v2 §C.2.3). Right-aligned slot
 * holds the ThemeToggle (system / light / dark cycle) and the SessionMenu.
 */
export async function AppHeader(): Promise<React.JSX.Element> {
  const session = await auth();

  return (
    <header className="sticky top-0 z-30 bg-[var(--background)]/95 backdrop-blur border-b border-[var(--border)]">
      <div className="h-12 flex items-center px-4 gap-2">
        <Logo size={28} />
        <span
          className="font-display text-xl tracking-tight"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Goaldmine
        </span>
        <ThemeToggle />
        <SessionMenu user={session?.user ?? null} />
      </div>
    </header>
  );
}
