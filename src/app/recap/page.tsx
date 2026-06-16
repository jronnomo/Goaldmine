// src/app/recap/page.tsx
// Server component — builds week-label list and renders the client shell.
// Per ADDENDUM §C: no Date or WeeklyRecap is passed to RecapClient.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { weekRangeLabel } from "@/lib/recap";
import { RecapClient } from "@/components/RecapClient";

export default function RecapPage() {
  const now = new Date();
  // Build 13 week entries (current week + 12 past weeks) with server-computed labels.
  const weeks = Array.from({ length: 13 }, (_, i) => ({
    offset: -i,
    label: weekRangeLabel(now, -i),
  }));

  return (
    <main className="max-w-md mx-auto p-4 space-y-4">
      <header className="pt-2">
        <h1 className="text-2xl font-semibold tracking-tight">Weekly Recap</h1>
      </header>
      <RecapClient weeks={weeks} />
    </main>
  );
}
