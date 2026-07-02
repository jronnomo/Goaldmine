import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SessionMenu } from "@/components/SessionMenu";

interface AppHeaderProps {
  /** Resolved from auth() in the root layout. null when signed out or during static prerender. */
  user?: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  } | null;
}

/**
 * Sticky brand strip rendered at the top of every page by `app/layout.tsx`.
 * Spans the full viewport (intentional per architecture-blueprint-v2 §C.2.3,
 * fix H4) so the brand reads on wide screens. Height is 48 px; the wordmark
 * uses both the Tailwind `font-display` utility AND inline `style.fontFamily`
 * for safety — redundancy is intentional (v2 §C.2.3). Right-aligned slot
 * holds the ThemeToggle (system / light / dark cycle) and the SessionMenu.
 *
 * A-2: session is now resolved in the root layout (single auth() call per
 * request) and passed down via the `user` prop. AppHeader no longer calls
 * auth() itself — this prevents a double-fetch and, critically, avoids a
 * throw during static prerender of public pages (/signin, /request-access)
 * where UntrustedHost would otherwise produce a NEXT_REDIRECT in the
 * pre-rendered output.
 */
export function AppHeader({ user = null }: AppHeaderProps): React.JSX.Element {
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
        <SessionMenu user={user} />
      </div>
    </header>
  );
}
