# QA Runbook — Epic B: Project MCP Tool Pack (Issue #29, B-6)

**Author**: QA Agent  
**Date**: 2026-06-12  
**Scope**: End-to-end smoke of all 7 new project tools + get_today_plan regression  
**Executor**: Orchestrator (not the QA agent — this is a live-server runbook)

---

## CRITICAL SAFETY: Restore Fitness Focus (ALWAYS RUN)

If anything fails mid-smoke and you need to bail out, run this command immediately before stopping:

```sh
FITNESS_ID="<captured in Prerequisites below>"
npx tsx --env-file=.env -e "
import { prisma } from './src/lib/db';
prisma.goal.updateMany({ where: { isFocus: true }, data: { isFocus: false } }).then(function() {
  return prisma.goal.update({ where: { id: '$FITNESS_ID' }, data: { isFocus: true } });
}).then(function(r) {
  console.log(JSON.stringify({ restored: r.id, isFocus: r.isFocus }));
  return prisma.\$disconnect();
});
"
```

This must restore the fitness goal as focus before the session ends. See Step 8 RESTORE for the inline version.

---

## Prerequisites

```sh
# 1. Ensure dev server is running (port 3199):
npm run dev

# 2. In a separate terminal, set environment:
BASE_URL="http://localhost:3199/api/mcp"
TOKEN="$(grep MCP_AUTH_TOKEN .env | cut -d'"' -f2)"
echo "TOKEN length: ${#TOKEN}"   # sanity check — must be non-zero

# 3. Capture the current fitness focus goal id:
FITNESS_ID=$(npx tsx --env-file=.env -e "
import { prisma } from './src/lib/db';
prisma.goal.findFirst({ where: { isFocus: true }, orderBy: { updatedAt: 'desc' }, select: { id: true } }).then(function(g) {
  console.log(g ? g.id : 'NONE');
  return prisma.\$disconnect();
});
")
echo "Fitness goal id: $FITNESS_ID"
# STOP if FITNESS_ID is NONE — the RESTORE step requires a known fitness goal id.
```

---

## Step 1 — tools/list: Assert 7 new tools present

```sh
curl -s -X POST "$BASE_URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | python3 -m json.tool \
  | grep '"name"' \
  | grep -E 'schedule_item|delete_scheduled_item|complete_item|update_scheduled_item|list_scheduled_items|log_metric|list_log_entries'
```

**Assert**: Exactly 7 lines, one per tool name. If any are missing, STOP — the wiring in `registerAll()` is broken.

---

## Step 2 — create_goal: Create test project goal (capture GOAL_ID)

```sh
RESP=$(curl -s -X POST "$BASE_URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"create_goal","arguments":{"objective":"TEST chewgether smoke B-6","kind":"project"}}}')
echo "$RESP" | python3 -m json.tool
```

**Assert**: Response contains `"kind": "project"` and an `id` field.  
Capture the goal id:

```sh
GOAL_ID="<paste id from above output>"
echo "Test goal id: $GOAL_ID"
```

---

## Step 3 — schedule_item: Happy path + error cases + externalRef collision

### 3a — Happy path (today's date, capture ITEM_ID)

```sh
TODAY="$(date +%Y-%m-%d)"
ITEM_RESP=$(curl -s -X POST "$BASE_URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"schedule_item\",\"arguments\":{\"goalId\":\"$GOAL_ID\",\"date\":\"$TODAY\",\"type\":\"milestone\",\"title\":\"B-6 smoke milestone\"}}}")
echo "$ITEM_RESP" | python3 -m json.tool
```

**Assert**: `{ "id": "...", "goalId": "<GOAL_ID>", "date": "<TODAY yyyy-mm-dd>", "type": "milestone", "title": "B-6 smoke milestone", "status": "planned", "message": "Item scheduled." }` — `date` must be `yyyy-mm-dd`, NOT an ISO string.

```sh
ITEM_ID="<paste id from above output>"
echo "Item id: $ITEM_ID"
```

### 3b — Error: nonexistent goalId

