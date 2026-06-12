# QA Runbook — Sprint 4: Goal-Type-Aware Project UI

**Date**: 2026-06-12  
**QA Gate**: #58 browser smoke — must pass before closing issues #35–#40  
**Dev server**: `:3199` (run `npm run dev -- -p 3199`)  
**Reference commit**: `11d5710` (Sprint 3 HEAD)  
**Sprint 4 HEAD**: `78fee81`

---

## RECOVERY SECTION

If the runbook is interrupted mid-run, use this to resume safely:

- **Live data safety**: All fixture writes go to the Neon-shared DB (same as prod). The cleanup step (Step 6) is mandatory. Never skip it.
- **Focus-goal restoration**: Before cleanup, confirm the active fitness goal has `isFocus=true`. If the test left focus on a temp project goal, run the DB snippet in Step 6 first.
- **Temp goal IDs**: Record them from the create_goal curl responses. Without IDs, cleanup requires `list_goals`.
- **Orphaned ScheduledItems**: If cleanup is interrupted after goal delete, items cascade automatically (Prisma `onDelete: Cascade` on `goalId`).

---

## Prerequisites

```sh
# Ensure .env is present and MCP_AUTH_TOKEN is set
TOKEN="$(grep MCP_AUTH_TOKEN .env | cut -d'"' -f2)"
echo "Token: ${TOKEN:0:8}..."   # Should show first 8 chars

# Note: schedule_item and log_metric are NOT yet registered MCP tools.
# Fixtures requiring ScheduledItems and LogEntries use direct DB access:
DB_EXEC='npx tsx --env-file=.env -e'

# Start dev server on port 3199
npm run dev -- -p 3199 &
```

---

## Step 1: Fitness Reference Pass

Save the fitness HTML for byte-identical regression comparison.

```sh
# 1a. Save Today reference
curl -s http://localhost:3199/ -H "Cookie: your-session-cookie" \
  -o /tmp/qa-today-fitness-ref.html

# 1b. Save Calendar reference (2026-06)
curl -s "http://localhost:3199/calendar?year=2026&month=5" \
  -o /tmp/qa-calendar-fitness-ref.html

# 1c. Save Progress reference
curl -s http://localhost:3199/progress -o /tmp/qa-progress-fitness-ref.html

# 1d. Confirm fitness goal isFocus=true in DB
npx tsx --env-file=.env -e "
import { prisma } from './src/lib/db';
const goals = await prisma.goal.findMany({ where: { isFocus: true }, select: { id: true, objective: true, kind: true, isFocus: true } });
console.log('Focus goals:', JSON.stringify(goals, null, 2));
await prisma.\$disconnect();
" 2>/dev/null
```

Record the fitness focus goal id as `FITNESS_GOAL_ID`.

---

## Step 2: Create Temp Project Goal A (with full fixtures)

### 2a. Create the goal

```sh
curl -s -X POST http://localhost:3199/api/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "create_goal",
      "arguments": {
        "objective": "QA Temp Project A — delete me",
        "targetDate": "2026-09-15",
        "kind": "project"
      }
    }
  }' | python3 -m json.tool
```

Record `GOAL_A_ID` from the response.

### 2b. Create ScheduledItems (direct DB — schedule_item MCP tool not yet shipped)

```sh
npx tsx --env-file=.env -e "
import { prisma } from './src/lib/db';
import { startOfDay, addDays } from './src/lib/calendar';
const now = new Date();
const today = startOfDay(now);
// One task and one milestone today
await prisma.scheduledItem.createMany({ data: [
  { goalId: 'REPLACE_GOAL_A_ID', type: 'task',      title: 'QA Task Today',    status: 'planned', date: today },
  { goalId: 'REPLACE_GOAL_A_ID', type: 'milestone', title: 'QA Milestone 1',   status: 'planned', date: addDays(today, 10) },
  { goalId: 'REPLACE_GOAL_A_ID', type: 'milestone', title: 'QA Milestone 2',   status: 'done',    date: addDays(today, -5) },
  { goalId: 'REPLACE_GOAL_A_ID', type: 'launch-step', title: 'QA Launch Step', status: 'planned', date: addDays(today, 30) },
]});
console.log('ScheduledItems created');
await prisma.\$disconnect();
" 2>/dev/null
```

