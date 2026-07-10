"use client";

import { ExerciseRow } from "@/components/day-editor/ExerciseRow";
import type { BlockEditState, ExerciseFieldName } from "@/lib/day-template-edit";
import type { Block } from "@/lib/program-template";

const BLOCK_TYPE_LABEL: Record<Block["type"], string> = {
  straight: "Straight sets",
  superset: "Superset",
  finisher: "Finisher",
  mobility: "Mobility",
  cardio: "Cardio",
};

function chromeLine(chrome: BlockEditState["chrome"]): string {
  const parts = [chrome.label ?? BLOCK_TYPE_LABEL[chrome.type], BLOCK_TYPE_LABEL[chrome.type]];
  if (chrome.rounds) parts.push(`${chrome.rounds} rounds`);
  if (chrome.restSec) parts.push(`rest ${chrome.restSec}s`);
  // Dedupe when label already equals the type label.
  return [...new Set(parts)].join(" · ");
}

export function BlockCard({
  blockEdit,
  baseBlock,
  onFieldChange,
  onToggleSkip,
}: {
  blockEdit: BlockEditState;
  /** The aligned base block (undefined for foreign blocks — every exercise
   * inside is then necessarily foreign too, so ExerciseRow never needs it). */
  baseBlock: Block | undefined;
  onFieldChange: (exArrIdx: number, field: ExerciseFieldName, value: string) => void;
  onToggleSkip: (exArrIdx: number) => void;
}) {
  return (
    <div
      data-testid="dwe-block-card"
      className="rounded-2xl border border-[var(--border)] bg-[var(--card)] px-3 py-3"
    >
      {/* Read-only chrome band — non-bordered typography, never mistakable for
          a pressable field (UXR-235-17). */}
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] mb-2">
        {chromeLine(blockEdit.chrome)}
      </p>

      {blockEdit.exercises.map((ex, ei) => (
        <ExerciseRow
          key={ex._key}
          ex={ex}
          baseEx={ex.foreign ? undefined : baseBlock?.exercises[ex.exIdx]}
          onFieldChange={(field, value) => onFieldChange(ei, field, value)}
          onToggleSkip={() => onToggleSkip(ei)}
        />
      ))}
    </div>
  );
}
