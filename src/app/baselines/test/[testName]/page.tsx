import Link from "next/link";
import { Card } from "@/components/Card";
import { HistoryChart } from "@/components/HistoryChart";
import { getBaselineHistory } from "@/lib/records";

export const dynamic = "force-dynamic";

export default async function BaselineTestDetail({
  params,
}: {
  params: Promise<{ testName: string }>;
}) {
  const { testName: encoded } = await params;
  const testName = decodeURIComponent(encoded);
  const history = await getBaselineHistory(testName);

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <header className="pt-2">
        <Link href="/baselines" className="text-sm text-[var(--accent)]">
          ← Records
        </Link>
        <div className="flex items-start justify-between gap-2 mt-1">
          <h1 className="text-2xl font-semibold tracking-tight">{testName}</h1>
          <Link
            href={`/baselines/new?testName=${encodeURIComponent(testName)}`}
            className="shrink-0 text-xs rounded-full border border-[var(--border)] px-3 py-1 hover:bg-[var(--accent)] hover:text-[var(--accent-fg)] hover:border-[var(--accent)]"
          >
            + Log result
          </Link>
        </div>
        <p className="text-sm text-[var(--muted)]">
          {history.length} result{history.length === 1 ? "" : "s"}
          {history.length > 0 && ` · units: ${history[0]!.units}`}
        </p>
      </header>

      <Card title="History">
        {history.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No results yet.</p>
        ) : history.length === 1 ? (
          <p className="text-sm text-[var(--muted)]">
            Only one result so far. The trend appears once you re-test.
          </p>
        ) : (
          <HistoryChart
            data={history.map((h) => ({
              date: h.date.toISOString(),
              value: h.value,
              tooltip: `${h.value} ${h.units}`,
            }))}
            units={history[0]!.units}
          />
        )}
      </Card>

      <Card title="All results">
        {history.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">Log baseline results when you re-test (week 1, 6, 12).</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {[...history].reverse().map((h) => (
              <li key={h.id} className="py-2 flex justify-between items-baseline gap-3">
                <div>
                  <p className="font-mono text-sm">
                    {h.value} <span className="text-[var(--muted)] text-xs">{h.units}</span>
                  </p>
                  {h.notes && <p className="text-xs text-[var(--muted)] mt-0.5">{h.notes}</p>}
                </div>
                <div className="flex items-baseline gap-2 shrink-0">
                  <p className="text-xs text-[var(--muted)]">
                    {new Date(h.date).toLocaleDateString()}
                  </p>
                  <Link
                    href={`/baselines/results/${h.id}/edit`}
                    className="text-xs text-[var(--accent)]"
                  >
                    Edit
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
