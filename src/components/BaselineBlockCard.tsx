import Link from "next/link";
import { Card } from "@/components/Card";
import type { BaselineTest } from "@/lib/program-template";

export type BaselineBlockTest = {
  test: BaselineTest;
  checkpoint: "initial" | "retest";
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

  // All checkpoints on a single day will share the same kind in practice.
  const checkpoint = tests[0]!.checkpoint;
  const label = checkpoint === "initial" ? "Initial baselines" : `Retest (week ${weekIndex})`;

  return (
    <Card title={`${index + 1}. ${label}`}>
      <p className="text-xs uppercase tracking-wide text-[var(--muted)] mb-2">
        Tests · do these fresh, before the rest of the workout
      </p>
      <ul className="space-y-3">
        {tests.map(({ test }) => (
          <li key={test.testName}>
            <p className="font-medium">
              {test.testName}{" "}
              <span className="text-[var(--muted)] font-normal text-xs">· {test.units}</span>
            </p>
            <p className="text-xs text-[var(--muted)] italic mt-0.5">{test.protocol}</p>
            <Link
              href={`/baselines/new?testName=${encodeURIComponent(test.testName)}`}
              className="text-xs text-[var(--accent)] inline-block mt-1"
            >
              Log result →
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