```sh
curl -s -X POST "$BASE_URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"schedule_item","arguments":{"goalId":"nonexistent-id","date":"2026-06-15","type":"task","title":"should fail"}}}' \
  | python3 -m json.tool
```

**Assert**: `"isError": true`, message contains `"Goal not found: nonexistent-id"`.

### 3c — Error: fitness goalId

```sh
curl -s -X POST "$BASE_URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\",\"params\":{\"name\":\"schedule_item\",\"arguments\":{\"goalId\":\"$FITNESS_ID\",\"date\":\"2026-06-15\",\"type\":\"task\",\"title\":\"should fail\"}}}" \
  | python3 -m json.tool
```

**Assert**: `"isError": true`, message mentions `kind='fitness'` and directs to `log_workout, log_hike, log_baseline, log_measurement`.

### 3d — externalRef collision test (first call succeeds, second fails)

```sh
# First call — unique externalRef:
curl -s -X POST "$BASE_URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":\"5b\",\"method\":\"tools/call\",\"params\":{\"name\":\"schedule_item\",\"arguments\":{\"goalId\":\"$GOAL_ID\",\"date\":\"2026-06-20\",\"type\":\"task\",\"title\":\"ext ref item\",\"externalRef\":\"ext-unique-1\"}}}" \
  | python3 -m json.tool
# Assert: success, status='planned'

# Second call — same externalRef on same goal:
curl -s -X POST "$BASE_URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":\"5c\",\"method\":\"tools/call\",\"params\":{\"name\":\"schedule_item\",\"arguments\":{\"goalId\":\"$GOAL_ID\",\"date\":\"2026-06-21\",\"type\":\"task\",\"title\":\"dup ref item\",\"externalRef\":\"ext-unique-1\"}}}" \
  | python3 -m json.tool
```

**Assert second call**: `"isError": true`, message contains `"Duplicate externalRef \"ext-unique-1\" already exists on goal"`.

---

## Step 4 — list_scheduled_items: Verify planned items

```sh
curl -s -X POST "$BASE_URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":6,\"method\":\"tools/call\",\"params\":{\"name\":\"list_scheduled_items\",\"arguments\":{\"goalId\":\"$GOAL_ID\",\"status\":\"planned\"}}}" \
  | python3 -m json.tool
```

**Assert**: `count >= 1`; each item has `{ id, goalId, date (yyyy-mm-dd), type, title, detail, status, completedAt (null), externalRef, createdAt (ISO) }`; ordered date descending; `status: "planned"` for all rows.

---

## Step 5 — complete_item: Mark done + list done + error case

### 5a — Happy path

```sh
curl -s -X POST "$BASE_URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"tools/call\",\"params\":{\"name\":\"complete_item\",\"arguments\":{\"id\":\"$ITEM_ID\"}}}" \
  | python3 -m json.tool
```

**Assert**: `{ "id": "<ITEM_ID>", "status": "done", "completedAt": "<ISO string>", "message": "Item marked done." }` — `completedAt` must be an ISO instant (not a date-only string); `status` must be `"done"`.

### 5b — Verify done status via list

```sh
curl -s -X POST "$BASE_URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":8,\"method\":\"tools/call\",\"params\":{\"name\":\"list_scheduled_items\",\"arguments\":{\"goalId\":\"$GOAL_ID\",\"status\":\"done\"}}}" \
  | python3 -m json.tool
```

**Assert**: `count >= 1`; the item with `id = ITEM_ID` is present with `status: "done"` and a non-null `completedAt` ISO string.

### 5c — Error: unknown item id

```sh
curl -s -X POST "$BASE_URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":"8b","method":"tools/call","params":{"name":"complete_item","arguments":{"id":"nonexistent-item-id"}}}' \
  | python3 -m json.tool
```

**Assert**: `"isError": true`, message contains `"Scheduled item not found: nonexistent-item-id"`. Must NOT be a raw Prisma error message (no "P2025" visible in the error text).

---

