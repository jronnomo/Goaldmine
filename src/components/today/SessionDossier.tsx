// SessionDossier — SERVER COMPONENT. One Tier-1 Card ("Session") absorbing
// the old BlockCard×N + CompletedWorkoutCard stack as native <details> rows
// (today-page-ia §2.4 / UXR-TIA-17).
//
// 🔴 BINDING (UXR-TIA-19/20): every <details> here ships the LITERAL `open`
// attribute — never a data-dependent expression. <details open> is
// uncontrolled after mount; a same-page server action (the Log sheet's meal
// submit revalidates "/") re-renders this tree, and a defaultOpen that
// flipped would make React call removeAttribute("open") and slam the section
// shut under the reading finger. A literal never flips, so the user's own
// toggles survive every revalidate. Do not "wire this to data".
//
// Completed mode keeps the RECEIPT in the summary — `4:12 PM · 5 exercises ·
// 18 sets` — and the set list in the body (peak-end + IKEA: collapse the
// detail, never the acknowledgment, UXR-TIA-18). Disclosure SNAPS by design
// (UXR-TIA-33): the only tween is the chevron's motion-safe rotate.

import Link from "next/link";
import { Card } from "@/components/Card";
import { USER_TZ } from "@/lib/calendar";
import type { Block } from "@/lib/program-template";
import type { CompletedWorkoutDetail } from "@/components/days/CompletedWorkoutCard";
import { BlockMetaLine, ExerciseRow, defaultBlockLabel } from "@/components/today/BlockCard";

const SUMMARY_CLASS =
  "flex items-center justify-between gap-2 px-1 min-h-[44px] cursor-pointer list-none [&::-webkit-details-marker]:hidden";
// Deliberately text-sm font-medium — NOT text-base/semibold. That weight is
// Tiers 1/3; a dossier row must read one step below its own Card header.
const LABEL_CLASS = "text-sm font-medium truncate min-w-0 flex-1";
const DIGEST_CLASS = "text-xs tabular-nums text-[var(--muted)] shrink-0";
const CHEVRON_CLASS =
  "text-xs text-[var(--muted)] shrink-0 motion-safe:transition-transform group-open:rotate-180";
const BODY_CLASS = "px-1 pb-3 pt-1 space-y-2";

function formatSet(s: CompletedWorkoutDetail["exercises"][number]["sets"][number]): string {
  const parts: string[] = [];
  if (s.weightLb !== null && s.reps !== null) parts.push(`${s.weightLb} lb × ${s.reps}`);
  else if (s.reps !== null) parts.push(`${s.reps} reps`);
  if (s.durationSec !== null) parts.push(formatSecs(s.durationSec));
  if (s.distanceMi !== null) parts.push(`${s.distanceMi} mi`);
  if (s.rpe !== null) parts.push(`RPE ${s.rpe}`);
  return parts.join(" · ") || "—";
}

