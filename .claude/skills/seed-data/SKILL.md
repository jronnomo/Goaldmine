---
name: seed-data
description: Provision the goaldmine dev database — confirm the Neon dev branch target, run the guarded seed (founder + program), mint invite codes for test signups, and optionally seed a test goal. Never touches prod without explicit user intent.
argument-hint: [optional: "invite" | "invite for a@b.com" | "goal"]
---
# /seed-data — Dev-Branch Data Provisioning (goaldmine)

Provision known data on the **Neon dev branch** so features and tests have something to work with. Unlike chewgather's wipe-and-reseed, goaldmine's seed is **idempotent and additive** — nothing here wipes data. The source of truth is always the scripts themselves (`prisma/seed.ts`, `scripts/mint-invite.ts`, `scripts/seed-goal.ts`); if their output disagrees with this doc, trust the output and update this doc.

`$ARGUMENTS` may narrow the run: `invite` (just mint codes), `goal` (just the test goal), or empty (full provisioning pass).

---

## Step 0 — Confirm the target (always, before anything)

```bash
npm run db:which
```

**Must print the dev branch host with `DB_ENV=development`.** If it shows prod: STOP and tell the user. The seed and goal scripts are gated by `db-guard.ts` anyway (fail-closed), but `mint-invite.ts` is deliberately **NOT guarded** (minting invites on prod is legitimate) — so the target check matters most for invites.

## Step 1 — Base seed (founder + program)

```bash
npm run db:seed
```

What it does (per `prisma/seed.ts`): upserts the founder user (`usr_founder`, or `FOUNDER_USER_ID` from `.env`), then creates the active program from `PROGRAM_TEMPLATE` — **skipping if an active program already exists**. Safe to re-run.

Report what the script printed (founder id, program created vs skipped).

## Step 2 — Mint invite code(s) (invite-gated signup)

```bash
npx tsx scripts/mint-invite.ts [--email a@b.com] [--max-uses 5] [--expires-days 30] [--note "dev testing"]
```

- The script prints the **target DB host** — verify it's the dev branch before accepting the result (this script has no guard).
- Default: 1 single-use, non-expiring code. For a batch of test signups use `--max-uses`.
- Signup flow to hand the code to: `/request-access` → sign in with Google → invite code gate (`OPEN_SIGNUP` in `.env` bypasses the gate entirely — check its value if signups behave unexpectedly).

**Never print invite codes into committed files or reports** — hand them to the user in the conversation only.

## Step 3 (optional) — Test goal

```bash
npx tsx scripts/seed-goal.ts
```

Read the script first (`scripts/seed-goal.ts`) and tell the user what it will create before running — goal seeding shapes what `get_today_plan` and the dashboard show. Related inspectors if verification is needed: `scripts/inspect-plan.ts`, `scripts/inspect-readiness.ts`.

## Step 4 — Verify + report

```bash
npm run db:verify-owned    # 0 unowned rows
```

Then summarize to the user:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  DEV DATA PROVISIONED  (host: <dev branch host>)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Founder:   usr_founder (ready)
  Program:   created | already active (skipped)
  Invites:   N code(s) minted (codes shared in chat, not persisted here)
  Test goal: seeded | skipped
  verify-owned: PASS (0 unowned rows)
```

---

## Rules

1. **`npm run db:which` first, every invocation** — especially before mint-invite (unguarded).
2. **Prod invites only on explicit request** — if the user asks to mint a prod invite, confirm the host they expect, then proceed (that's the legitimate unguarded use).
3. **Nothing here wipes data** — if the user wants a clean slate, that's a Neon-branch reset (recreate the dev branch from the console/neonctl), not this skill; say so and stop.
4. **Never echo secrets or persist invite codes** to files/reports.
5. Multi-user testing note: a second signed-in user (via a minted invite + a second Google account) is the realistic way to exercise tenant isolation in the browser; `npm run db:verify-isolation` covers it at the data layer with throwaway users.