## Step 6 — update_scheduled_item: PATCH semantics + no-op + error cases

### 6a — Happy path: rename title

```sh
curl -s -X POST "$BASE_URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":9,\"method\":\"tools/call\",\"params\":{\"name\":\"update_scheduled_item\",\"arguments\":{\"id\":\"$ITEM_ID\",\"title\":\"B-6 smoke milestone (renamed)\"}}}" \
  | python3 -m json.tool
```

**Assert**: `{ "id": "<ITEM_ID>", "title": "B-6 smoke milestone (renamed)", "message": "Item updated." }`. ONLY `id`, `title`, and `message` present — PATCH semantics means other fields must NOT appear in the response.

### 6b — No-op: id only

```sh
curl -s -X POST "$BASE_URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":10,\"method\":\"tools/call\",\"params\":{\"name\":\"update_scheduled_item\",\"arguments\":{\"id\":\"$ITEM_ID\"}}}" \
  | python3 -m json.tool
```

**Assert**: Success (not isError), message contains `"Nothing to update"`. No DB write performed.

### 6c — Error: unknown id with a field (findUnique→not found path)

```sh
curl -s -X POST "$BASE_URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":"9b","method":"tools/call","params":{"name":"update_scheduled_item","arguments":{"id":"nonexistent-item-id","title":"should fail"}}}' \
  | python3 -m json.tool
```

**Assert**: `"isError": true`, message contains `"Scheduled item not found: nonexistent-item-id"`.

### 6d — Error: unknown id with NO fields (S-4 verification — not found beats nothing-to-update)

```sh
curl -s -X POST "$BASE_URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":"9c","method":"tools/call","params":{"name":"update_scheduled_item","arguments":{"id":"nonexistent-item-id"}}}' \
  | python3 -m json.tool
```

**Assert**: `"isError": true`, message contains `"Scheduled item not found: nonexistent-item-id"`. Must NOT say "Nothing to update" — the findUnique-first order guarantees correct feedback even on no-op calls with stale ids.

---

## Step 7 — log_metric: Two entries + list + error cases

### 7a — First entry

```sh
curl -s -X POST "$BASE_URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":11,\"method\":\"tools/call\",\"params\":{\"name\":\"log_metric\",\"arguments\":{\"goalId\":\"$GOAL_ID\",\"metric\":\"mrr\",\"value\":450}}}" \
  | python3 -m json.tool
```

**Assert**: `{ "id": "...", "goalId": "<GOAL_ID>", "metric": "mrr", "value": 450, "text": null, "date": "<ISO string>", "source": "manual", "message": "Metric logged." }` — `date` must be ISO (full instant, not yyyy-mm-dd); `source` defaults to `"manual"`.

### 7b — Second entry (different value)

```sh
curl -s -X POST "$BASE_URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":12,\"method\":\"tools/call\",\"params\":{\"name\":\"log_metric\",\"arguments\":{\"goalId\":\"$GOAL_ID\",\"metric\":\"mrr\",\"value\":480}}}" \
  | python3 -m json.tool
```

**Assert**: Same shape; `value: 480`. Second entry creates a separate row (time-series behavior).

### 7c — list_log_entries: count=2, newest first

```sh
curl -s -X POST "$BASE_URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":13,\"method\":\"tools/call\",\"params\":{\"name\":\"list_log_entries\",\"arguments\":{\"goalId\":\"$GOAL_ID\",\"metric\":\"mrr\"}}}" \
  | python3 -m json.tool
```

**Assert**: `count: 2`; `entries[0].value: 480` (newest first, date descending); each entry has `{ id, goalId, date (ISO), metric, value, text, source, createdAt (ISO) }`. `date` must be ISO string (NOT yyyy-mm-dd — verify explicitly, this is a known contrast with `list_scheduled_items`).

### 7d — Error: both value and text omitted

```sh
curl -s -X POST "$BASE_URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":14,\"method\":\"tools/call\",\"params\":{\"name\":\"log_metric\",\"arguments\":{\"goalId\":\"$GOAL_ID\",\"metric\":\"mrr\"}}}" \
  | python3 -m json.tool
```

