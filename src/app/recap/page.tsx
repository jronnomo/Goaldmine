// src/app/recap/page.tsx
// Server component — builds week-label list, queries posted weeks, and renders the client shell.
// Per ADDENDUM §C: no Date or WeeklyRecap is passed to RecapClient.
// CRIT-2: only plain numbers (postedWeeks: number[]) cross to the client — no Date objects.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { weekRangeLabel } from "@/lib/recap";
import {
  startOfWeekMonday,
  endOfWeekSunday,
  addDays,
  bucketDatesToWeekOffsets,
} from "@/lib/calendar";
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
  // Full 13-week window as [oldest Monday 00:00, newest Sunday 23:59:59.999],
  // shared by the postedWeeks and weeksWithData queries below.
  const windowStart = mondays[12]!;
  const windowEnd = endOfWeekSunday(mondays[0]!);

  const db = await getDb();

  // Query shared_recap notes in the 13-week window.
  const postedNotes = await db.note.findMany({
    where: {
      type: "shared_recap",
      targetDate: { gte: windowStart, lte: windowEnd },
    },
    select: { targetDate: true },
  });
  // CRIT-2: no Date objects cross to client — only numbers.
  const postedWeeks: number[] = bucketDatesToWeekOffsets(
    postedNotes.map((n) => n.targetDate).filter((d): d is Date => d !== null),
    mondays,
  );

  // #231: weeksWithData is an IMAGE-MOUNT gate for RecapClient — independent of,
  // and broader than, recap.ts's `emptyWeek` (which stays workout/hike-only by
  // design; see recap.ts:538). It answers "did the user log anything at all
  // this week, across every model the recap card can draw from" so the client
  // never mounts /recap/card (or fetches /recap/highlights) for a week that
  // would only render a zero card. Model set + field/status choices verified
  // against recap.ts's own query shapes (PRD-231 §1.2 premise correction):
  //   - workout: status "completed", startedAt (recap.ts:345-348)
  //   - hike: status "completed", date (recap.ts:352-355)
  //   - baseline: date, no status column (recap.ts:614-615)
  //   - logEntry: date (project metric logs, recap.ts:369-374, all-goals here)
  //   - scheduledItem: completedAt non-null (project completions, recap.ts:376-390)
  const [weekWorkouts, weekHikes, weekBaselines, weekLogEntries, weekScheduledItems] =
    await Promise.all([
      db.workout.findMany({
        where: { status: "completed", startedAt: { gte: windowStart, lte: windowEnd } },
        select: { startedAt: true },
      }),
      db.hike.findMany({
        where: { status: "completed", date: { gte: windowStart, lte: windowEnd } },
        select: { date: true },
      }),
      db.baseline.findMany({
        where: { date: { gte: windowStart, lte: windowEnd } },
        select: { date: true },
      }),
      db.logEntry.findMany({
        where: { date: { gte: windowStart, lte: windowEnd } },
        select: { date: true },
      }),
      db.scheduledItem.findMany({
        where: { completedAt: { gte: windowStart, lte: windowEnd } },
        select: { completedAt: true },
      }),
    ]);

  const dataDates: Date[] = [
    ...weekWorkouts.map((w) => w.startedAt),
    ...weekHikes.map((h) => h.date),
    ...weekBaselines.map((b) => b.date),
    ...weekLogEntries.map((l) => l.date),
    ...weekScheduledItems
      .map((s) => s.completedAt)
      .filter((d): d is Date => d !== null),
  ];
  // CRIT-2: no Date objects cross to client — only numbers.
  const weeksWithData: number[] = bucketDatesToWeekOffsets(dataDates, mondays);

  return (
    <main className="max-w-md mx-auto p-4 space-y-4">
      <header className="pt-2">
        <h1 className="text-2xl font-semibold tracking-tight">Weekly Recap</h1>
      </header>
      <RecapClient weeks={weeks} postedWeeks={postedWeeks} weeksWithData={weeksWithData} />
    </main>
  );
}
