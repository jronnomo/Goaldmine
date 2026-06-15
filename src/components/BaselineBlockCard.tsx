import Link from "next/link";
import { Bullseye } from "@/components/Bullseye";
import { Card } from "@/components/Card";
import { LogBaselineInlineForm } from "@/components/LogBaselineInlineForm";
import type { BaselineTest } from "@/lib/program-template";

export type BaselineBlockTest = {
  test: BaselineTest;
  checkpoint: "initial" | "retest";
  loggedOnDate?: { id: string; value: number; units: string; date: Date } | null;
};

export function BaselineBlockCard({
  index,
  tests,
  weekIndex,
}: {
  // A 0-based ordinal renders a "N. " prefix (the test block is the day's task).
  // Pass null to drop the prefix — used when every test is already logged and the
  // card is demoted below the workout as a quiet "done" reference.
  index: number | null;
  tests: BaselineBlockTest[];
  weekIndex?: number | null;
}) {
  if (tests.length === 0) return null;

  const checkpoint = tests[0]!.checkpoint;
  const label = checkpoint === "initial" ? "Initial baselines" : `Retest (week ${weekIndex})`;
  const loggedCount = tests.filter((t) => t.loggedOnDate).length;
  const allLogged = loggedCount === tests.length;
  const prefix = index === null ? "" : `${index + 1}. `;
  const status = allLogged ? " ✓" : ` (${loggedCount}/${tests.length} logged)`;

  return (
    <Card title={`${prefix}${label}${status}`}>
      <p className="text-xs uppercase tracking-wide text-[var(--muted)] mb-2">
        {allLogged
          ? "Completed — logged results below"
          : "Tests · do these fresh, before any other lower-body work"}
      </p>
      <ul className="space-y-3">
        {tests.map(({ test, loggedOnDate }) => (
          <li key={test.testName} className={loggedOnDate ? "opacity-70" : ""}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">
                  {loggedOnDate ? (
                    <Bullseye filled size={14} aria-hidden className="mr-1 inline-block align-[-2px]" />
                  ) : (
                    <Bullseye size={14} aria-hidden className="mr-1 inline-block align-[-2px]" />
                  )}
                  {test.testName}{" "}
                  <span className="text-[var(--muted)] font-normal text-xs">· {test.units}</span>
                </p>
                <p className="text-xs text-[var(--muted)] italic mt-0.5">{test.protocol}</p>
              </div>
              {loggedOnDate && (
                <span className="shrink-0 text-xs font-mono tabular-nums text-[var(--success)]">
                  {loggedOnDate.value} {loggedOnDate.units}
                </span>
              )}
            </div>
            {!loggedOnDate ? (
              <LogBaselineInlineForm testName={test.testName} units={test.units} />
            ) : (
              <Link
                href={`/baselines/test/${encodeURIComponent(test.testName)}`}
                className="text-xs text-[var(--muted)] inline-block mt-1"
              >
                History →
              </Link>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