**Assert**: `"isError": true`, message contains `"Provide value and/or text"`.

### 7e — Error: fitness goalId (D-3 enforcement)

```sh
curl -s -X POST "$BASE_URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":\"14b\",\"method\":\"tools/call\",\"params\":{\"name\":\"log_metric\",\"arguments\":{\"goalId\":\"$FITNESS_ID\",\"metric\":\"mrr\",\"value\":100}}}" \
  | python3 -m json.tool
```

**Assert**: `"isError": true`, message contains `"log_metric is for project goals only"` and mentions `log_measurement` / `log_baseline`.

---

## Step 8 — isFocus flip + get_today_plan todayItems + RESTORE

### 8a — Schedule a second item for today (for todayItems assert — the completed item from Step 5 is done, not planned)

```sh
TODAY_ITEM_RESP=$(curl -s -X POST "$BASE_URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":15,\"method\":\"tools/call\",\"params\":{\"name\":\"schedule_item\",\"arguments\":{\"goalId\":\"$GOAL_ID\",\"date\":\"$TODAY\",\"type\":\"task\",\"title\":\"Today task for todayItems test\"}}}")
echo "$TODAY_ITEM_RESP" | python3 -m json.tool
```

**Assert**: Success, `status: "planned"`, `date: "$TODAY"`.

### 8b — Flip isFocus to test project goal

```sh
npx tsx --env-file=.env -e "
import { prisma } from './src/lib/db';
prisma.goal.updateMany({ where: { isFocus: true }, data: { isFocus: false } }).then(function() {
  return prisma.goal.update({ where: { id: '$GOAL_ID' }, data: { isFocus: true } });
}).then(function(r) {
  console.log(JSON.stringify({ switched: r.id, isFocus: r.isFocus }));
  return prisma.\$disconnect();
});
"
```

**Assert**: `{ "switched": "<GOAL_ID>", "isFocus": true }`.

### 8c — get_today_plan: assert todayItems non-empty

```sh
curl -s -X POST "$BASE_URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":16,"method":"tools/call","params":{"name":"get_today_plan","arguments":{}}}' \
  | python3 -m json.tool | grep -A 30 '"todayItems"'
```

**Assert**: `todayItems` is a non-empty array; each element has `{ id, type, title, status, completedAt }` and nothing else (the select projection); contains the "Today task for todayItems test" item.

### 8d — RESTORE fitness goal as focus (ALWAYS RUN — run this even if 8c fails)

```sh
npx tsx --env-file=.env -e "
import { prisma } from './src/lib/db';
prisma.goal.updateMany({ where: { isFocus: true }, data: { isFocus: false } }).then(function() {
  return prisma.goal.update({ where: { id: '$FITNESS_ID' }, data: { isFocus: true } });
}).then(function(r) {
  console.log(JSON.stringify({ RESTORED: r.id, isFocus: r.isFocus }));
  return prisma.\$disconnect();
});
"
```

**Assert**: `{ "RESTORED": "<FITNESS_ID>", "isFocus": true }`.

### 8e — get_today_plan: fitness regression assert (todayItems must be [])

```sh
curl -s -X POST "$BASE_URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":17,"method":"tools/call","params":{"name":"get_today_plan","arguments":{}}}' \
  | python3 -m json.tool | grep -A 3 '"todayItems"'
```

**Assert**: `"todayItems": []` — no items, no query was issued. Also verify response still contains `standingRules`, `focusGoal`, `activeGoal`, and fitness-specific fields (`workoutTemplate`, `baselinesDue`, etc.) — these must be byte-identical to pre-Epic-B behavior.

---

## Step 9 — delete_scheduled_item: Happy path + double-delete friendly error

### 9a — First delete

```sh
curl -s -X POST "$BASE_URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":18,\"method\":\"tools/call\",\"params\":{\"name\":\"delete_scheduled_item\",\"arguments\":{\"id\":\"$ITEM_ID\"}}}" \
  | python3 -m json.tool
```

