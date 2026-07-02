---
name: test-app
description: Run a full end-to-end sweep of the goaldmine app — code gates (tsc/lint/vitest/build), MCP curl smoke across the tool surface, browser walkthrough of every major route at phone width, tenant-isolation verifiers. Observer-only; generates a timestamped report folder in test-reports/.
argument-hint: (no arguments needed)
---
# /test-app — Full App Integration Test (goaldmine)

Run a comprehensive end-to-end test of goaldmine. **You are an observer only — do not fix bugs, do not edit app source code.** When something fails, document it thoroughly and continue testing the remaining surface. Every failure gets a root-cause analysis and a proposed fix written into the report, but nothing is changed.

Ground rules come from `.claude/quality-tools.md` (gates, gotchas) and `docs/project-gotchas.md` (§B). Read both before starting.

---

## Step 0 — Setup

Create the run directory and persist its path to a dotfile (**`$RUN_DIR` does not survive across Bash tool calls** — every later command must start with `RUN_DIR="$(cat .current-test-run)"`):

```bash
RUN_DIR="$(pwd)/test-reports/$(date +%Y-%m-%d-%H%M)-report"
mkdir -p "$RUN_DIR"/{gates,mcp,browser/screenshots,isolation}
echo "$RUN_DIR" > .current-test-run
echo "$RUN_DIR"
```

> **cwd drift — always use subshells.** Wrap any directory change in `(cd X && cmd)` so the working directory never drifts (this has bitten orchestrator runs in this repo before).

Create `$RUN_DIR/summary.md` with a Gates table (all rows "pending"): DB target · tsc · lint · vitest · build · dev server · MCP tools/list · MCP read battery · MCP write round-trip · browser walkthrough · verify-owned · verify-isolation.

## Step 1 — DB target gate (halt condition)

```bash
npm run db:which
```

**Must show the Neon dev branch (`DB_ENV=development`).** If it shows prod or anything ambiguous — **STOP immediately**, tell the user, and do not run anything that touches the DB (vitest is safe — no live DB — but the MCP write round-trip and the isolation verifier are not).

## Step 2 — Code gates

Run each, capture full output to `$RUN_DIR/gates/`, update the summary. **Do not fix failures — record and continue.**

1. `npx tsc --noEmit`
2. Worktree-pollution pre-check, then lint: `ls .claude/worktrees/ 2>/dev/null` — if merged/stale worktrees exist, note that phantom eslint errors may come from their `.next` artifacts (do NOT delete them yourself; flag for the user). Then `npm run lint`.
3. `npm run test` (Vitest, ~540 tests; no live DB needed)
4. `npm run build` — **only if the dev server is NOT already running** (build and dev share `.next`). If dev is up on :3000, record "skipped — dev server running" and rely on tsc+lint+vitest.

## Step 3 — Dev server

