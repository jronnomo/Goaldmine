import {
  type FormattableSet,
  type FormattableWorkout,
  formatDuration,
  formatStrongDateLine,
} from "./types";

function formatSetValue(s: FormattableSet): string {
  if (s.weightLb !== null && s.reps !== null) return `${s.weightLb} lb x ${s.reps}`;
  if (s.reps !== null) return `${s.reps} reps`;
  if (s.durationSec !== null) return formatDuration(s.durationSec);
  if (s.distanceMi !== null) return `${s.distanceMi} mi`;
  return "-";
}

export function formatPlain(w: FormattableWorkout): string {
  const lines: string[] = [];
  lines.push(w.title ?? "Workout");
  lines.push(formatStrongDateLine(w.startedAt));

  for (const ex of [...w.exercises].sort((a, b) => a.orderIndex - b.orderIndex)) {
    lines.push("");
    const header = ex.equipment ? `${ex.name} (${ex.equipment})` : ex.name;
    lines.push(`${header} [id: ${ex.id}]`);
    for (const s of [...ex.sets].sort((a, b) => a.setIndex - b.setIndex)) {
      const rpe = s.rpe !== null ? `, RPE ${s.rpe}` : "";
      lines.push(`  Set ${s.setIndex}: ${formatSetValue(s)}${rpe} [id: ${s.id}]`);
      if (s.notes) lines.push(`  Note: ${s.notes}`);
    }
    if (ex.notes) lines.push(`  Note: ${ex.notes}`);
  }

  if (w.notes) {
    lines.push("");
    lines.push(`Notes: ${w.notes}`);
  }

  if (w.sourceUrl) {
    lines.push("");
    lines.push(w.sourceUrl);
  }

  return lines.join("\n") + "\n";
}
