import { redirect } from "next/navigation";
import { Card } from "@/components/Card";
import { getDb } from "@/lib/db";
import { OnboardingGoalForm } from "@/components/OnboardingGoalForm";
import { skipOnboarding } from "@/lib/onboarding-actions";

export const dynamic = "force-dynamic";

/**
 * /onboarding — guided first-goal creation for brand-new users.
 *
 * Auth gate: getDb() calls getCurrentUserId() internally → redirect("/signin")
 * when no session is active (same chain every existing page uses).
 *
 * Loop-safety (OUTBOUND only): if the user already has ≥1 goal they don't
 * belong here — bounce them back to Today. This page NEVER runs a
 * "0 goals → /onboarding" check; that gate lives in src/app/page.tsx (Today).
 */
export default async function OnboardingPage() {
  // auth gate: getDb() calls getCurrentUserId() → redirect("/signin") if no session
  const db = await getDb();

  // Loop-safety guard: a returning user with goals must never linger on onboarding.
  const goalCount = await db.goal.count();
  if (goalCount > 0) redirect("/");

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <Card>
        <div className="space-y-1 mb-4">
          <h1 className="text-2xl font-semibold tracking-tight">Welcome to Goaldmine 👋</h1>
          <p className="text-sm text-[var(--muted)]">
            A goal gives your coach context — what you&apos;re chasing, by when.
            Let&apos;s set one up.
          </p>
        </div>

        <OnboardingGoalForm />
      </Card>

      {/* Skip affordance — plain server-action form, works without JS */}
      <form action={skipOnboarding} className="text-center">
        <button
          type="submit"
          className="text-sm text-[var(--muted)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded min-h-[44px] px-4"
        >
          Skip for now
        </button>
      </form>
    </div>
  );
}
