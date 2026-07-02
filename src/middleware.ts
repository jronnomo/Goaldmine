/**
 * B-1 — Route-protection middleware (optimistic cookie-presence gate)
 *
 * Next.js 16 note: `middleware.ts` is deprecated in favour of `proxy.ts`
 * (Node.js runtime). We intentionally keep the `middleware.ts` convention
 * because: (a) edge runtime is required for this to run before every request
 * with minimal latency, (b) edge runtime is NOT available in `proxy.ts`
 * per the Next.js 16 upgrade guide, and (c) `middleware.ts` is still fully
 * supported — only the name is deprecated.
 *
 * Design (from PRD B-1):
 *   - OPTIMISTIC gate: we can't call auth() / Prisma in the edge runtime.
 *     We check for the Auth.js session cookie; if present we pass through
 *     (an expired/forged cookie is caught later by the real seam in RSC).
 *   - Session cookie names (per @auth/core):
 *       HTTP  → `authjs.session-token`
 *       HTTPS → `__Secure-authjs.session-token`
 *   - Public paths bypass the cookie check entirely (see route-access.ts).
 *   - Redirect carries ?next= so /signin can restore the original destination.
 *
 * NO next-auth import — this file must stay edge-safe (no Prisma, no DB).
 */

import { NextRequest, NextResponse } from "next/server";
import { isPublicPath } from "@/lib/auth/route-access";

export function middleware(req: NextRequest): NextResponse {
  const { pathname, search } = req.nextUrl;

  // Public paths are always allowed — no cookie check needed.
  if (isPublicPath(pathname)) {
    const res = NextResponse.next();
    // C-2: Frame-busting headers for the OAuth consent screen.
    // Prevents clickjacking on the Allow/Deny buttons.
    // Set here (in middleware) because Next.js 16 RSC pages cannot set
    // arbitrary response headers directly.
    if (pathname === "/oauth/authorize") {
      res.headers.set("X-Frame-Options", "DENY");
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
    }
    return res;
  }

  // Optimistic session-cookie check (HTTP or HTTPS variant).
  const hasSession =
    req.cookies.has("authjs.session-token") ||
    req.cookies.has("__Secure-authjs.session-token");

  if (hasSession) {
    return NextResponse.next();
  }

  // No session cookie → redirect to /signin with original path preserved.
  const next = encodeURIComponent(pathname + search);
  const signinUrl = new URL(`/signin?next=${next}`, req.url);
  return NextResponse.redirect(signinUrl, 307);
}

export const config = {
  /*
   * Run middleware on ALL paths EXCEPT:
   *   - _next/       Next.js internals (static files, image optimisation, RSC data)
   *   - favicon      browser favicon (favicon.ico, favicon.png, …)
   *   - icon         PWA / browser icon (icon.png, icon-192.png, …)
   *   - apple-       Apple touch icons (apple-touch-icon.png, …)
   *   - manifest.webmanifest  PWA manifest
   *   - zxing/       barcode-scanner WASM assets
   *   - Any path whose last segment ends with a file extension
   *     (catches .css, .js, .png, .woff2, .map, etc.)
   *
   * Correctness is enforced by isPublicPath; this matcher is purely a
   * performance guard so middleware never even runs on static assets.
   */
  matcher: [
    "/((?!_next/|favicon|icon|apple-|manifest\\.webmanifest$|zxing/)(?!.*\\.[a-zA-Z0-9]{1,10}(?:\\?.*)?$).*)",
  ],
};
