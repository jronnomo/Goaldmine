import {
  type FormattableSet,
  type FormattableWorkout,
  formatDuration,
  formatStrongDateLine,
} from "./types";

function formatSetValue(s: FormattableSet): string {
  if (s.weightLb !== null && s.reps !== null) return `${s.weightLb} lb × ${s.reps}`;
  if (s.reps !== null) return `${s.reps} reps`;
  if (s.durationSec !== null) return formatDuration(s.durationSec);
  if (s.distanceMi !== null) return `${s.distanceMi} mi`;
  return "—";
}

export function formatMarkdown(w: FormattableWorkout): string {
  const lines: string[] = [];
  lines.push(`# ${w.title ?? "Workout"}`);
  lines.push(`_${formatStrongDateLine(w.startedAt)}_`);

  for (const ex of [...w.exercises].sort((a, b) => a.orderIndex - b.orderIndex)) {
    lines.push("");
    const header = ex.equipment ? `**${ex.name}** _(${ex.equipment})_` : `**${ex.name}**`;
    lines.push(header);
    for (const s of [...ex.sets].sort((a, b) => a.setIndex - b.setIndex)) {
      lines.push(`- Set ${s.setIndex}: ${formatSetValue(s)}`);
    }
    if (ex.notes) lines.push(`  > ${ex.notes}`);
  }

  if (w.notes) {
    lines.push("");
    lines.push(`**Notes:** ${w.notes}`);
  }

  if (w.sourceUrl) {
    lines.push("");
    lines.push(`Source: ${w.sourceUrl}`);
  }

  return lines.join("\n") + "\n";
}