**Assert**: `{ "id": "<ITEM_ID>", "deleted": true, "message": "Scheduled item deleted." }`.

### 9b — Second delete: friendly error (not raw Prisma P2025)

```sh
curl -s -X POST "$BASE_URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":19,\"method\":\"tools/call\",\"params\":{\"name\":\"delete_scheduled_item\",\"arguments\":{\"id\":\"$ITEM_ID\"}}}" \
  | python3 -m json.tool
```

**Assert**: `"isError": true`, message contains `"Scheduled item not found: <ITEM_ID>"`. Must NOT contain raw Prisma error text or "P2025" in the visible message.

---

## Step 10 — delete_goal (cascade) + verify list_scheduled_items + list_log_entries

### 10a — Delete the test goal (cascade removes all ScheduledItems and LogEntries)

```sh
curl -s -X POST "$BASE_URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":20,\"method\":\"tools/call\",\"params\":{\"name\":\"delete_goal\",\"arguments\":{\"goalId\":\"$GOAL_ID\",\"confirm\":true}}}" \
  | python3 -m json.tool
```

**Assert**: Success; `cascaded.scheduledItems >= 1` (we created at least 3 items — steps 3a, 3d, 8a — and deleted 1 in step 9, so cascade removes >= 2 remaining); `cascaded.logEntries >= 2` (two log_metric calls in step 7).

### 10b — Verify cascade: list_scheduled_items returns friendly goal-not-found error

```sh
curl -s -X POST "$BASE_URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":21,\"method\":\"tools/call\",\"params\":{\"name\":\"list_scheduled_items\",\"arguments\":{\"goalId\":\"$GOAL_ID\"}}}" \
  | python3 -m json.tool
```

**Assert**: `"isError": true`, message contains `"Goal not found"`.

### 10c — Verify cascade: list_log_entries returns friendly goal-not-found error

```sh
curl -s -X POST "$BASE_URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":\"21b\",\"method\":\"tools/call\",\"params\":{\"name\":\"list_log_entries\",\"arguments\":{\"goalId\":\"$GOAL_ID\"}}}" \
  | python3 -m json.tool
```

**Assert**: `"isError": true`, message contains `"Goal not found"`.

### 10d — Confirm fitness goal is still the focus goal

```sh
curl -s -X POST "$BASE_URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":22,"method":"tools/call","params":{"name":"list_goals","arguments":{}}}' \
  | python3 -m json.tool | grep -E '"isFocus"|"kind"|"objective"|"id"'
```

**Assert**: The fitness goal (`FITNESS_ID`) has `"isFocus": true`; the test goal (`GOAL_ID`) is absent from the list.

---

## Step 11 — Final DB check: no orphan rows

```sh
npx tsx --env-file=.env -e "
import { prisma } from './src/lib/db';
Promise.all([
  prisma.scheduledItem.count({ where: { goalId: '$GOAL_ID' } }),
  prisma.logEntry.count({ where: { goalId: '$GOAL_ID' } }),
  prisma.goal.findUnique({ where: { id: '$FITNESS_ID' }, select: { id: true, isFocus: true } }),
]).then(function(results) {
  console.log(JSON.stringify({
    orphanScheduledItems: results[0],
    orphanLogEntries: results[1],
    fitnessGoal: results[2]
  }));
  return prisma.\$disconnect();
});
"
```

**Assert**:
- `orphanScheduledItems: 0` — all ScheduledItems for the test goal cascaded cleanly.
- `orphanLogEntries: 0` — all LogEntries for the test goal cascaded cleanly.
- `fitnessGoal.isFocus: true` — fitness goal remains the active focus.

---

## Post-Deploy Note (connector cache)

After merging to main and Vercel deploys, `MCP_SERVER_VERSION` changes (new SHA). claude.ai's connector automatically re-fetches `tools/list` on the next request. No manual connector toggle needed unless testing against the production URL before the first post-deploy request.