### 2c. Create a LogEntry for MRR (direct DB — log_metric MCP tool not yet shipped)

```sh
npx tsx --env-file=.env -e "
import { prisma } from './src/lib/db';
const now = new Date();
await prisma.logEntry.create({ data: {
  goalId: 'REPLACE_GOAL_A_ID',
  metric: 'mrr',
  value: 450,
  date: now,
}});
console.log('LogEntry created');
await prisma.\$disconnect();
" 2>/dev/null
```

### 2d. Set MRR target on goal A

```sh
curl -s -X POST http://localhost:3199/api/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "update_goal_targets",
      "arguments": {
        "goalId": "REPLACE_GOAL_A_ID",
        "targets": [{ "metric": "log:mrr", "target": 1000, "weight": 1.0, "label": "MRR" }]
      }
    }
  }' | python3 -m json.tool
```

### 2e. Set Goal A as focus (direct DB — no MCP set_active_goal tool)

```sh
npx tsx --env-file=.env -e "
import { prisma } from './src/lib/db';
// Clear all focus flags first, then set Goal A
await prisma.goal.updateMany({ where: { isFocus: true }, data: { isFocus: false } });
await prisma.goal.update({ where: { id: 'REPLACE_GOAL_A_ID' }, data: { isFocus: true } });
console.log('Goal A is now focus');
await prisma.\$disconnect();
" 2>/dev/null
```

---

## Step 3: Project Goal A — Assert All Four Surfaces at 390px

Open DevTools → mobile emulation → 390px width → navigate to each surface.

### 3a. Today (`/`)

Assertion checklist:
- [ ] `data-testid="project-today-view"` renders (no fitness QuestCard)
- [ ] Accent-soft ribbon with 2px left accent rail (`border-l-2` + `borderLeftColor: var(--accent)`)
- [ ] Goal objective in eyeline ("QA Temp Project A")
- [ ] Days-to-launch chip present (should show ~95d to launch)
- [ ] Bullseye shows progressive rings at `progress = 0/1 = 0` (hollow)
- [ ] Checklist shows 1 item: "QA Task Today" with type badge "task"
- [ ] Row is ≥44px tap target (link row to `/days/2026-06-12`)
- [ ] `data-testid="project-today-checklist"` present
- [ ] `data-testid="mrr-progress-card"` present with "$450 / $1,000 MRR"
- [ ] Thin accent scope bar at ~45% width (no CSS transition class)
- [ ] `data-testid="next-milestone-card"` present with "QA Milestone 1"
- [ ] Urgency chip: check if ≤14d → warning color; >14d → no chip (10d should show chip)
- [ ] No CharacterHeader / RPG elements visible
- [ ] No fitness workout blocks visible

### 3b. Calendar (`/calendar`)

Assertion checklist:
- [ ] Today's cell shows ◆ marker in `var(--accent)` gold
- [ ] `data-testid="cal-marker-scheduled-item"` present in today's cell
- [ ] Glyph is ◆ (U+25C6), not 📅
- [ ] Click today's cell → DayDetail shows "Scheduled item" legend badge
- [ ] Legend panel (if shown) includes "◆ Scheduled item" entry
- [ ] Fitness cells from prior weeks unchanged (no ◆ on days with only workouts)
- [ ] addDays+10 cell shows ◆ for QA Milestone 1

### 3c. Plan (`/goals/GOAL_A_ID/plan`)

