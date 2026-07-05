// SPIKE (AS-0) — Web Push viability spike diagnostics/subscribe page.
// Deliberately unreachable except by URL (no BottomNav/navigation entry).
// Public route, self-gated by SPIKE_PUSH_KEY (see route-access.ts).

import { notFound } from "next/navigation";
import { SpikePushClient } from "./SpikePushClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PageProps = { searchParams: Promise<{ key?: string }> };

export default async function SpikePushPage({ searchParams }: PageProps) {
  const { key } = await searchParams;
  const expectedKey = process.env.SPIKE_PUSH_KEY;
  // Plain === here is intentional (not timing-safe) — the query-string key
  // is low-value (gates a test page, not data); timing-safety is reserved
  // for the header-gated API routes (see requireSpikeKey in spike-push.ts).
  if (!expectedKey || key !== expectedKey) notFound();

  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY ?? null;

  return <SpikePushClient spikeKey={key} vapidPublicKey={vapidPublicKey} />;
}
