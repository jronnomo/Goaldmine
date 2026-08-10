// src/lib/readiness-copy.ts
//
// Gate copy for the readiness ceiling (#290, research §4.2 — the table is
// binding). Pure, zero queries: a function of (rawScore, ceiling,
// openGateCount) only. `readiness.ts` is consumed, never modified
// (UXR-PV-83).
//
// The three states exist so a score pinned at the ceiling reads as CAPPED,
// never as a mysterious plateau (audit A1 — "that distinction has cost real
// interpretation time"):
//   HELD             openGateCount > 0 && rawScore > ceiling  — the cap bites
//   OPEN-NOT-BINDING openGateCount > 0 && rawScore <= ceiling — taught free
//   CLEAR            openGateCount === 0
//
// The middle state is the whole trick: the rule is taught while it is still
// free, so when the cap finally bites the user has already watched the fill
// march toward a line they understood.
//
// Tone rules (UXR-PV-24): no padlock, no --danger, never "blocked".

export type GateCopyStateKind = "held" | "open" | "clear";

export type GateCopy = {
  state: GateCopyStateKind;
  /** Uppercase eyebrow — only the HELD state has one (`HELD AT 80`). */
  eyebrow: string | null;
  body: string;
};

/** Framing line, rendered once per card when the goal has gating targets. */
export const GATE_FRAMING_LINE =
  "Gates are mastery checks — the score waits for them, it doesn't lose points.";

function clearPhrase(openGateCount: number): string {
  if (openGateCount === 1) return "the gate clears";
  if (openGateCount === 2) return "both gates clear";
  return `all ${openGateCount} gates clear`;
}

/**
 * The gate copy for a readiness snapshot. Callers pass the snapshot's own
 * scalars; `rawScore` is deliberately part of the copy (UXR-PV-23 — show the
 * uncapped number instead of letting the plateau lie by omission).
 */
export function gateCopyState(snap: {
  rawScore: number;
  ceiling: number;
  openGateCount: number;
}): GateCopy {
  if (snap.openGateCount === 0) {
    return { state: "clear", eyebrow: null, body: "All gates cleared." };
  }
  if (snap.rawScore > snap.ceiling) {
    return {
      state: "held",
      eyebrow: `HELD AT ${snap.ceiling}`,
      body:
        `Your work adds up to ${snap.rawScore} — the ceiling holds it at ` +
        `${snap.ceiling} until ${clearPhrase(snap.openGateCount)}.`,
    };
  }
  const n = snap.openGateCount;
  return {
    state: "open",
    eyebrow: null,
    body: `${n === 1 ? "1 gate" : `${n} gates`} to clear before this can pass ${snap.ceiling}.`,
  };
}