Assertion checklist:
- [ ] `data-testid="project-plan-view"` renders (not the fitness 7-DayCard layout)
- [ ] Header: "Plan" + "← QA Temp Project A" back link
- [ ] "1 / 2 milestones complete" summary (QA Milestone 2 is done)
- [ ] Current month CollapsibleCard is open by default
- [ ] QA Milestone 1 shows ○ glyph (planned), type badge "milestone" (accent color)
- [ ] QA Milestone 2 shows ● glyph (done), type badge "milestone"
- [ ] QA Launch Step shows ○ glyph, type badge "launch-step" (warning color)
- [ ] QA Task Today shows ○ glyph, type badge "task" (neutral)
- [ ] Due dates visible per row
- [ ] `data-testid="plan-month-2026-06"` present (current month)

### 3d. Progress (`/progress`)

Assertion checklist:
- [ ] `data-testid="milestone-burndown-card"` renders BEFORE the Weight card
- [ ] Header: "1 / 2 milestones complete"
- [ ] `data-testid="burndown-stat-total"` shows 2
- [ ] `data-testid="burndown-stat-done"` shows 1
- [ ] `data-testid="burndown-stat-remaining"` shows 1
- [ ] Thin accent scope bar at 50%
- [ ] Next milestone line: "Next: QA Milestone 1 · Jun 22, 2026" (±1 day per timezone)
- [ ] If nextDaysRemaining ≤ 14: urgency chip present
- [ ] NO Bullseye in the burn-down card
- [ ] Readiness card(s) still render above burn-down
- [ ] Weight chart still renders below burn-down

---

## Step 4: Project Goal B (empty state pass)

### 4a. Create Goal B

```sh
curl -s -X POST http://localhost:3199/api/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "create_goal",
      "arguments": {
        "objective": "QA Temp Project B — delete me",
        "kind": "project"
      }
    }
  }' | python3 -m json.tool
```

Record `GOAL_B_ID`.

### 4b. Set Goal B as focus

```sh
npx tsx --env-file=.env -e "
import { prisma } from './src/lib/db';
await prisma.goal.updateMany({ where: { isFocus: true }, data: { isFocus: false } });
await prisma.goal.update({ where: { id: 'REPLACE_GOAL_B_ID' }, data: { isFocus: true } });
console.log('Goal B is now focus');
await prisma.\$disconnect();
" 2>/dev/null
```

### 4c. Assert empty states

- **Today** (`/`):
  - [ ] `data-testid="project-today-empty"` present
  - [ ] Copy: "Nothing scheduled today — open Claude to plan tomorrow or log MRR."
  - [ ] NO `mrr-progress-card` (no log:mrr target on Goal B)
  - [ ] NO `next-milestone-card` (no milestones)
  - [ ] Bullseye is hollow (progress=0)

- **Plan** (`/goals/GOAL_B_ID/plan`):
  - [ ] `data-testid="project-plan-view"` renders
  - [ ] Empty state card: "No scheduled items yet — ask Claude to build out the schedule for this goal."
  - [ ] NO milestone summary line (no milestones)

- **Progress** (`/progress`):
  - [ ] `data-testid="milestone-burndown-card"` is ABSENT (MilestoneBurnDown returns null when 0 milestones)

- **Calendar** (`/calendar`):
  - [ ] No ◆ markers (no ScheduledItems for Goal B)

---

## Step 5: Restore Fitness Focus + Byte-Identical Regression

```sh
npx tsx --env-file=.env -e "
import { prisma } from './src/lib/db';
await prisma.goal.updateMany({ where: { isFocus: true }, data: { isFocus: false } });
await prisma.goal.update({ where: { id: 'REPLACE_FITNESS_GOAL_ID' }, data: { isFocus: true } });
console.log('Fitness goal restored as focus');
await prisma.\$disconnect();
" 2>/dev/null
```

### 5a. Byte-identical Today regression

```sh
curl -s http://localhost:3199/ -H "Cookie: your-session-cookie" \
  -o /tmp/qa-today-fitness-post.html

diff /tmp/qa-today-fitness-ref.html /tmp/qa-today-fitness-post.html
# Expected: empty diff (or only session/timestamp diffs — not structural)
```

- [ ] Diff is empty or shows no structural JSX changes
- [ ] No `project-today-view` testid present
- [ ] Fitness QuestCard, workout blocks, nutrition card all present

