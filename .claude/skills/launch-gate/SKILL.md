---
name: launch-gate
description: Cheap, fast pre-deploy readiness checks for goaldmine — run before merging any branch to main (main auto-deploys to prod on Vercel). Code gates, migration-safety diff, tenant/leaky-read coverage, secret hygiene, connector-cache reminder. Read-only; reports PASS/FAIL per gate and a READY/NOT-READY verdict. Fixes nothing.
argument-hint: (no arguments needed)
---
# /launch-gate — Pre-Deploy Readiness Check (goaldmine)

**Merging to `main` = deploying to prod** (Vercel auto-builds `main`; no PR ceremony exists). Run every gate below from the repo root before that merge. Each is a cheap read-only check — no writes, no fixes. Report a PASS/FAIL table at the end with failing evidence. **Fix nothing** — this is a gate, not a fixer; point at the tracking issue where one exists.

The comparison base is `main` throughout — resolve the merge target first:

```bash
BASE=main
git fetch origin "$BASE" --quiet
```

## Gate 1 — Branch & worktree hygiene

```bash
git branch --show-current && pwd
git status --short | head -20
git log --oneline "origin/$BASE..HEAD" | head -20
git worktree list
ls .claude/worktrees/ 2>/dev/null
```

**PASS:** you are in the main checkout (not a drifted worktree cwd), no uncommitted changes destined for the merge are missing, and no stale agent worktrees/branches remain (`worktree-agent-*` merged branches should be pruned). Stale `.claude/worktrees/*/.next` artifacts also poison Gate 2's lint — flag them.

## Gate 2 — Code gates

```bash
npx tsc --noEmit 2>&1 | tail -3
npm run lint 2>&1 | tail -5
npm run test 2>&1 | tail -5
npm run build 2>&1 | tail -5
```

**PASS:** 0 type errors, no new lint errors, full Vitest suite green (~540 tests), production build succeeds. (Skip `build` only if the dev server holds `.next` — then it must be run before the actual merge.)

## Gate 3 — Migration safety (migrations deploy to prod)

```bash
git diff "origin/$BASE" --stat -- prisma/migrations prisma/schema.prisma
git diff "origin/$BASE" -- prisma/migrations | grep -inE "DROP TABLE|DROP COLUMN|ALTER COLUMN .* SET NOT NULL|TRUNCATE" 
npm run db:which
```

**PASS:** any new migration SQL is additive (no destructive ops without an explicit, user-acknowledged plan), and local `db:which` still points at the dev branch. If the schema changed at all, the SQL diff must have been read by a human (you, now — read it and summarize it in the report).

## Gate 4 — Tenant scoping & leaky reads

```bash
# owned-model access added on this branch must go through getDb() —
# find added lines using the raw singleton, then exclude auth/OAuth-infra models
git diff "origin/$BASE" -- src/ | grep "^+" | grep -E "\bprisma\.[a-z]" \
  | grep -vE "prisma\.(user|account|session|verificationToken|invite|oAuth[A-Za-z]*)\b" | head -10
# the authoritative scoped-model list lives in src/lib/db.ts (SCOPED_MODELS, 17 models) — check hits against it
# new read tools need leaky-reads coverage
git diff "origin/$BASE" --stat -- src/lib/mcp/
git diff "origin/$BASE" -- src/lib/mcp/leaky-reads.test.ts | head -5
npm run db:verify-owned 2>&1 | tail -2
```

**PASS:** no new raw-`prisma` access to owned models outside auth/OAuth infra (the grep is a heuristic — read any hits in context); if the branch adds/changes MCP **read** tools, `leaky-reads.test.ts` was touched too; `db:verify-owned` reports 0 unowned rows. If an owned model was added, `npm run db:verify-isolation` must also be green (run it — it's dev-DB-only and self-cleaning).

## Gate 5 — Secret & env hygiene

```bash
git diff "origin/$BASE" --name-only | grep -E "^\.env" && echo "ENV FILE IN DIFF — FAIL"
git diff "origin/$BASE" | grep -inE "[0-9a-f]{32,}|AUTH_SECRET=|UPSTASH_.*TOKEN=|MCP_AUTH_TOKEN=\"?[0-9a-f]" | head -5
grep -rn "OPEN_SIGNUP" .env.example
```

**PASS:** no `.env*` file in the diff, no token-looking literals committed, and nothing on the branch flips signup open by default (`OPEN_SIGNUP` stays a documented opt-in, gated signup remains the default posture). Any hit needs to be read in context before calling it a false positive.

## Gate 6 — Auth surface untouched or tested

```bash
git diff "origin/$BASE" --stat -- src/lib/auth src/lib/oauth src/middleware.ts src/app/oauth src/app/api/auth
```

**PASS:** either these paths are untouched, or they changed AND their test suites are green in Gate 2 (`src/lib/oauth/` and `src/lib/auth/` are fully unit-tested — a change here with no corresponding `*.test.ts` change in the diff is a flag, not an automatic fail; read the change).

## Gate 7 — MCP connector-cache reminder

```bash
git diff "origin/$BASE" --stat -- src/lib/mcp/tools.ts src/lib/mcp/tools/ src/lib/mcp/instructions.ts
```

**Informational (cannot FAIL):** if the tool surface or server instructions changed, the deploy report MUST include: *"claude.ai connector caches the old tool list — disconnect/reconnect the Goaldmine connector after deploy."* Saved prompts / the Sunday routine may also need a manual refresh.

## Gate 8 — Open blockers

```bash
gh issue list -R jronnomo/goaldmine --state open --label "critical" --json number,title --jq '.[] | "#\(.number) \(.title)"' 2>/dev/null || echo "(no critical label — listing recent open issues)"
gh issue list -R jronnomo/goaldmine --state open --limit 10
```

**PASS:** zero open issues the user has marked launch-blocking. When in doubt, show the list and let the user judge.

## Gate 9 — Post-deploy smoke plan (informational)

Include in the report the two commands the user runs after Vercel finishes:

```bash
curl -s https://workout-planner-gold-three.vercel.app/api/mcp \
  -X POST -H "Authorization: Bearer $MCP_AUTH_TOKEN" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -c 300
```

plus a phone-width visit to `/` signed in. (Vercel project keeps the legacy `workout-planner-gold-three` name.)

---

## Report format

```
# Launch Gate — <date> · branch <name> → main
| # | Gate | Result | Evidence |
|---|------|--------|----------|
| 1 | Branch/worktree hygiene | PASS/FAIL | ... |
| 2 | tsc / lint / vitest / build | PASS/FAIL | ... |
| 3 | Migration safety | PASS/FAIL/N-A | <summary of SQL diff> |
| 4 | Tenant scoping + leaky reads | PASS/FAIL | ... |
| 5 | Secret/env hygiene | PASS/FAIL | ... |
| 6 | Auth surface | PASS/FLAG/N-A | ... |
| 7 | Connector reminder | INFO | needed / not needed |
| 8 | Open blockers | PASS/FAIL | ... |
| 9 | Post-deploy smoke plan | INFO | included |

VERDICT: READY TO MERGE & DEPLOY / NOT READY — N gate(s) failing
```

Tell the user the verdict, each failing gate with its evidence, and the post-deploy checklist (including the connector reconnect if Gate 7 fired). **The merge itself stays with the user** — this skill never merges or pushes `main`.
