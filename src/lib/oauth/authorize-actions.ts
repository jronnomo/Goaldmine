"use server";

/**
 * C-2 server actions for the OAuth consent form (Allow / Deny).
 *
 * Security invariants:
 *  - `userId` is ALWAYS taken from auth() — NEVER from formData.
 *  - Every action re-runs validateAuthorizeParams (DB lookup) before acting,
 *    so hidden-input tampering cannot forge a redirect_uri or bypass validation.
 *  - Redirect URLs are built via the URL API — NEVER string-concat (DA #1).
 *  - denyAuthorization runs the FULL validateAuthorizeParams (not just a
 *    redirect_uri lookup) — trust comes from the DB, not the hidden input.
 *
 * C-3a implementation notes (preserved here):
 *  - C-3a reads codeChallengeMethod FROM the stored OAuthAuthCode row.
 *  - userId is NEVER read from formData; only from auth() session.
 */

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db";
import { generateSecret, hashSecret, AUTH_CODE_TTL_S } from "@/lib/oauth/tokens";
import { validateAuthorizeParams } from "@/lib/oauth/authorize-validate";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Derive the canonical server origin (same logic as page.tsx). */
async function getOrigin(): Promise<string> {
  const canonical = process.env.CANONICAL_ORIGIN;
  if (canonical) return canonical.replace(/\/+$/, "");
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

/**
 * Convert FormData to the params Record expected by validateAuthorizeParams.
 * response_type is hardcoded "code" — it's not a hidden input on the consent
 * form (the form only exists after response_type was already validated as "code").
 */
function formDataToParams(fd: FormData): Record<string, string | undefined> {
  return {
    client_id: fd.get("client_id")?.toString(),
    redirect_uri: fd.get("redirect_uri")?.toString(),
    response_type: "code",
    code_challenge: fd.get("code_challenge")?.toString(),
    code_challenge_method: fd.get("code_challenge_method")?.toString(),
    state: fd.get("state")?.toString(),
    scope: fd.get("scope")?.toString(),
    resource: fd.get("resource")?.toString(),
  };
}

// ---------------------------------------------------------------------------
// Allow
// ---------------------------------------------------------------------------

/**
 * Invoked when the user clicks "Allow" on the consent card.
 *
 * 1. Verify session (userId from auth() — NEVER from formData).
 * 2. Re-validate all params against the DB (tamper-proof).
 * 3. Mint a hashed single-use PKCE-bound auth code.
 * 4. Redirect to redirect_uri?code=…&state=… via the URL API.
 */
export async function approveAuthorization(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/signin");
  }
  const userId = session.user.id;

  const origin = await getOrigin();
  const params = formDataToParams(formData);
  const validation = await validateAuthorizeParams(params, prisma, origin);

  if (!validation.ok) {
    if (validation.mode === "redirect" && validation.redirectUri) {
      const u = new URL(validation.redirectUri);
      u.searchParams.set("error", validation.error);
      u.searchParams.set("error_description", validation.errorDescription);
      if (validation.state) u.searchParams.set("state", validation.state);
      redirect(u.toString());
    }
    // mode === "render" — hidden input was tampered (redirect_uri not in DB).
    // Redirect to /signin; there's no safe redirect_uri to use.
    redirect("/signin");
  }

  const {
    redirectUri,
    clientId,
    codeChallenge,
    codeChallengeMethod,
    resource,
    scope,
    state,
  } = validation;

  // Mint auth code — plaintext is returned once; only the hash is persisted.
  const code = generateSecret("mcpc");
  await prisma.oAuthAuthCode.create({
    data: {
      codeHash: hashSecret(code),
      clientId,
      userId,
      redirectUri,
      codeChallenge,
      codeChallengeMethod,
      resource: resource ?? null,
      scope: scope ?? "mcp",
      expiresAt: new Date(Date.now() + AUTH_CODE_TTL_S * 1000),
    },
  });

  // Redirect via URL API — NEVER string-concat (DA FIX-REQUIRED #1).
  const u = new URL(redirectUri);
  u.searchParams.set("code", code);
  if (state) u.searchParams.set("state", state);
  redirect(u.toString());
}

// ---------------------------------------------------------------------------
// Deny
// ---------------------------------------------------------------------------

/**
 * Invoked when the user clicks "Deny" on the consent card.
 *
 * Runs the FULL validateAuthorizeParams (DB lookup) to establish trust in the
 * redirect_uri before sending the user there — never trusts the hidden input raw.
 */
export async function denyAuthorization(formData: FormData) {
  const origin = await getOrigin();
  const params = formDataToParams(formData);
  const validation = await validateAuthorizeParams(params, prisma, origin);

  let redirectUri: string;
  let state: string | undefined;

  if (!validation.ok) {
    if (validation.mode === "redirect" && validation.redirectUri) {
      // Redirect_uri was validated before the later-stage error; safe to use.
      redirectUri = validation.redirectUri;
      state = validation.state;
    } else {
      // Cannot trust redirect_uri (mode === "render"). No safe destination.
      redirect("/signin");
    }
  } else {
    redirectUri = validation.redirectUri;
    state = validation.state;
  }

  const u = new URL(redirectUri);
  u.searchParams.set("error", "access_denied");
  u.searchParams.set("error_description", "User denied the authorization request");
  if (state) u.searchParams.set("state", state);
  redirect(u.toString());
}
