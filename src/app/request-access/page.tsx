// src/app/request-access/page.tsx
// A-3: Public page shown when an unauthenticated visitor is rejected by the invite gate.
// #223: now dynamic — prefills the email from ?email= (set by auth.ts's signIn
// callback redirect) and renders a real request form (submitAccessRequest)
// instead of a mailto link. Branded card matching /signin styling.

import { Logo } from "@/components/Logo";
import Link from "next/link";
import { AccessRequestForm } from "@/components/AccessRequestForm";

export const dynamic = "force-dynamic";

interface RequestAccessPageProps {
  searchParams: Promise<{ email?: string }>;
}

export default async function RequestAccessPage({ searchParams }: RequestAccessPageProps) {
  // Next 16: searchParams is a Promise — must be awaited.
  const { email } = await searchParams;

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
            We&apos;re in a closed beta. Leave your email below and we&apos;ll
            reach out as soon as a spot opens up.
          </p>

          <AccessRequestForm defaultEmail={email} />

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
