// Pure, client-safe formatter for the Day Override editor's save-error
// banner (#235 UXR-235-09). The server's `assertBaselineDecisionMade`
// (day-template-validation.ts) throws a dev-oriented multi-clause message —
// deliberately kept identical to the MCP tool path's own guard message (see
// day-actions.ts's comment on why: it's the shared covenant text). That raw
// string is NOT what the dashboard shows the user; this module recognizes
// that one specific guard and rewrites it into the compressed, coach-voiced
// copy the UX report (§Q5, UXR-235-09) prescribed. Any other save error
// (invalid JSON, "No active plan", etc.) passes through unchanged — this is
// a narrow, signature-matched rewrite, not a general error-prettifier.

export type SaveErrorBanner = {
  /** Bold lead-in, only set for the recognized baseline-guard error. */
  headline?: string;
  /** Main sentence(s), always present — the raw message verbatim for any
   * error this module doesn't recognize. */
  body: string;
  /** Optional italic muted follow-up line pointing at the real escape hatch. */
  hint?: string;
};

// Matches the throw in assertBaselineDecisionMade (day-template-validation.ts).
// Signature-only match (not the whole string) so wording tweaks elsewhere in
// that message don't silently stop the rewrite from firing.
const BASELINE_GUARD_SIGNATURE = "didn't make a baseline decision";
const ROTATION_NAMES_RE = /Rotation default for this date: \[([^\]]*)\]/;

/**
 * Rewrite the baseline-guard covenant throw into ≤3-line coach-voiced copy
 * at a 390px column (UXR-235-09); passes any other error through verbatim.
 */
export function formatSaveErrorBanner(rawMessage: string): SaveErrorBanner {
  if (!rawMessage.includes(BASELINE_GUARD_SIGNATURE)) {
    return { body: rawMessage };
  }

  const namesMatch = rawMessage.match(ROTATION_NAMES_RE);
  const names = namesMatch?.[1]?.trim();
  const subject = names ? `a baseline test (${names})` : "a baseline test";

  return {
    headline: "Baseline check needed.",
    body:
      `Today's rotation includes ${subject}. Editing the workout without deciding what happens to it ` +
      `could drop it silently. Keep it, skip it for today, or swap it — then save.`,
    hint: "Fine-grained control lives in Advanced JSON, or ask your coach in chat.",
  };
}
