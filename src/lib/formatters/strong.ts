import {
  type FormattableSet,
  type FormattableWorkout,
  formatDuration,
  formatStrongDateLine,
} from "./types";

// NOTE (B2/#265): FormattableExercise/FormattableSet carry `id`, `rpe`, and
// (set-level) `notes`, but this formatter deliberately does NOT render them.
// This format must stay byte-identical to the real Strong-app txt export so
// it round-trips through parseStrongWorkout (src/lib/parsers/strong.ts),
// whose line grammar is strict: any non-empty, non-URL line that isn't
// "Set N: <value>" is parsed as a NEW exercise header. Printing an id/RPE/
// notes line (or appending it to a set line) would either corrupt parsing or
// silently change re-imported data. Use format:"json" or "markdown"/"plain"
// to read ids, rpe, or set notes.

function formatSetValue(s: FormattableSet): string {
  if (s.weightLb !== null && s.reps !== null) return `${trimWeight(s.weightLb)} lb × ${s.reps}`;
  if (s.reps !== null) return `${s.reps} reps`;
  if (s.durationSec !== null) return formatDuration(s.durationSec);
  if (s.distanceMi !== null) return `${s.distanceMi} mi`;
  return "—";
}

function trimWeight(w: number): string {
  return Number.isInteger(w) ? String(w) : String(w);
}

export function formatStrong(w: FormattableWorkout): string {
  const lines: string[] = [];
  lines.push(w.title ?? "Workout");
  lines.push(formatStrongDateLine(w.startedAt));

  for (const ex of [...w.exercises].sort((a, b) => a.orderIndex - b.orderIndex)) {
    lines.push("");
    lines.push(ex.equipment ? `${ex.name} (${ex.equipment})` : ex.name);
    for (const s of [...ex.sets].sort((a, b) => a.setIndex - b.setIndex)) {
      lines.push(`Set ${s.setIndex}: ${formatSetValue(s)}`);
    }
  }

  if (w.sourceUrl) {
    lines.push(w.sourceUrl);
  }

  return lines.join("\n") + "\n";
}
