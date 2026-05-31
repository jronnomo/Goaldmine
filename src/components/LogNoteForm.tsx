"use client";

import { useState } from "react";
import { logNote } from "@/lib/workout-actions";
import { useFormFeedback } from "@/lib/use-form-feedback";

const NOTE_TYPES = [
  {
    value: "journal",
    label: "Journal",
    description:
      "Default daily entry. How you felt, energy, sleep, stray thoughts. Stored in the Note table with type=journal — Claude reads recent journals when coaching.",
  },
  {
    value: "audible",
    label: "Audible",
    description:
      "A change to the plan. Swapped exercises, took an extra rest day, modified due to soreness/injury. Type=audible. Claude uses these to understand why the program may have drifted.",
  },
  {
    value: "feedback",
    label: "Feedback",
    description:
      "Coaching feedback — usually written by Claude after weekly reviews, or by you reflecting on a phase. Type=feedback. Surfaces in /history and weekly summaries.",
  },
  {
    value: "standing_rule",
    label: "Standing rule",
    description:
      "A persistent coaching rule (e.g. \"prescribe = log\", \"never push deload week\"). Type=standing_rule. Auto-surfaces in every get_today_plan response so Claude can't forget it across sessions. Prefix bodies with \"RULE:\" or \"STANDING:\" to make future automated promotion catches them.",
  },
] as const;

type NoteType = (typeof NOTE_TYPES)[number]["value"];

export function LogNoteForm() {
  const { pending, error, saved, formRef, submit } = useFormFeedback();
  const [type, setType] = useState<NoteType>("journal");

  const active = NOTE_TYPES.find((t) => t.value === type)!;

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        submit(logNote, {
          successMsg: "✓ Note saved",
          onSuccess: () => setType("journal"),
        });
      }}
      className="flex flex-col gap-2"
    >
      <textarea
        name="body"
        required
        rows={3}
        placeholder="How did it feel? Audibles, soreness, energy…"
        className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-base resize-y min-h-[72px]"
      />
      <div className="flex gap-2 items-center">
        <select
          name="type"
          value={type}
          onChange={(e) => setType(e.target.value as NoteType)}
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
        >
          {NOTE_TYPES.map((t) => (
            <option key={t.value} value={t.value} title={t.description}>
              {t.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={pending}
          className="ml-auto rounded-lg bg-[var(--accent)] text-[var(--accent-fg)] px-4 py-2 font-medium disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save note"}
        </button>
      </div>
      {/* Reserved height prevents layout shift whether saved, error, or empty */}
      <p className="text-xs min-h-[1rem]" aria-live="polite">
        {saved && <span className="text-[var(--success)]">{saved}</span>}
        {error && !saved && <span className="text-[var(--danger)]">{error}</span>}
      </p>
      <p className="text-xs text-[var(--muted)]">
        <span className="font-medium text-foreground">{active.label}:</span> {active.description}
      </p>
    </form>
  );
}
