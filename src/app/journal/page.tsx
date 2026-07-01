import Link from "next/link";
import { Card } from "@/components/Card";
import { LogNoteForm } from "@/components/LogNoteForm";
import { PendingNotes } from "@/components/PendingNotes";
import { getPendingNotesCount } from "@/lib/calendar";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function JournalPage() {
  const db = await getDb();
  const [pending, allNotes] = await Promise.all([
    getPendingNotesCount(),
    db.note.findMany({ orderBy: { date: "desc" }, take: 50 }),
  ]);

  // "Needs review" = unresolved audibles/feedback — the notes that call for a
  // coaching decision. Matches getPendingNotesCount's tightened definition.
  const ACTIONABLE_TYPES = new Set(["audible", "feedback"]);
  const needsReview = allNotes.filter(
    (n) => n.resolvedAt === null && ACTIONABLE_TYPES.has(n.type),
  );
  // Everything else stays visible in the log: journals, standing rules, and
  // resolved notes (the resolved ones are dimmed below).
  const otherNotes = allNotes.filter(
    (n) => !(n.resolvedAt === null && ACTIONABLE_TYPES.has(n.type)),
  );

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <header className="space-y-1 pt-2">
        <h1 className="text-2xl font-semibold tracking-tight">Journal</h1>
        <p className="text-sm text-[var(--muted)]">
          Audibles, journals, and feedback. Claude reads these when coaching.
        </p>
      </header>

      <Card title="Log a note">
        <p className="text-xs text-[var(--muted)] mb-2">
          Free-form. Type tags it for Claude (Journal / Audible / Feedback).
        </p>
        {allNotes.length === 0 && pending.count === 0 && (
          <p className="text-sm text-[var(--muted)] mb-2">
            <strong className="font-semibold text-[var(--foreground)]">The journal&apos;s clean.</strong>{" "}
            Drop a note here for instructions, feelings, or tomorrow&apos;s reminder.
          </p>
        )}
        <LogNoteForm />
      </Card>

      {pending.goalId && needsReview.length > 0 && (
        <Card
          title={`${needsReview.length} note${needsReview.length === 1 ? "" : "s"} to review`}
          action={
            <Link href={`/goals/${pending.goalId}`} className="text-sm text-[var(--accent)]">
              Goal →
            </Link>
          }
        >
          <p className="text-xs text-[var(--muted)] mb-2">
            Audibles and feedback awaiting a coaching decision — Claude resolves these
            when you review them together, or you can act on them on the goal.
          </p>
          <PendingNotes notes={needsReview} goalId={pending.goalId} />
        </Card>
      )}

      {otherNotes.length > 0 && (
        <Card title="Notes">
          <ul className="space-y-2 text-sm">
            {otherNotes.map((n) => (
              <li
                key={n.id}
                className={`border-l-2 border-[var(--border)] pl-3 ${n.resolvedAt ? "opacity-60" : ""}`}
              >
                <p className="text-[var(--muted)] text-xs">
                  {new Date(n.date).toLocaleString()} · {n.type}
                  {n.resolvedAt ? " · resolved" : ""}
                  {n.resolvedReason ? ` · ${n.resolvedReason}` : ""}
                </p>
                <p className="whitespace-pre-wrap">{n.body}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
