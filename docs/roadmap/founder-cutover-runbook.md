# Founder Cutover — Prod Runbook (F-2)

Story: A-5 · Milestone: F-2 (prod deployment)

## Background

`usr_founder` owns all real data (workouts, goals, notes, etc.) but initially has `email = NULL` and no linked Google Account. The first time the founder signs in to the deployed prod app with Google, Auth.js creates a **throwaway** User with the Google email and a linked Account + Session. This script re-points those auth rows from the throwaway onto `usr_founder`, so A-2's session-based `getCurrentUserId` resolves correctly to the founder's data.

This runbook documents the **prod** cutover at F-2. The same script was already run against dev (A-5, 2026-07-01) — that run is the proof-of-concept.

## Pre-conditions

1. A-2 is NOT yet deployed to prod (the seam flip to session-based auth). This must run **before** A-2 goes live.
2. The prod deployment is live on Vercel and pointed at the **prod** Neon branch.
3. The founder has signed in once on prod with Google (the throwaway user now exists on prod).
4. `npm run db:which` against prod must show the prod host (not the dev branch).

## Step-by-step

### 1. Verify the throwaway was created on prod

Connect to prod (via Prisma Studio or raw psql) and confirm:
- A User row exists with `email = 'ggronnii@gmail.com'` and `id != 'usr_founder'`.
- That user has 1 Account with `provider = 'google'`.
- `usr_founder` still has `email = NULL`.

### 2. Pull the script to prod context

The script is committed on `feature/phase1-auth` (and merged to `main` at release). Ensure you are running from the repo root with prod env vars loaded.

### 3. Point DATABASE_URL at prod

In your shell (do NOT edit `.env`):

```bash
export DATABASE_URL="<prod-neon-connection-string>"
export DB_ENV="production"   # or unset — either triggers the guard
```

Confirm with:
```bash
npm run db:which
```
It should print the prod host.

### 4. Run the cutover

```bash
ALLOW_PROD_DB_WRITE=1 \
FOUNDER_GOOGLE_EMAIL=ggronnii@gmail.com \
npx tsx scripts/founder-cutover.ts
```

The script will:
1. Find the throwaway (User with `email=ggronnii@gmail.com`, Google Account, 0 tenant rows).
2. In one atomic transaction: move the Account + Session to `usr_founder`, delete the throwaway, set `usr_founder.email = 'ggronnii@gmail.com'`.
3. Print a BEFORE / AFTER summary and confirm data counts are unchanged.

Expected output (key lines):
```
BEFORE:
  usr_founder.email       : NULL
  usr_founder workouts    : <N>
  usr_founder goals       : <M>

Throwaway candidate: id=<cuid>  email=ggronnii@gmail.com
  tenant rows     : 0 (OK — safe to delete)

Executing 4-step re-point transaction...
  [1] account.updateMany → 1 row(s) moved to usr_founder
  [2] session.updateMany → 1 row(s) moved to usr_founder
  [3] user.delete → throwaway id=<cuid> deleted
  [4] user.update → usr_founder.email set to "ggronnii@gmail.com"

AFTER:
  usr_founder.email       : ggronnii@gmail.com
  usr_founder account count: 1 (providers: google)
  throwaway gone          : YES ✓
  usr_founder workouts    : <N> (was <N>)
  usr_founder goals       : <M> (was <M>)

✓  Founder cutover complete.
```

### 5. Verify on prod

Run the null-userid guard against prod:

```bash
npm run db:verify-owned
```

Expected: `✓ All 16 tables clean — 0 unowned rows. Exit 0.`

Confirm in Prisma Studio (or psql) that:
- `usr_founder.email = 'ggronnii@gmail.com'`
- `usr_founder` has 1 Account with `provider = 'google'`
- The throwaway user is gone
- Workout / goal counts are unchanged

### 6. Re-run to confirm idempotency

```bash
ALLOW_PROD_DB_WRITE=1 \
FOUNDER_GOOGLE_EMAIL=ggronnii@gmail.com \
npx tsx scripts/founder-cutover.ts
```

Expected: `✓  Already cutover: usr_founder.email="ggronnii@gmail.com" and has a google Account. No-op. Exit 0.`

### 7. Deploy A-2

The session seam flip (A-2) is now safe to deploy. `getCurrentUserId` will resolve the active session to `usr_founder`, which owns all real data.

## Rollback

If anything goes wrong **before** A-2 is deployed, the app still works (it uses the Phase-0 hard-coded `FOUNDER_USER_ID` fallback, not the session). To restore the pre-cutover state:

1. Re-create the throwaway user row with the same email (Auth.js will do this automatically on next sign-in).
2. Move the Account back with a manual `UPDATE "Account" SET "userId" = '<throwaway-id>' WHERE "userId" = 'usr_founder' AND provider = 'google'`.
3. Null out `usr_founder.email`.

This is unlikely to be needed — the script is atomic and the throwaway owned 0 real rows.

## Security notes

- `ALLOW_PROD_DB_WRITE=1` is a gate, not a bypass of safety checks. The script still verifies 0 tenant rows on the throwaway and refuses otherwise.
- Never commit prod's `DATABASE_URL` to any file. Pass it via env only.
- The script uses raw `prisma` (not `getDb`) because this is a cross-user identity operation — the scoped client is intentionally bypassed.
