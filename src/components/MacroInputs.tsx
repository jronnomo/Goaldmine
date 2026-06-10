/**
 * MacroInputs — six optional macro fields shared by Log + Edit nutrition forms.
 *
 * Supports two modes:
 *   Uncontrolled (default): pass `defaults?` only. Uses `defaultValue`.
 *     → EditNutritionForm path — byte-for-byte unchanged.
 *   Controlled: pass `values` + `onChange`. Uses `value`.
 *     → LogNutritionForm path — integrates with food library chip/scan adds.
 *
 * Back-compat guarantee: callers that only pass `defaults` (e.g. EditNutritionForm)
 * see zero behavior change — `isControlled` is false, `defaultValue` path fires.
 */

export type MacroKey = "calories" | "proteinG" | "carbsG" | "fatG" | "fiberG" | "sodiumMg";
export type MacroValues = Partial<Record<MacroKey, number | null>>;

export type MacroDefaults = Partial<
  Record<"calories" | "proteinG" | "carbsG" | "fatG" | "fiberG" | "sodiumMg", number | null>
>;

const MACRO_FIELDS: Array<{
  name: MacroKey;
  label: string;
  placeholder: string;
}> = [
  { name: "calories", label: "Cal", placeholder: "cal" },
  { name: "proteinG", label: "Protein", placeholder: "g" },
  { name: "carbsG", label: "Carbs", placeholder: "g" },
  { name: "fatG", label: "Fat", placeholder: "g" },
  { name: "fiberG", label: "Fiber", placeholder: "g" },
  { name: "sodiumMg", label: "Sodium", placeholder: "mg" },
];

/** Optional macro inputs shared by the log + edit nutrition forms. */
export function MacroInputs({
  defaults,
  values,
  onChange,
}: {
  defaults?: MacroDefaults;
  values?: MacroValues;
  onChange?: (key: MacroKey, val: number | null) => void;
}) {
  const isControlled = values !== undefined;

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
              {...(isControlled
                ? {
                    value: values[f.name] ?? "",
                    onChange: (e) => {
                      const raw = e.target.value.trim();
                      if (raw === "") {
                        onChange?.(f.name, null);
                      } else {
                        const n = Number(raw);
                        onChange?.(f.name, Number.isFinite(n) && n >= 0 ? n : null);
                      }
                    },
                  }
                : { defaultValue: defaults?.[f.name] ?? undefined })}
              className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-base"
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}
