// src/app/recap/page.tsx
// Server component — builds week-label list, queries posted weeks, and renders the client shell.
// Per ADDENDUM §C: no Date or WeeklyRecap is passed to RecapClient.
// CRIT-2: only plain numbers (postedWeeks: number[]) cross to the client — no Date objects.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { weekRangeLabel } from "@/lib/recap";
import { startOfWeekMonday, addDays, dateKey } from "@/lib/calendar";
import { getDb } from "@/lib/db";
import { RecapClient } from "@/components/RecapClient";

export default async function RecapPage() {
  const now = new Date();
  const thisMonday = startOfWeekMonday(now);

  // Build 13 week entries (current week + 12 past weeks) with server-computed labels.
  const weeks = Array.from({ length: 13 }, (_, i) => ({
    offset: -i,
    label: weekRangeLabel(now, -i),
  }));

  // Precompute the 13 Mondays in the same order as `weeks`:
  // mondays[0] = current week's Monday (offset 0)
  // mondays[i] = offset -i Monday
  const mondays = Array.from({ length: 13 }, (_, i) =>
    addDays(thisMonday, -i * 7),
  );

  // Query shared_recap notes in the 13-week window
  // [mondays[12], mondays[0]] = [oldest Monday, newest Monday]
  const db = await getDb();
  const postedNotes = await db.note.findMany({
    where: {
      type: "shared_recap",
      targetDate: {
        gte: mondays[12], // monday(-12) — oldest
        lte: mondays[0], // monday(0)  — current
      },
    },
    select: { targetDate: true },
  });

  // Map each note's targetDate → offset via dateKey equality.
  // Use a Set to dedup (handles rare duplicate rows for same Monday).
  // CRIT-2: no Date objects cross to client — only numbers.
  const postedWeekSet = new Set<number>();
  for (const note of postedNotes) {
    if (!note.targetDate) continue;
    const noteDk = dateKey(note.targetDate);
    const matchIdx = mondays.findIndex((m) => dateKey(m) === noteDk);
    if (matchIdx !== -1) {
      postedWeekSet.add(-matchIdx); // offset = -(index into mondays)
    }
  }
  const postedWeeks: number[] = [...postedWeekSet];

  return (
    <main className="max-w-md mx-auto p-4 space-y-4">
      <header className="pt-2">
        <h1 className="text-2xl font-semibold tracking-tight">Weekly Recap</h1>
      </header>
      <RecapClient weeks={weeks} postedWeeks={postedWeeks} />
    </main>
  );
}
