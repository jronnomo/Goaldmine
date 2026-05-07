import Link from "next/link";
import { Card } from "@/components/Card";
import { LogNoteForm } from "@/components/LogNoteForm";
import { PendingNotes } from "@/components/PendingNotes";
import { getPendingNotesCount } from "@/lib/calendar";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function JournalPage() {
  const [pending, allNotes] = await Promise.all([
    getPendingNotesCount(),
    prisma.note.findMany({ orderBy: { date: "desc" }, take: 50 }),
  ]);

  const pendingNotes = allNotes.filter((n) => n.resolvedAt === null);
  const olderNotes = allNotes.filter((n) => n.resolvedAt !== null);

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

      {pending.goalId && (
        <Card
          title={
            pending.count > 0
              ? `${pending.count} pending note${pending.count === 1 ? "" : "s"}`
              : "Pending notes"
          }
          action={
            <Link href={`/goals/${pending.goalId}`} className="text-sm text-[var(--accent)]">
              Goal →
            </Link>
          }
        >
          <PendingNotes notes={pendingNotes} goalId={pending.goalId} />
        </Card>
      )}

      {olderNotes.length > 0 && (
        <Card title="Resolved notes">
          <ul className="space-y-2 text-sm">
            {olderNotes.map((n) => (
              <li key={n.id} className="border-l-2 border-[var(--border)] pl-3 opacity-60">
                <p className="text-[var(--muted)] text-xs">
                  {new Date(n.date).toLocaleString()} · {n.type}
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
