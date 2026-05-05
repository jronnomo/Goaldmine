import Link from "next/link";
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
  index: number;
  tests: BaselineBlockTest[];
  weekIndex?: number | null;
}) {
  if (tests.length === 0) return null;

  const checkpoint = tests[0]!.checkpoint;
  const label = checkpoint === "initial" ? "Initial baselines" : `Retest (week ${weekIndex})`;
  const loggedCount = tests.filter((t) => t.loggedOnDate).length;
  const allLogged = loggedCount === tests.length;

  return (
    <Card title={`${index + 1}. ${label}${allLogged ? " ✓" : ` (${loggedCount}/${tests.length} logged)`}`}>
      <p className="text-xs uppercase tracking-wide text-[var(--muted)] mb-2">
        Tests · do these fresh, before any other lower-body work
      </p>
      <ul className="space-y-3">
        {tests.map(({ test, loggedOnDate }) => (
          <li key={test.testName} className={loggedOnDate ? "opacity-70" : ""}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">
                  {loggedOnDate && <span className="text-emerald-500 mr-1">✓</span>}
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
