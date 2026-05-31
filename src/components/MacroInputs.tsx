const MACRO_FIELDS = [
  { name: "calories", label: "Cal", placeholder: "cal" },
  { name: "proteinG", label: "Protein", placeholder: "g" },
  { name: "carbsG", label: "Carbs", placeholder: "g" },
  { name: "fatG", label: "Fat", placeholder: "g" },
  { name: "fiberG", label: "Fiber", placeholder: "g" },
  { name: "sodiumMg", label: "Sodium", placeholder: "mg" },
] as const;

export type MacroDefaults = Partial<
  Record<"calories" | "proteinG" | "carbsG" | "fatG" | "fiberG" | "sodiumMg", number | null>
>;

/** Optional macro inputs shared by the log + edit nutrition forms. */
export function MacroInputs({ defaults }: { defaults?: MacroDefaults }) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-xs text-[var(--muted)] mb-1">Macros (optional)</legend>
      <div className="grid grid-cols-3 gap-2">
        {MACRO_FIELDS.map((f) => (
          <label key={f.name} className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
              {f.label}
            </span>
            <input
              type="number"
              name={f.name}
              min="0"
              step="any"
              inputMode="decimal"
              placeholder={f.placeholder}
              defaultValue={defaults?.[f.name] ?? undefined}
              className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-base"
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}
