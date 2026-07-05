"use client";

// SPIKE (AS-0) — client half of the Web Push viability spike page.
// All interactivity lives here; the server component (page.tsx) only does
// the key check and passes props. Deletable together as one unit.

import { useEffect, useState } from "react";
import { Card } from "@/components/Card";

type SpikeState =
  | "unsupported"
  | "needs-install"
  | "permission-denied"
  | "permission-default"
  | "subscribing"
  | "subscribed"
  | "sending"
  | "sent";

type Diagnostics = {
  standalone: boolean;
  serviceWorker: boolean;
  pushManager: boolean;
  permission: NotificationPermission | "unknown";
};

// Standard VAPID base64url → Uint8Array conversion. Required because
// applicationServerKey must be a Uint8Array backed by a plain ArrayBuffer
// (lib.dom's BufferSource rejects the generic ArrayBufferLike-backed
// Uint8Array that `new Uint8Array(n)` produces under TS's stricter
// ArrayBufferView<ArrayBuffer> typing — hence the explicit ArrayBuffer).
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

function isIOS(): boolean {
  return /iP(hone|ad|od)/.test(navigator.userAgent);
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function SpikePushClient({
  spikeKey,
  vapidPublicKey,
}: {
  spikeKey?: string;
  vapidPublicKey: string | null;
}) {
  const [state, setState] = useState<SpikeState>("permission-default");
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [subscriptionHost, setSubscriptionHost] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");

  // All diagnostics reads happen client-only (window/navigator do not exist
  // during SSR) — this effect runs once on mount.
  useEffect(() => {
    const supported = "serviceWorker" in navigator && "PushManager" in window;
    const permission: NotificationPermission | "unknown" =
      typeof Notification !== "undefined" ? Notification.permission : "unknown";

    const d: Diagnostics = {
      standalone: isStandalone(),
      serviceWorker: "serviceWorker" in navigator,
      pushManager: "PushManager" in window,
      permission,
    };
    // Reading navigator/window diagnostics is only possible client-side, so
    // this synchronous read-then-setState-once-on-mount is the correct
    // external-system-sync use of an effect (see BarcodeScanner.tsx for the
    // same established pattern in this repo).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDiagnostics(d);

    if (!supported) {
      setState("unsupported");
      return;
    }
    if (isIOS() && !d.standalone) {
      setState("needs-install");
      return;
    }
    if (permission === "denied") {
      setState("permission-denied");
      return;
    }

    // Check for an existing subscription (don't create one just to check).
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => reg?.pushManager.getSubscription() ?? null)
      .then((sub) => {
        if (sub) {
          try {
            setSubscriptionHost(new URL(sub.endpoint).host);
          } catch {
            // Ignore malformed endpoint — not fatal to the diagnostic.
          }
          setState("subscribed");
        } else {
          setState("permission-default");
        }
      })
      .catch(() => {
        setState("permission-default");
      });
  }, []);

  async function handleEnable() {
    // iOS Safari can drop the user-activation flag across an await boundary,
    // so Notification.requestPermission() must be the FIRST async call in
    // this handler's chain — no prior await.
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setState("permission-denied");
      setStatus("Permission denied.");
      return;
    }

    setState("subscribing");
    setStatus("Registering service worker…");
    try {
      if (!vapidPublicKey) throw new Error("VAPID_PUBLIC_KEY not configured");

      const registration = await navigator.serviceWorker.register("/spike-sw.js");
      await navigator.serviceWorker.ready;

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      const res = await fetch("/api/spike/push/subscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-spike-key": spikeKey ?? "",
        },
        body: JSON.stringify(subscription.toJSON()),
      });
      const json: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        setState("permission-default");
        setStatus(`Subscribe failed: ${JSON.stringify(json)}`);
        return;
      }

      try {
        setSubscriptionHost(new URL(subscription.endpoint).host);
      } catch {
        // Ignore malformed endpoint — not fatal to the diagnostic.
      }
      setState("subscribed");
      setStatus("Subscribed.");
    } catch (err) {
      setState("permission-default");
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function handleSend() {
    setState("sending");
    setStatus("Sending…");
    try {
      const res = await fetch("/api/spike/push/send", {
        method: "POST",
        headers: { "x-spike-key": spikeKey ?? "" },
      });
      const json: unknown = await res.json().catch(() => null);
      setStatus(JSON.stringify(json, null, 2));
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setState("sent");
    }
  }

  if (!vapidPublicKey) {
    return (
      <div className="min-h-[calc(100vh-48px)] px-4 py-8">
        <div className="w-full max-w-sm mx-auto">
          <Card title="SPIKE — Web Push viability">
            <p className="text-sm text-[var(--muted)]">
              Config error: VAPID_PUBLIC_KEY is not set. Set VAPID_PUBLIC_KEY,
              VAPID_PRIVATE_KEY, and VAPID_SUBJECT before using this page.
            </p>
          </Card>
        </div>
      </div>
    );
  }

  const enableDisabled =
    state === "unsupported" ||
    state === "needs-install" ||
    state === "permission-denied" ||
    state === "subscribing" ||
    state === "subscribed";
  const sendDisabled = state !== "subscribed" && state !== "sent";

  return (
    <div className="min-h-[calc(100vh-48px)] px-4 py-8">
      <div className="w-full max-w-sm mx-auto space-y-4">
        <Card title="SPIKE — Web Push viability">
          <div className="space-y-3">
            <dl className="text-sm space-y-1">
              <div className="flex justify-between">
                <dt className="text-[var(--muted)]">standalone</dt>
                <dd>{diagnostics ? (diagnostics.standalone ? "yes" : "no") : "…"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--muted)]">serviceWorker</dt>
                <dd>{diagnostics ? (diagnostics.serviceWorker ? "yes" : "no") : "…"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--muted)]">PushManager</dt>
                <dd>{diagnostics ? (diagnostics.pushManager ? "yes" : "no") : "…"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--muted)]">permission</dt>
                <dd>{diagnostics?.permission ?? "…"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--muted)]">subscription</dt>
                <dd>{subscriptionHost ?? "none"}</dd>
              </div>
            </dl>

            {state === "unsupported" && (
              <p className="text-sm text-[var(--muted)]">
                This browser does not support Service Workers or the Push API.
              </p>
            )}
            {state === "needs-install" && (
              <p className="text-sm text-[var(--muted)]">
                On iOS, Web Push only works from an installed PWA. Add this
                site to your Home Screen (Share → Add to Home Screen),
                then open the installed app and revisit this URL.
              </p>
            )}
            {state === "permission-denied" && (
              <p className="text-sm text-[var(--muted)]">
                Notifications are blocked. There is no re-prompt path —
                go to Settings → Notifications → Goaldmine →
                Allow, then reload this page.
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleEnable}
                disabled={enableDisabled}
                className="min-h-11 flex-1 rounded-xl bg-[var(--foreground)] text-[var(--background)] text-sm font-medium disabled:opacity-40"
              >
                Enable notifications
              </button>
              <button
                type="button"
                onClick={handleSend}
                disabled={sendDisabled}
                className="min-h-11 flex-1 rounded-xl border border-[var(--border)] text-sm font-medium disabled:opacity-40"
              >
                Send test push
              </button>
            </div>

            <p aria-live="polite" className="whitespace-pre-wrap text-xs text-[var(--muted)]">
              {status}
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