### 5b. Progress regression

```sh
curl -s http://localhost:3199/progress -o /tmp/qa-progress-fitness-post.html
diff /tmp/qa-progress-fitness-ref.html /tmp/qa-progress-fitness-post.html
```

- [ ] NO `milestone-burndown-card` present in diff output
- [ ] Weight card and RecordsSummary unchanged

---

## Step 6: Cleanup (MANDATORY)

```sh
# Delete temp goals (cascades ScheduledItems and LogEntries)
curl -s -X POST http://localhost:3199/api/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 10,
    "method": "tools/call",
    "params": {
      "name": "delete_goal",
      "arguments": { "goalId": "REPLACE_GOAL_A_ID", "confirm": true }
    }
  }' | python3 -m json.tool

curl -s -X POST http://localhost:3199/api/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 11,
    "method": "tools/call",
    "params": {
      "name": "delete_goal",
      "arguments": { "goalId": "REPLACE_GOAL_B_ID", "confirm": true }
    }
  }' | python3 -m json.tool

# Confirm fitness goal is focus
npx tsx --env-file=.env -e "
import { prisma } from './src/lib/db';
const g = await prisma.goal.findFirst({ where: { isFocus: true }, select: { id: true, objective: true, kind: true } });
console.log('Focus goal:', JSON.stringify(g));
await prisma.\$disconnect();
" 2>/dev/null
```

Confirm `kind === "fitness"` in the output.

---

## Step 7: UXR §9 Visual Items — Manual Verify

The following 7 items from UXR-s4 provisional list require eyes on a real 390px device or mockup. These cannot be automated.

| UXR ID | What to verify | Pass criteria |
|--------|---------------|---------------|
| UXR-s4-04 | ◆ at 13px, both light + dark themes | Reads distinctly from ◎ (ring-with-dot) and 🏔 (flag); gold-on-cream and gold-on-dark both legible |
| UXR-s4-13 | Milestone urgency threshold = ≤14d | 14d cutoff feels correct for project deadline urgency; revisit if too noisy |
| UXR-s4-14 | Off-tap celebration timing | Pop fires on next Today visit after MCP marks item done; feels earned (not jarring) |
| UXR-s4-15 | bullseye-pop timing at 28px | ~320ms total; entry `scale(0.6)` should not look harsh at 28px hero size |
| UXR-s4-16 | Ring discretization at 1–2 items | 1 item done: 1 ring; 2 items done: 2 rings — still reads honestly without misleading |
| UXR-s4-18 | Contrast: warning-on-cream, red-on-coal | Badge text passes ≥4.5:1 contrast; ◆ gold on cream ≥3:1 (graphical object threshold) |
| UXR-s4-21 | Bullseye center uses var(--target-fg) | Confirmed in Bullseye.tsx source; verify no hardcoded `#fff` in any branch |

---

## DB Verification Snippets

```sh
# Count ScheduledItems by goal
npx tsx --env-file=.env -e "
import { prisma } from './src/lib/db';
const counts = await prisma.scheduledItem.groupBy({ by: ['goalId'], _count: true });
console.log(JSON.stringify(counts));
await prisma.\$disconnect();
" 2>/dev/null

# Verify MRR LogEntry
npx tsx --env-file=.env -e "
import { prisma } from './src/lib/db';
const entries = await prisma.logEntry.findMany({ where: { metric: 'mrr' }, orderBy: { date: 'desc' }, take: 5 });
console.log(JSON.stringify(entries));
await prisma.\$disconnect();
" 2>/dev/null

# Confirm no orphaned temp goals post-cleanup
npx tsx --env-file=.env -e "
import { prisma } from './src/lib/db';
const goals = await prisma.goal.findMany({ where: { objective: { contains: 'QA Temp' } } });
console.log('Orphaned QA goals:', goals.length, JSON.stringify(goals.map(g => g.objective)));
await prisma.\$disconnect();
" 2>/dev/null
```
