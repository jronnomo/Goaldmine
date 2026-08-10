# PRD: M0 — Build-Time Migration-Status Gate

**Author**: Claude (Tech Lead) + Jerry
**Date**: 2026-08-09
**Status**: In Development
**GitHub Issue**: https://github.com/jronnomo/goaldmine/issues/263
**Branch**: feature/phase1-auth
**UX-research**: skipped — pure infrastructure/build tooling, no UI surface

---

## 1. Overview

### 1.1 Problem Statement
A schema-changing deploy can ship the Next.js build (with a freshly `prisma generate`d client) ahead of the prod database's actual columns — the `completedAt` incident broke every Goal read until a manual `prisma migrate deploy`. There is no CI, no vercel.json, and the build script is bare `next build`; the only protection is a manual runbook step. Story #263 is the P0 the entire program-redesign initiative merges behind.

### 1.2 Proposed Solution
A read-only gate script, `scripts/check-migration-status.ts`, inlined into the npm `build` script (`tsx scripts/check-migration-status.ts && next build`). It runs `prisma migrate status` against `DATABASE_URL` and refuses to let `next build` start when migrations are pending/failed or the state cannot be verified (fail closed). `SKIP_MIGRATION_GATE=1` is the loud emergency bypass, mirroring `ALLOW_PROD_DB_WRITE`. The gate lives in the build script itself — not an npm `prebuild` hook — because Vercel may invoke the build without npm lifecycle hooks.

### 1.3 Success Criteria
- A build against a DB missing an applied migration fails before `next build` starts, with an actionable message.
- A build against an up-to-date DB succeeds unchanged (one extra OK line).
- The gate runs identically in Vercel's production build environment (where `DB_ENV` is not `development`) without invoking any guarded/destructive command.

## 2. User Stories

| ID | As a... | I want to... | So that... | Priority |
|----|---------|--------------|------------|----------|
| US-001 | founder deploying via merge-to-main | the build to refuse when prod's DB is behind the schema | a deploy can never break all reads the way the completedAt incident did | Must Have |
| US-002 | founder mid-outage (Neon unreachable) | a documented loud bypass (`SKIP_MIGRATION_GATE=1`) | an emergency deploy is still possible, consciously | Must Have |
| US-003 | developer building locally against the dev branch | `npm run build` to behave exactly as before when my DB is current | no new friction in the common case | Must Have |

## 3. Functional Requirements

### 3.1 Core
1. `scripts/check-migration-status.ts` spawns `npx prisma migrate status`, captures exit code + output.
2. Up-to-date → exit 0, print `✓ migration gate: database schema is up to date (host: <masked>)`.
3. Pending or failed migrations → exit 1, stderr block naming the pending migrations (from status output) and the fix (`prisma migrate deploy` per runbook).
4. Cannot verify (unset `DATABASE_URL`, connection error, unexpected CLI failure) → exit 1, stderr distinguishes "could not verify" from "pending migrations"; mentions `SKIP_MIGRATION_GATE=1`.
5. `SKIP_MIGRATION_GATE=1` → loud ⚠ stderr warning, exit 0 without running the check.
6. `package.json` `build` = `"tsx scripts/check-migration-status.ts && next build"`; `postinstall` untouched.

### 3.2 Secondary
1. Script header documents the pooled-URL fallback design (direct `_prisma_migrations` SELECT diffed against `prisma/migrations/*`) in case `prisma migrate status` misbehaves through Neon pooling on Vercel — not built in v1.

### 3.3 Out of Scope
Running `migrate deploy` automatically (prod migrations stay manual); CI setup; vercel.json; any schema change; changes to `db-guard.ts`.

## 4. Technical Design

### 4.1 Data Model — N/A (zero migrations; the script only reads `_prisma_migrations` via the Prisma CLI).
### 4.2 MCP Tool Surface — N/A.
### 4.3 Server Actions — N/A.
### 4.4 Pages / Components — N/A.
### 4.5 Date / Time Semantics — N/A (no date math).
### 4.6 Deferral / Override Awareness — N/A.

### 4.7 Tenant Scoping & Auth
No app DB access; the script shells out to the Prisma CLI read-only. Never prints credentials — masked host only (reuse the `maskedHost()` idiom from `scripts/db-guard.ts:14-23`). No import-time side effects beyond `dotenv/config` + env reads.

### 4.8 Third-Party Dependencies
None new. `tsx` (devDependency, present) runs the script; Vercel installs devDependencies during `npm install`, so `tsx` is available at build time.

## 5. UI/UX — N/A (build tooling).

## 6. Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|------------------|
| DB up to date | exit 0, one OK line, `next build` proceeds |
| Pending migration(s) | exit 1 before `next build`; names them; suggests runbook `prisma migrate deploy` |
| Failed migration recorded in `_prisma_migrations` | exit 1; surfaces the prisma status output |
| `DATABASE_URL` unset | exit 1, "could not verify" |
| Connection refused / Neon outage | exit 1, "could not verify" + bypass hint (fail closed per owner decision) |
| `SKIP_MIGRATION_GATE=1` | loud ⚠ warning, exit 0, check skipped |
| Vercel env (`DB_ENV` ≠ development) | identical behavior — no guarded command invoked, read-only |
| prisma CLI prints unexpected format | treated as "could not verify" → exit 1 (fail closed) |

## 7. Security Considerations
Read-only child process; no destructive Prisma commands; credentials never echoed (masked host only, per repo never-echo rule); no new routes/endpoints; bypass requires explicit env var and prints a warning.

## 8. Acceptance Criteria
1. [ ] `npx tsc --noEmit` 0 errors (script included in the TS project or cleanly excluded per existing scripts convention)
2. [ ] `npm run lint` no new errors
3. [ ] `npm run test` no new failures
4. [ ] `npm run build` (dev DB current) succeeds with the OK line
5. [ ] With a throwaway unapplied migration dir present, `npm run build` exits non-zero before `next build`, naming the pending migration
6. [ ] `SKIP_MIGRATION_GATE=1 npm run build` with that dir present proceeds past the gate with a ⚠ warning
7. [ ] With `DATABASE_URL` unset in a scratch shell, the script exits 1 with the could-not-verify message
8. [ ] `postinstall` unchanged; no schema/migration files in the diff
9. [ ] Vercel build-command setting verified & recorded (dashboard uses `npm run build` or was updated to)

## 9. Open Questions
None — connection-failure policy (fail closed + `SKIP_MIGRATION_GATE=1`) and proof method (local + record Vercel setting) resolved by owner 2026-08-09.

## 10. Test Plan
- Gates: tsc / lint / vitest / build (10.1).
- Gate proof: create `prisma/migrations/99999999999999_gate_proof/` with a comment-only `migration.sql` (never applied to any DB) → `npm run build` fails; remove dir → build passes; `SKIP_MIGRATION_GATE=1` bypass verified. Console output captured in the completion report.
- MCP curl / browser smoke: N/A (no app-surface change).
- Migration verification: N/A (no migrations).

## 11. Appendix
Discovery: `build` confirmed bare `next build` (`package.json:7`); no `prebuild`; `postinstall` runs `prisma generate` (`package.json:18`) — the unprotected path. Pattern source: `scripts/db-guard.ts`. Roadmap context: DA Critical #2 (`.roadmap/2026-08-09-program-redesign/agents/plan-critique.md`) — npm `prebuild` may never fire on Vercel, hence build-script inlining. References: issue #263, epic #256, `docs/roadmap/program-redesign-plan.md` §5 Sprint 14.
