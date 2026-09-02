// src/app/trends/page.tsx — the /trends server shell (REQ-009).
//
// Server component: parses searchParams, calls getTrendsPageData, and either
// returns the zero-row EmptyState — BEFORE the client island exists in the
// tree, so "zero Recharts mounts" is a structural guarantee, not a branch
// inside a mounted island (PRD AC-16 / UXR-TRENDS-47) — or hands the
// serialized DailyPoint[] to the ONE client island, TrendsBoard.
//
// Param rules (blueprint §4a): range ∈ {30d,90d,all} else "90d"; from/to
// validated against /^\d{4}-\d{2}-\d{2}$/ — if EITHER is invalid or absent,
// BOTH fall back (never a partial mix); swapped when from > to. Invalid
// values are discarded, never thrown (G1 §6).

import Link from "next/link";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { TrendsBoard } from "@/components/trends/TrendsBoard";
import { parseDateKey } from "@/lib/calendar-core";
import { getTrendsPageData } from "@/lib/trends-data";

export const dynamic = "force-dynamic";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const RANGE_KEYS = ["30d", "90d", "all"] as const;
type RangeKey = (typeof RANGE_KEYS)[number];

export default async function TrendsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;

  const rangeKey: RangeKey = RANGE_KEYS.includes(params.range as RangeKey)
    ? (params.range as RangeKey)
    : "90d";

  // Either param invalid ⇒ fall back to BOTH defaults — never a partial mix.
  let from: Date | null = null;
  let to: Date | null = null;
  if (
    params.from &&
    params.to &&
    DATE_KEY_RE.test(params.from) &&
    DATE_KEY_RE.test(params.to)
  ) {
    let fromKey = params.from;
    let toKey = params.to;
    if (fromKey > toKey) [fromKey, toKey] = [toKey, fromKey]; // ISO keys compare lexicographically
    from = parseDateKey(fromKey);
    to = parseDateKey(toKey);
  }

  const data = await getTrendsPageData({ rangeKey, from, to });

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      {/* 1 · hero — the name stays `Trends` (UXR-TRENDS-45: the theme lives in
          visuals, never prose). */}
      <header className="pt-2" data-testid="trends-hero">
        <h1 className="text-2xl font-semibold tracking-tight">Trends</h1>
        <p className="mt-0.5 text-xs text-[var(--muted)]">Weight against what you ate</p>
      </header>

      {data.shape === "zero" ? (
        // Zero-row branch: returns before the island exists in the tree — no
        // chip row (chips over zero rows are decoration), no rail, no
        // Recharts mount anywhere (UXR-TRENDS-47). Copy is final (§4): the
        // closing promise is the one place the page says out loud what the
        // five gates enforce silently.
        <Card>
          <EmptyState
            data-testid="trends-empty"
            title="Nothing to trend yet"
            body="Log a weigh-in and a few days of meals — this page fills in from your own numbers. Nothing here is estimated."
            action={
              <Link
                href="/coach"
                className="text-sm text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded"
              >
                Open coach setup →
              </Link>
            }
          />
        </Card>
      ) : (
        <TrendsBoard
          points={data.points}
          targets={data.targets}
          rangeKey={data.rangeKey}
          initialWindow={data.initialWindow}
        />
      )}
    </div>
  );
}