function formatSecs(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}:${String(sec).padStart(2, "0")}` : `${s}s`;
}

export function SessionDossier({
  workoutName,
  completed = [],
  plannedVsLogged,
  blocks = [],
  emptyCopy,
}: {
  /** Muted right-aligned Card action — the session's name (today-page-ia §2.4). */
  workoutName?: string | null;
  /** Completed mode: today's logged workouts, full detail. Wins over blocks. */
  completed?: CompletedWorkoutDetail[];
  /** "Planned: X → logged: Y" note — completed mode, titles differ only. */
  plannedVsLogged?: string | null;
  /** Prescription mode: the day's blocks as <details> rows. */
  blocks?: Block[];
  /** Named zero state ("No session scheduled today.") — zero-Program tenants
   *  only; Program tenants render NO dossier (the timeline owns the empty
   *  state with better copy — UXR-TIA-27). */
  emptyCopy?: string | null;
}) {
  const mode =
    completed.length > 0 ? "completed" : blocks.length > 0 ? "blocks" : emptyCopy ? "empty" : null;
  if (mode === null) return null;

  return (
    <Card
      title="Session"
      data-testid="today-session-dossier"
      action={
        workoutName ? (
          <span className="text-xs text-[var(--muted)] truncate max-w-[60%]">{workoutName}</span>
        ) : undefined
      }
    >
      {mode === "empty" ? (
        <p className="text-sm text-[var(--muted)]">{emptyCopy}</p>
      ) : (
        <>
          {mode === "completed" && plannedVsLogged && (
            <p className="text-xs text-[var(--muted)] mb-1 px-1">{plannedVsLogged}</p>
          )}
          <ol className="divide-y divide-[var(--border)] -mx-1">
            {mode === "completed"
              ? completed.map((w, i) => {
                  const time = w.startedAt.toLocaleTimeString("en-US", {
                    timeZone: USER_TZ,
                    hour: "numeric",
                    minute: "2-digit",
                  });
                  const totalSets = w.exercises.reduce((n, ex) => n + ex.sets.length, 0);
                  return (
                    <li key={w.id}>
                      {/* LITERAL open — see the header comment. */}
                      <details open className="group" data-testid={`today-session-block-${i}`}>
                        <summary className={SUMMARY_CLASS}>
                          <span className={LABEL_CLASS}>
                            <span className="text-[var(--success)] mr-1" aria-hidden>
                              ✓
                            </span>
                            {w.title ?? "Workout"}
                          </span>
                          <span className={DIGEST_CLASS}>
                            {time} · {w.exercises.length} exercises · {totalSets} sets
                          </span>
                          <span aria-hidden className={CHEVRON_CLASS}>
                            ▼
                          </span>
                        </summary>
                        <div className={BODY_CLASS}>
                          <ul className="space-y-3">
                            {w.exercises.map((ex) => (
                              <li key={ex.id}>
                                <p className="text-sm font-medium min-w-0 break-words">
                                  {ex.name}
                                  {ex.equipment && (
                                    <span className="text-[var(--muted)] font-normal">
                                      {" "}
                                      · {ex.equipment}
                                    </span>
                                  )}
                                </p>
                                <ul className="mt-1 space-y-0.5">
                                  {ex.sets.map((s) => (
                                    <li key={s.id} className="flex justify-between text-sm">
                                      <span className="text-[var(--muted)]">Set {s.setIndex}</span>
                                      <span className="font-mono tabular-nums">{formatSet(s)}</span>
                                    </li>
                                  ))}
                                </ul>
                                {ex.notes && (
                                  <p className="text-xs text-[var(--muted)] italic mt-1">
                                    {ex.notes}
                                  </p>
                                )}
                              </li>
                            ))}
                          </ul>
                          {w.notes && (
                            <div className="border-t border-[var(--border)] pt-2">
                              <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
                                Notes
                              </p>
                              <p className="text-sm whitespace-pre-wrap mt-1">{w.notes}</p>
                            </div>
                          )}
                          <p className="flex items-center justify-between text-xs text-[var(--muted)]">
                            <span>{w.source ?? ""}</span>
                            <Link
                              href={`/workouts/${w.id}`}
                              className="text-[var(--accent)] shrink-0 min-h-[44px] inline-flex items-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                            >
                              Edit →
                            </Link>
                          </p>
                        </div>
                      </details>
                    </li>
                  );
                })
              : blocks.map((block, i) => (
                  <li key={i}>
                    {/* LITERAL open — see the header comment. */}
                    <details open className="group" data-testid={`today-session-block-${i}`}>
                      <summary className={SUMMARY_CLASS}>
                        <span className={LABEL_CLASS}>
                          {block.label ?? defaultBlockLabel(block.type)}
                        </span>
                        <span className={DIGEST_CLASS}>
                          {block.exercises.length} exercise{block.exercises.length === 1 ? "" : "s"}
                        </span>
                        <span aria-hidden className={CHEVRON_CLASS}>
                          ▼
                        </span>
                      </summary>
                      <div className={BODY_CLASS}>
                        <BlockMetaLine block={block} />
                        <ul className="space-y-2">
                          {block.exercises.map((ex, j) => (
                            <ExerciseRow key={j} ex={ex} />
                          ))}
                        </ul>
                      </div>
                    </details>
                  </li>
                ))}
          </ol>
        </>
      )}
    </Card>
  );
}
