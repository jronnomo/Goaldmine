// BlockCard / ExerciseRow — SERVER COMPONENTS
// Extracted verbatim from src/app/page.tsx (UXR-TIA-29 — 53 lines out, zero
// behavioural risk). Renders one prescription block as a Card, or the bare
// exercise rows for hosts that provide their own shell (the SessionDossier's
// <details> rows and the deferred Tier-3 lid).

import { Card } from "@/components/Card";
import type { Block, ExercisePrescription } from "@/lib/program-template";
import { blockTypeLabel, formatSecs } from "@/lib/plan-format";

export function BlockCard({ block, index }: { block: Block; index: number | null }) {
  const blockTitle = block.label ?? defaultBlockLabel(block.type);
  // A 0-based ordinal renders a "N. " prefix (the numbered flat-stack idiom).
  // Pass null to drop the prefix — the today-page-ia tier grammar deletes the
  // numbered stack, so lid-hosted blocks render unnumbered (UXR-TIA-75 class).
  const prefix = index === null ? "" : `${index + 1}. `;
  return (
    <Card title={`${prefix}${blockTitle}`}>
      <BlockMetaLine block={block} />
      <ul className="space-y-2">
        {block.exercises.map((ex, i) => (
          <ExerciseRow key={i} ex={ex} />
        ))}
      </ul>
    </Card>
  );
}

/** The "STRENGTH · 3 rounds · 90s rest" eyebrow line, shared by Card and bare hosts. */
export function BlockMetaLine({ block }: { block: Block }) {
  return (
    <p className="text-xs uppercase tracking-wide text-[var(--muted)] mb-2">
      {blockTypeLabel(block.type)}
      {block.rounds ? ` · ${block.rounds} rounds` : ""}
      {block.restSec ? ` · ${block.restSec}s rest` : ""}
    </p>
  );
}

export function ExerciseRow({ ex }: { ex: ExercisePrescription }) {
  const parts: string[] = [];
  if (ex.sets) parts.push(`${ex.sets} set${ex.sets === 1 ? "" : "s"}`);
  if (ex.reps !== undefined) parts.push(`× ${ex.reps}`);
  if (ex.durationSec) parts.push(formatSecs(ex.durationSec));
  if (ex.weightHint) parts.push(ex.weightHint);

  return (
    <li>
      <p className="font-medium">
        {ex.name}
        {ex.equipment ? (
          <span className="text-[var(--muted)] font-normal"> · {ex.equipment}</span>
        ) : null}
      </p>
      {parts.length > 0 && <p className="text-sm text-[var(--muted)]">{parts.join(" · ")}</p>}
      {ex.notes && <p className="text-xs text-[var(--muted)] italic">{ex.notes}</p>}
    </li>
  );
}

export function defaultBlockLabel(t: Block["type"]): string {
  switch (t) {
    case "straight":
      return "Strength";
    case "superset":
      return "Superset";
    case "finisher":
      return "Finisher";
    case "mobility":
      return "Mobility";
    case "cardio":
      return "Cardio";
  }
}