Check whether goaldmine (not some other app) is on :3000 — an auth-protected app redirects or renders the sign-in page, so check for a goaldmine marker rather than a bare 200:

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/
curl -s http://localhost:3000/signin | grep -qi "goaldmine\|sign in" && echo "goaldmine UP" || echo "DOWN or different app on :3000 (lsof -i :3000)"
```

If DOWN, start it yourself (`npm run dev` with `run_in_background: true`) and poll until it answers — unlike an external backend, this is our own app and starting it is fine. Re-check the server is still up before Step 4 and before Step 5 (a mid-run crash makes every later check fail in a way that looks like app bugs).

## Step 4 — MCP curl smoke

Uses the legacy bearer path (the local smoke surface; OAuth 2.1 is prod-primary). **Never echo the token.**

```bash
TOKEN="$(grep MCP_AUTH_TOKEN .env | cut -d'"' -f2)"
mcp() { curl -s -X POST http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" -d "$1"; }
```

1. **tools/list** — record the tool count (~106) and diff the names against `git show main:src/lib/mcp/tools.ts` registrations if the branch changed the surface.
2. **Read battery** — `tools/call` each of: `get_today_plan`, `get_session_brief`, `list_goals`, `get_week`, `get_day` (today's dateKey), `compute_readiness`, `get_records_summary`, `recent_history`. For each: valid JSON, no error, shape sane, and **no private note types** (`standing_rule`/`review`/`open_item`) in any read payload.
3. **Write round-trip (reversible only, dev DB confirmed in Step 1)** — `log_note` a marker note → confirm it appears via `get_pending_notes` → `delete_note` it. Do NOT exercise plan-mutating writes (`apply_plan_revision`, `apply_day_override`, `baseline_ops`) — those are covered by unit tests and are not safely reversible.

Write results to `$RUN_DIR/mcp/report.md` (tool → PASS/FAIL → evidence).

## Step 5 — Browser walkthrough (phone width)

Use Claude-in-Chrome (load the core tools via ONE ToolSearch call, per its skill). Resize to ~390px width. **Auth:** routes are protected — if localhost shows the sign-in page and no session exists, **halt this step and ask the user to sign in** (Google OAuth is not yours to automate); resume after.

Walk every major route, screenshot each to `$RUN_DIR/browser/screenshots/`, and check the console for errors per page (`read_console_messages`):

`/` (Today — QuestCard, resolved task, readiness) · `/calendar` (+ compare-mode two-tap) · `/days/<today>` · `/goals` + one goal detail (plan, trends) · `/progress`, `/stats`, `/baselines` · `/character` · `/recap` · `/compare` · `/nutrition` · `/history` · `/journal` · `/settings` (connected apps) · `/import` (view only — don't import).

- **Known pre-existing issue:** a hydration mismatch fires on `/compare` and `/days` (BottomSheet/Suspense streaming). Check `/days` FIRST to establish the baseline — do not attribute this error to whatever feature you're near.
- **Cross-check UI vs MCP:** Today's rendered task/baselines must agree with the Step-4 `get_today_plan` payload. Disagreement is a real finding.
- Dark/light: toggle the theme once (More sheet) and confirm a page renders correctly in both.

Write `$RUN_DIR/browser/report.md` — one row per route: PASS/FAIL, console errors, screenshot filename, what was verified.

## Step 6 — Tenant isolation verifiers

(Dev DB confirmed in Step 1; these create + clean up throwaway users.)

```bash
npm run db:verify-owned
npm run db:verify-isolation
```

Record pass counts to `$RUN_DIR/isolation/report.md`.

## Step 7 — Final summary & verdict

Complete `$RUN_DIR/summary.md`: the Gates table, a per-area results table, and an **All Bugs Found** table. Classify every failure:

- **`app-bug`** — the app genuinely misbehaves (crash, wrong data, dead-end navigation, UI/MCP disagreement, console error that isn't the known hydration one).
- **`test-infrastructure`** — the check itself is stale (route renamed, tool renamed, this skill's expectations out of date). Verify by reading source before classifying; propose the corrected check.

Each bug: type, severity, exact failure, evidence (screenshot/curl output), root cause (reading source is always allowed), proposed fix with `file:line`.

**Verdict:** `APP PASSING — all gates green, 0 app bugs` or `APP NOT PASSING — N bug(s); see <RUN_DIR>`. Tell the user the run directory, the verdict, and the bug breakdown.

---

## Rules (enforced — no exceptions)

1. **Never edit app source** (`src/`, `prisma/`, `scripts/`) — observer only. Reading is always allowed.
2. **Never run against prod** — Step 1's `db:which` gate is a hard halt condition.
3. **Never echo secrets** — `MCP_AUTH_TOKEN` and friends never appear in output, reports, or screenshots.
4. **Only reversible MCP writes** — the log_note/delete_note round-trip is the ceiling.
5. **Continue after every failure** — one failing area never stops the run.
6. **Classify every bug** — `app-bug` vs `test-infrastructure`.
7. **Recover `RUN_DIR` from `.current-test-run`** at the start of every Bash call that needs it; wrap directory changes in subshells.
8. **Don't automate Google sign-in** — if there's no session, ask the user.
9. **Context ≥ 85%** — follow the global handoff protocol; include which steps completed, bugs so far, and the `$RUN_DIR` path.
