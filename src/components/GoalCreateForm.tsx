"use client";

import { useState, useTransition } from "react";
import { TargetsBuilder } from "@/components/TargetsBuilder";
import { createGoal } from "@/lib/goal-actions";
import { FLAVOR_GROUPS, FLAVOR_PRESETS, type GoalFlavorKey } from "@/lib/goal-flavors";

export type CopySource = {
  id: string;
  objective: string;
  targetDate: string;
  targetCount: number;
};

export function GoalCreateForm({ copySources }: { copySources: CopySource[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copyFromGoalId, setCopyFromGoalId] = useState<string>("");
  const [flavor, setFlavor] = useState<GoalFlavorKey>("hike");
  const flavorPreset = FLAVOR_PRESETS[flavor];

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          setError(null);
          try {
            await createGoal(fd);
          } catch (e) {
            if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
            setError(e instanceof Error ? e.message : String(e));
          }
        })
      }
      className="flex flex-col gap-3"
    >
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Objective</span>
        <input
          name="objective"
          required
          maxLength={200}
          placeholder="Summit Quandary Peak"
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-base"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Target date</span>
        <input
          type="date"
          name="targetDate"
          required
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-base"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Goal flavor</span>
        <select
          name="flavor"
          value={flavor}
          onChange={(e) => setFlavor(e.target.value as GoalFlavorKey)}
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-base"
        >
          {FLAVOR_GROUPS.map((g) => (
            <optgroup key={g.heading} label={g.heading}>
              {g.keys.map((k) => (
                <option key={k} value={k}>
                  {FLAVOR_PRESETS[k].label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {flavorPreset.legend ? (
          <span className="text-xs text-[var(--muted)]">
            Calendar legend:{" "}
            {flavorPreset.legend
              .filter((e) => e.kind !== "trained")
              .map((e) => `${e.icon} ${e.label}`)
              .join("  ·  ")}
          </span>
        ) : (
          <span className="text-xs text-[var(--muted)]">
            No icons set — Claude will propose a legend in claude.ai.
          </span>
        )}
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Notes (Claude can read these)</span>
        <textarea
          name="notes"
          rows={4}
          placeholder="Any context, constraints, or sub-goals you want me to remember when coaching toward this."
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm resize-y"
        />
      </label>

      {/* Targets builder — when rows are empty the hidden input is omitted,
          allowing the copyFromGoalId path below to kick in on the server. */}
      <TargetsBuilder />

      {copySources.length > 0 && (
        <div className="rounded-lg border border-dashed border-[var(--border)] p-3 space-y-2">
          <p className="text-sm font-medium">Or import from a previous goal</p>
          <p className="text-xs text-[var(--muted)]">
            If the builder above is empty, targets will be copied verbatim from the selected goal. You can adjust on the detail page afterward.
          </p>
          <select
            name="copyFromGoalId"
            value={copyFromGoalId}
            onChange={(e) => setCopyFromGoalId(e.target.value)}
            className="w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
          >
            <option value="">— No import —</option>
            {copySources.map((g) => (
              <option key={g.id} value={g.id}>
                {g.objective} ({g.targetCount} target{g.targetCount === 1 ? "" : "s"}, due{" "}
                {new Date(g.targetDate).toLocaleDateString()})
              </option>
            ))}
          </select>
        </div>
      )}

      {error && (
        <p className="text-sm text-[var(--danger)] border border-[var(--danger)]/30 bg-[var(--danger)]/10 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-[var(--accent)] text-[var(--accent-fg)] px-4 py-2.5 font-medium disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create goal"}
      </button>
    </form>
  );
}
