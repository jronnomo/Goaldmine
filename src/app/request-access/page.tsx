// src/app/request-access/page.tsx
// A-3: Public page shown when an unauthenticated visitor is rejected by the invite gate.
// Static — no form. Branded card matching /signin styling.

import { Logo } from "@/components/Logo";
import Link from "next/link";

export const dynamic = "force-static";

export default function RequestAccessPage() {
  return (
    <div className="min-h-[calc(100vh-48px)] flex items-center justify-center px-4 py-12">
      <div
        className="w-full rounded-2xl border border-[var(--border)] bg-[var(--background)] p-8 shadow-lg"
        style={{
          maxWidth: 390,
          boxShadow: "0 4px 32px 0 rgba(0,0,0,0.10)",
        }}
      >
        {/* Brand */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <Logo size={56} />
          <h1
            className="font-display text-3xl tracking-tight text-[var(--foreground)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Goaldmine
          </h1>
        </div>

        {/* Message */}
        <div className="flex flex-col items-center gap-4 text-center">
          <p className="text-base font-medium text-[var(--foreground)]">
            Goaldmine is invite-only right now.
          </p>
          <p className="text-sm text-[var(--muted)] leading-relaxed">
            We&apos;re in a closed beta. If you&apos;d like access, send a quick
            note and we&apos;ll be in touch.
          </p>

          {/* Request access mailto */}
          <a
            href="mailto:ggronnii@gmail.com?subject=Goaldmine%20access%20request"
            className="mt-2 inline-flex items-center justify-center rounded-xl bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            Request access
          </a>

          {/* Back link */}
          <Link
            href="/signin"
            className="text-sm text-[var(--muted)] underline underline-offset-2 hover:text-[var(--foreground)] transition-colors"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
