// SPIKE (AS-0) — Web Push viability spike diagnostics/subscribe page.
// Deliberately unreachable except by URL (no BottomNav/navigation entry).
// Public route, self-gated by SPIKE_PUSH_KEY (see route-access.ts).

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SpikePushClient } from "./SpikePushClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// iOS "Add to Home Screen" launches the installed app at the manifest's
// start_url ("/"), not the URL the user was viewing — and standalone mode
// has no address bar, so this deliberately unlinked spike page would be
// unreachable once installed. Dropping the inherited manifest link + opting
// into legacy iOS standalone mode makes A2HS-from-this-page install with
// this exact URL as the entry point instead.
//
// `appleWebApp.capable` only emits the modern, unprefixed
// `mobile-web-app-capable` meta tag in this Next.js version — the legacy
// `apple-mobile-web-app-capable` tag (still what older iOS Safari checks
// for standalone mode) has to be added explicitly via `other`.
export const metadata: Metadata = {
  title: "Goaldmine Push Spike",
  manifest: null,
  appleWebApp: { capable: true, title: "GM Push Spike", statusBarStyle: "default" },
  other: { "apple-mobile-web-app-capable": "yes" },
};

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
