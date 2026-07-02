/**
 * GET /oauth/authorize — OAuth consent screen (C-2).
 *
 * Server component. runtime="nodejs" (uses Prisma + auth()).
 * dynamic="force-dynamic" — query params differ per request.
 *
 * Order of operations:
 *   1. Await searchParams (Next 16 Promise), reconstruct originalQueryString.
 *   2. Validate OAuth request (validateAuthorizeParams):
 *       - mode "render" error → inline error card (NEVER redirect to untrusted URI).
 *       - mode "redirect" error → URL-API redirect to redirect_uri?error=…
 *   3. Session gate — if no auth session, redirect to /signin?next=… (loop-safe;
 *      /oauth/* is public in middleware; safeNext accepts the relative next path).
 *   4. Render consent card (DA #6 phishing-resistant: host-anchored, not name-anchored).
 *
 * Frame-busting headers (X-Frame-Options + CSP frame-ancestors) are set by
 * src/middleware.ts for /oauth/authorize — Next.js server components cannot set
 * arbitrary response headers directly, so middleware is the right layer.
 */

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db";
import { Logo } from "@/components/Logo";
import { validateAuthorizeParams } from "@/lib/oauth/authorize-validate";
import {
  approveAuthorization,
  denyAuthorization,
} from "@/lib/oauth/authorize-actions";
import { originFromHeaders } from "@/lib/oauth/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AuthorizePageProps {
  // Next 16: searchParams is a Promise.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function AuthorizePage({ searchParams }: AuthorizePageProps) {
  const rawParams = await searchParams;

  // Flatten: take the first value for any array params (query strings like
  // ?foo=a&foo=b are unusual in OAuth but handled safely).
  const params: Record<string, string | undefined> = {};
  for (const [key, val] of Object.entries(rawParams)) {
    params[key] = Array.isArray(val) ? val[0] : val;
  }

  // Reconstruct originalQueryString from the awaited entries.
  // RSC has no access to request.url; we rebuild from the params.
  const originalQueryString = new URLSearchParams(
    Object.entries(params).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  ).toString();

  // Derive origin for RFC 8707 resource validation.
  const headersList = await headers();
  const origin = originFromHeaders(headersList);

  // ── 1. Validate OAuth params ─────────────────────────────────────────────
  const validation = await validateAuthorizeParams(params, prisma, origin);

  if (!validation.ok) {
    if (validation.mode === "redirect" && validation.redirectUri) {
      // redirect_uri is validated — safe to redirect with error params.
      const u = new URL(validation.redirectUri);
      u.searchParams.set("error", validation.error);
      u.searchParams.set("error_description", validation.errorDescription);
      if (validation.state) u.searchParams.set("state", validation.state);
      redirect(u.toString());
    }
    // mode === "render" — cannot trust redirect_uri; show inline error.
    return (
      <OAuthErrorCard
        heading="Invalid OAuth request"
        detail={validation.errorDescription}
      />
    );
  }

  const {
    client,
    redirectUri,
    codeChallenge,
    codeChallengeMethod,
    state,
    scope,
    resource,
  } = validation;

  // ── 2. Session gate ──────────────────────────────────────────────────────
  const session = await auth();
  if (!session) {
    // /signin's safeNext accepts relative paths. /oauth/authorize?… IS relative.
    redirect(
      "/signin?next=" +
        encodeURIComponent("/oauth/authorize?" + originalQueryString),
    );
  }

  // ── 3. Render consent card (DA #6 — phishing-resistant) ─────────────────
  // Trust anchor = the validated redirect_uri HOST (not the self-asserted clientName).
  const redirectHost = new URL(redirectUri).host;
  const userEmail = session.user?.email ?? "";

  return (
    <div className="min-h-[calc(100vh-48px)] flex items-center justify-center px-4 py-12">
      <div
        className="w-full rounded-2xl border border-[var(--border)] bg-[var(--background)] p-8 shadow-lg"
        style={{ maxWidth: 390, boxShadow: "0 4px 32px 0 rgba(0,0,0,0.10)" }}
      >
        {/* Brand */}
        <div className="flex flex-col items-center gap-3 mb-6">
          <Logo size={56} />
          <span
            className="font-display text-3xl tracking-tight text-[var(--foreground)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Goaldmine
          </span>
        </div>

        {/* Heading — neutral; does NOT hardcode the client name */}
        <h1 className="text-xl font-semibold text-[var(--foreground)] text-center mb-2">
          Authorize access to Goaldmine?
        </h1>

        {/* Lead — redirect_uri HOST is the trust anchor (DA #6) */}
        <p className="text-sm text-[var(--muted)] text-center mb-1 leading-snug">
          An app at{" "}
          <span className="font-medium text-[var(--foreground)]">
            {redirectHost}
          </span>{" "}
          wants to access your Goaldmine data.
        </p>

        {/* clientName — only shown as muted self-asserted label (DA #6) */}
        {client.clientName ? (
          <p className="text-xs text-[var(--muted)] text-center mb-5 italic">
            Identifies itself as: &ldquo;{client.clientName}&rdquo; (unverified)
          </p>
        ) : (
          <div className="mb-5" />
        )}

        {/* Scope list — static copy for scope=mcp */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--accent)]/5 px-4 py-3 mb-5 text-sm text-[var(--foreground)]">
          <p className="font-medium mb-2 text-[var(--foreground)]">
            Access requested:
          </p>
          <ul className="space-y-1 text-[var(--muted)]">
            <li>• Read your goals, workouts, plans, and history</li>
            <li>• Log workouts, notes, and progress on your behalf</li>
          </ul>
        </div>

        {/* Signed-in-as */}
        <p className="text-xs text-[var(--muted)] text-center mb-5">
          Signed in as{" "}
          <span className="font-medium text-[var(--foreground)]">
            {userEmail}
          </span>
          .{" "}
          <a
            href="/signin"
            className="underline underline-offset-2 hover:text-[var(--foreground)] transition-colors"
          >
            Not you? Sign out
          </a>
        </p>

        {/* Actions — two <form>s posting to server actions */}
        <div className="flex flex-col gap-3">
          {/* Allow */}
          <form action={approveAuthorization}>
            <input type="hidden" name="client_id" value={client.clientId} />
            <input type="hidden" name="redirect_uri" value={redirectUri} />
            <input type="hidden" name="code_challenge" value={codeChallenge} />
            <input
              type="hidden"
              name="code_challenge_method"
              value={codeChallengeMethod}
            />
            {state !== undefined && (
              <input type="hidden" name="state" value={state} />
            )}
            {scope !== undefined && (
              <input type="hidden" name="scope" value={scope} />
            )}
            {resource !== undefined && (
              <input type="hidden" name="resource" value={resource} />
            )}
            <button
              type="submit"
              className="w-full rounded-xl bg-[var(--accent)] px-4 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              Allow
            </button>
          </form>

          {/* Deny */}
          <form action={denyAuthorization}>
            <input type="hidden" name="client_id" value={client.clientId} />
            <input type="hidden" name="redirect_uri" value={redirectUri} />
            <input type="hidden" name="code_challenge" value={codeChallenge} />
            <input
              type="hidden"
              name="code_challenge_method"
              value={codeChallengeMethod}
            />
            {state !== undefined && (
              <input type="hidden" name="state" value={state} />
            )}
            {scope !== undefined && (
              <input type="hidden" name="scope" value={scope} />
            )}
            {resource !== undefined && (
              <input type="hidden" name="resource" value={resource} />
            )}
            <button
              type="submit"
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]/10 active:bg-[var(--accent)]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              Deny
            </button>
          </form>
        </div>

        {/* Security footnote with full redirect_uri */}
        <p className="mt-5 text-xs text-[var(--muted)] text-center leading-relaxed">
          Only allow apps you trust. This app will be able to act as you in
          Goaldmine.
          <br />
          <span className="font-mono break-all">{redirectUri}</span>
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline error card (mode "render" — cannot trust redirect_uri)
// ---------------------------------------------------------------------------

function OAuthErrorCard({
  heading,
  detail,
}: {
  heading: string;
  detail: string;
}) {
  return (
    <div className="min-h-[calc(100vh-48px)] flex items-center justify-center px-4 py-12">
      <div
        className="w-full rounded-2xl border border-[var(--border)] bg-[var(--background)] p-8 shadow-lg"
        style={{ maxWidth: 390, boxShadow: "0 4px 32px 0 rgba(0,0,0,0.10)" }}
      >
        <div className="flex flex-col items-center gap-3 mb-6">
          <Logo size={56} />
          <span
            className="font-display text-3xl tracking-tight text-[var(--foreground)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Goaldmine
          </span>
        </div>
        <h1 className="text-xl font-semibold text-[var(--foreground)] text-center mb-3">
          {heading}
        </h1>
        <p className="text-sm text-[var(--muted)] text-center leading-relaxed">
          {detail}
        </p>
      </div>
    </div>
  );
}
