# QA Runbook — Epic C: GitHub Tool Pack
# FOR ORCHESTRATOR EXECUTION ONLY

**Prerequisites**
- Dev server running at http://localhost:3199
- `.env` present and readable (contains DATABASE_URL, MCP_AUTH_TOKEN, GITHUB_TOKEN)
- `gh` CLI authenticated as jronnomo
- Working directory: `/Users/ggronnii/Development/goaldmine`

**Capture all response bodies** to `/tmp/epic-c-smoke-responses.txt` throughout — append with `>>`. Do NOT echo the GITHUB_TOKEN value at any point.

```sh
# Setup (run once)
TOKEN="$(grep MCP_AUTH_TOKEN .env | cut -d'"' -f2)"
RESPONSES_FILE="/tmp/epic-c-smoke-responses.txt"
rm -f "$RESPONSES_FILE"
touch "$RESPONSES_FILE"

# Helper alias for MCP calls
mcp_call() {
  local method="$1"
  local args="$2"
  curl -s -X POST http://localhost:3199/api/mcp \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$method\",\"arguments\":$args}}" \
    | tee -a "$RESPONSES_FILE"
}
```

---

## STEP 0 — RECOVERY SNIPPETS (ALWAYS RUN ON BAIL)

Run these in order whenever the smoke must be aborted mid-run. Safe to run even if artifacts were never created.

```sh
# Variables set during the smoke — substitute actual numbers if known
# M1_NUMBER=<n>
# M2_NUMBER=<n>
# M3_NUMBER=<n>  (created in step 11)
# ISSUE_NUMBER=<n>
# GOAL_ID=<id>

# 1. Delete temp milestones (404 is harmless if not created yet)
gh api -X DELETE /repos/jronnomo/Chewgether/milestones/${M1_NUMBER} 2>/dev/null || true
gh api -X DELETE /repos/jronnomo/Chewgether/milestones/${M2_NUMBER} 2>/dev/null || true
gh api -X DELETE /repos/jronnomo/Chewgether/milestones/${M3_NUMBER} 2>/dev/null || true

# 2. Close test issue (if not already closed)
[ -n "$ISSUE_NUMBER" ] && \
  gh api -X PATCH /repos/jronnomo/Chewgether/issues/${ISSUE_NUMBER} \
    -f state=closed 2>/dev/null || true

# 3. Delete temp goal (cascade-deletes all its ScheduledItems)
[ -n "$GOAL_ID" ] && \
  mcp_call "delete_goal" "{\"goalId\":\"$GOAL_ID\",\"confirm\":true}"

# 4. Verify Chewgether milestones back to 0
echo "--- Chewgether milestones after cleanup ---"
gh api /repos/jronnomo/Chewgether/milestones?state=all | python3 -m json.tool | grep '"number"' || echo "(none)"

# 5. Verify no orphan ScheduledItems with gh:milestone: refs for GOAL_ID
[ -n "$GOAL_ID" ] && \
npx tsx --env-file=.env -e "
import { prisma } from './src/lib/db';
prisma.scheduledItem.findMany({
  where: { goalId: '$GOAL_ID', externalRef: { startsWith: 'gh:milestone:' } },
  select: { externalRef: true }
}).then(r => { console.log('Orphan milestones:', r.length, JSON.stringify(r)); process.exit(0); })
  .catch(e => { console.error(e); process.exit(1); });
"
```

---

## STEP 1 — tools/list: assert 5 new tools present (total 88)

```sh
curl -s -X POST http://localhost:3199/api/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | tee -a "$RESPONSES_FILE" \
  | python3 -c "
import json, sys
data = json.load(sys.stdin)
tools = data['result']['tools']
names = [t['name'] for t in tools]
github_tools = [n for n in names if n in ['link_github_project','get_project_overview','list_project_issues','sync_github_milestones','set_github_issue_status']]
print('Total tools:', len(tools))
print('GitHub tools found:', github_tools)
assert len(tools) == 88, f'FAIL: expected 88 tools, got {len(tools)}'
assert len(github_tools) == 5, f'FAIL: expected 5 GitHub tools, got {github_tools}'
print('PASS: 88 tools total, all 5 GitHub tools present')
"
```

**Assert**: Total = 88. All 5 names present.

---

## STEP 2 — create_goal kind=project → GOAL_ID

```sh
RESP=$(mcp_call "create_goal" '{"objective":"TEST epic-c smoke","kind":"project"}')
echo "$RESP"
GOAL_ID=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['result']['content'][0]['text'])" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d['id'])")
echo "GOAL_ID=$GOAL_ID"
[ -z "$GOAL_ID" ] && echo "FAIL: could not extract GOAL_ID" && exit 1
echo "PASS: created project goal $GOAL_ID"
```

**Assert**: Non-empty `GOAL_ID`. Response contains `kind: "project"`.

---

## STEP 3 — link_github_project: rejection cases + happy path

```sh
# 3a. Reject bare name "Chewgether" — Zod regex error
echo "=== 3a: bare name rejection ==="
R=$(mcp_call "link_github_project" "{\"goalId\":\"$GOAL_ID\",\"repo\":\"Chewgether\"}")
echo "$R"
echo "$R" | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['result']['content'][0]['text'].startswith('{'), 'resp ok'; import json; body=json.loads(d['result']['content'][0]['text']); assert body.get('isError') or 'error' in str(body).lower() or 'invalid' in str(body).lower(), f'FAIL: expected Zod error, got: {body}'; print('PASS: bare name rejected')"

# 3b. Reject full URL
echo "=== 3b: full URL rejection ==="
R=$(mcp_call "link_github_project" "{\"goalId\":\"$GOAL_ID\",\"repo\":\"https://github.com/jronnomo/Chewgether\"}")
echo "$R"
echo "$R" | python3 -c "import json,sys; d=json.load(sys.stdin); t=d['result']['content'][0]['text']; assert 'error' in t.lower() or 'invalid' in t.lower() or 'isError' in t, f'FAIL: expected error, got: {t}'; print('PASS: URL rejected')"

# 3c. Bad goalId → friendly error
echo "=== 3c: bad goalId ==="
R=$(mcp_call "link_github_project" '{"goalId":"nonexistent-id-xyz","repo":"jronnomo/Chewgether"}')
echo "$R"
echo "$R" | python3 -c "import json,sys; d=json.load(sys.stdin); t=d['result']['content'][0]['text']; assert 'not found' in t.lower(), f'FAIL: expected not found, got: {t}'; print('PASS: bad goalId → friendly error')"

# 3d. Happy path — no projectNumber
echo "=== 3d: happy path (no projectNumber) ==="
R=$(mcp_call "link_github_project" "{\"goalId\":\"$GOAL_ID\",\"repo\":\"jronnomo/Chewgether\"}")
echo "$R"
echo "$R" | python3 -c "
import json,sys
d=json.load(sys.stdin)
t=d['result']['content'][0]['text']
body=json.loads(t)
assert body.get('githubRepo') == 'jronnomo/Chewgether', f'FAIL: wrong repo: {body}'
assert body.get('githubProjectNumber') is None, f'FAIL: unexpected projectNumber: {body}'
print('PASS: link_github_project happy path')
"

# 3e. Verify fields persisted via get_goal
echo "=== 3e: verify via get_goal ==="
R=$(mcp_call "get_goal" "{\"goalId\":\"$GOAL_ID\"}")
echo "$R"
echo "$R" | python3 -c "
import json,sys
d=json.load(sys.stdin)
t=d['result']['content'][0]['text']
body=json.loads(t)
assert body.get('githubRepo') == 'jronnomo/Chewgether', f'FAIL: persisted repo wrong: {body}'
print('PASS: fields persisted in DB')
"
```

---

## STEP 4 — get_project_overview: shape + no-board path

```sh
echo "=== Step 4: get_project_overview (no projectNumber) ==="
R=$(mcp_call "get_project_overview" "{\"goalId\":\"$GOAL_ID\"}")
echo "$R"
echo "$R" | python3 -c "
import json,sys
d=json.load(sys.stdin)
t=d['result']['content'][0]['text']
body=json.loads(t)
assert 'isError' not in body or body.get('isError') != True, f'FAIL: got error: {body}'
assert body.get('repo') == 'jronnomo/Chewgether', f'FAIL: wrong repo: {body.get(\"repo\")}'
assert isinstance(body.get('openIssues'), int), f'FAIL: openIssues not int: {body.get(\"openIssues\")}'
assert isinstance(body.get('openPRs'), int), f'FAIL: openPRs not int: {body.get(\"openPRs\")}'
assert isinstance(body.get('milestones'), list), f'FAIL: milestones not list'
assert isinstance(body.get('recentCommits'), list), f'FAIL: recentCommits not list'
assert len(body.get('recentCommits', [])) <= 5, f'FAIL: more than 5 commits'
for c in body.get('recentCommits', []):
    assert len(c['sha']) == 7, f'FAIL: sha not 7 chars: {c[\"sha\"]}'
assert body.get('projectBoard') is None, f'FAIL: expected null projectBoard, got: {body.get(\"projectBoard\")}'
assert body.get('projectBoardError') is None, f'FAIL: expected null projectBoardError, got: {body.get(\"projectBoardError\")}'
assert isinstance(body.get('rateLimitRemaining'), int) and body.get('rateLimitRemaining') > 0, f'FAIL: rateLimitRemaining: {body.get(\"rateLimitRemaining\")}'
# openIssues approximately 72 (may vary as issues are opened/closed)
print(f'openIssues={body[\"openIssues\"]}, openPRs={body[\"openPRs\"]}, rateLimitRemaining={body[\"rateLimitRemaining\"]}')
print('PASS: get_project_overview shape correct, no board path')
"
```

---

## STEP 5 — link with projectNumber 8; verify board columns

```sh
echo "=== Step 5: link with projectNumber=8, verify board ==="
R=$(mcp_call "link_github_project" "{\"goalId\":\"$GOAL_ID\",\"repo\":\"jronnomo/Chewgether\",\"projectNumber\":8}")
echo "$R"

R=$(mcp_call "get_project_overview" "{\"goalId\":\"$GOAL_ID\"}")
echo "$R"
echo "$R" | python3 -c "
import json,sys
d=json.load(sys.stdin)
t=d['result']['content'][0]['text']
body=json.loads(t)
assert 'isError' not in body or body.get('isError') != True, f'FAIL: got error: {body}'
board=body.get('projectBoard')
assert board is not None, f'FAIL: projectBoard is null after linking project #8'
columns=board.get('columns', [])
assert len(columns) > 0, f'FAIL: columns empty: {board}'
col_names=[c['name'] for c in columns]
print('Board columns:', col_names)
# Expect Done and Todo at minimum (verified in research: 18 Done, 27 Todo)
assert any('Done' in n or 'Todo' in n or '(no status)' in n for n in col_names), f'FAIL: expected Done/Todo buckets, got: {col_names}'
assert body.get('projectBoardError') is None, f'FAIL: projectBoardError should be null, got: {body.get(\"projectBoardError\")}'
print('PASS: projectBoard columns populated, projectBoardError null')
"
```

---

## STEP 6 — list_project_issues: default/limit/label/milestone-rejection/closed

```sh
# 6a. Default open — no pull_request contamination
echo "=== 6a: list open issues ==="
R=$(mcp_call "list_project_issues" "{\"goalId\":\"$GOAL_ID\"}")
echo "$R"
echo "$R" | python3 -c "
import json,sys
d=json.load(sys.stdin)
t=d['result']['content'][0]['text']
body=json.loads(t)
assert 'isError' not in body or body.get('isError') != True, f'FAIL: {body}'
issues=body.get('issues',[])
assert len(issues) <= 30, f'FAIL: more than 30 issues (limit default)'
# Assert no PR numbers in the response — known PRs on Chewgether include #316, #311
pr_numbers=[316,311]
found_prs=[i['number'] for i in issues if i['number'] in pr_numbers]
assert len(found_prs)==0, f'FAIL: PR numbers found in issues: {found_prs}'
print(f'count={body[\"count\"]}, no PR contamination')
print('PASS: list_project_issues default open')
"

# 6b. limit=5
echo "=== 6b: limit=5 ==="
R=$(mcp_call "list_project_issues" "{\"goalId\":\"$GOAL_ID\",\"limit\":5}")
echo "$R"
echo "$R" | python3 -c "
import json,sys
d=json.load(sys.stdin)
t=d['result']['content'][0]['text']
body=json.loads(t)
assert body.get('count','') <= 5, f'FAIL: count {body.get(\"count\")} > 5'
print('PASS: limit=5 works')
"

# 6c. Label filter — pick a real label from Chewgether first
echo "=== 6c: label filter ==="
LABEL=$(gh api /repos/jronnomo/Chewgether/labels?per_page=1 | python3 -c "import json,sys; labels=json.load(sys.stdin); print(labels[0]['name'] if labels else '')")
echo "Using label: $LABEL"
if [ -n "$LABEL" ]; then
  R=$(mcp_call "list_project_issues" "{\"goalId\":\"$GOAL_ID\",\"label\":\"$LABEL\"}")
  echo "$R"
  echo "$R" | python3 -c "
import json,sys
d=json.load(sys.stdin)
t=d['result']['content'][0]['text']
body=json.loads(t)
assert 'isError' not in body or body.get('isError') != True, f'FAIL: {body}'
print('count with label filter:', body.get('count'))
print('PASS: label filter works')
"
fi

# 6d. milestone="not-a-number" → Zod validation error (regex rejects non-digit/non-*/non-none)
echo "=== 6d: milestone title string rejected by Zod ==="
R=$(mcp_call "list_project_issues" "{\"goalId\":\"$GOAL_ID\",\"milestone\":\"Sprint 3\"}")
echo "$R"
echo "$R" | python3 -c "
import json,sys
d=json.load(sys.stdin)
t=d['result']['content'][0]['text']
# MCP Zod errors surface as isError or error text
assert 'error' in t.lower() or 'invalid' in t.lower() or 'isError' in t, f'FAIL: expected Zod error for title milestone, got: {t}'
print('PASS: milestone title string rejected by Zod')
"

# 6e. state=closed works
echo "=== 6e: state=closed ==="
R=$(mcp_call "list_project_issues" "{\"goalId\":\"$GOAL_ID\",\"state\":\"closed\",\"limit\":5}")
echo "$R"
echo "$R" | python3 -c "
import json,sys
d=json.load(sys.stdin)
t=d['result']['content'][0]['text']
body=json.loads(t)
assert 'isError' not in body or body.get('isError') != True, f'FAIL: {body}'
issues=body.get('issues',[])
states=[i['state'] for i in issues]
assert all(s=='closed' for s in states), f'FAIL: non-closed issues in closed query: {states}'
print('PASS: state=closed works')
"
```

---

## STEP 7 — Fixture milestones via gh api

```sh
echo "=== Step 7: create fixture milestones ==="

# M1: has due_on (T07:00:00Z = UTC midnight MT on that calendar date)
M1_RESP=$(gh api /repos/jronnomo/Chewgether/milestones \
  -X POST \
  -f title="EPIC-C TEST M1" \
  -f description="QA smoke milestone — safe to delete" \
  -f due_on="2026-09-01T07:00:00Z")
echo "M1: $M1_RESP"
M1_NUMBER=$(echo "$M1_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['number'])")
echo "M1_NUMBER=$M1_NUMBER"

# M2: no due_on (should be skipped by sync)
M2_RESP=$(gh api /repos/jronnomo/Chewgether/milestones \
  -X POST \
  -f title="EPIC-C TEST M2" \
  -f description="QA smoke milestone no due date — safe to delete")
echo "M2: $M2_RESP"
M2_NUMBER=$(echo "$M2_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['number'])")
echo "M2_NUMBER=$M2_NUMBER"

[ -z "$M1_NUMBER" ] || [ -z "$M2_NUMBER" ] && echo "FAIL: could not create fixture milestones" && exit 1
echo "PASS: milestones created M1=#$M1_NUMBER M2=#$M2_NUMBER"
```

---

## STEP 8 — sync_github_milestones: first sync + USER_TZ assert

```sh
echo "=== Step 8: first sync ==="
R=$(mcp_call "sync_github_milestones" "{\"goalId\":\"$GOAL_ID\"}")
echo "$R"
echo "$R" | python3 -c "
import json,sys
d=json.load(sys.stdin)
t=d['result']['content'][0]['text']
body=json.loads(t)
assert 'isError' not in body or body.get('isError') != True, f'FAIL: {body}'
assert body.get('synced') == 1, f'FAIL: expected synced=1, got: {body}'
assert body.get('updated') == 0, f'FAIL: expected updated=0, got: {body}'
assert body.get('skipped') == 1, f'FAIL: expected skipped=1 (M2 no due_on), got: {body}'
items=body.get('items',[])
assert len(items)==1, f'FAIL: expected 1 item, got: {items}'
print('synced=', body['synced'], 'updated=', body['updated'], 'skipped=', body['skipped'])
print('items:', items)
print('PASS: first sync counts correct')
"

# USER_TZ assert: due_on "2026-09-01T07:00:00Z" → date "2026-09-01" (NOT "2026-08-31")
echo "=== 8b: USER_TZ assert ==="
R=$(mcp_call "list_scheduled_items" "{\"goalId\":\"$GOAL_ID\",\"type\":\"milestone\"}")
echo "$R"
echo "$R" | python3 -c "
import json,sys
d=json.load(sys.stdin)
t=d['result']['content'][0]['text']
body=json.loads(t)
items=body.get('items',[])
assert len(items)==1, f'FAIL: expected 1 scheduled item, got: {len(items)}'
item=items[0]
assert item.get('externalRef') == 'gh:milestone:${M1_NUMBER}', f'FAIL: wrong externalRef: {item}'
# USER_TZ: due_on 2026-09-01T07:00:00Z = 2026-09-01 00:00 MT → date must be 2026-09-01
assert item.get('date') == '2026-09-01', f'FAIL: USER_TZ wrong — expected 2026-09-01, got {item.get(\"date\")} (off-by-one = UTC midnight bug)'
assert item.get('type') == 'milestone', f'FAIL: wrong type: {item}'
assert item.get('status') == 'planned', f'FAIL: expected planned, got: {item.get(\"status\")}'
print('date=', item['date'], 'externalRef=', item['externalRef'], 'status=', item['status'])
print('PASS: USER_TZ date bucketing correct')
"
```

---

## STEP 9 — Re-run sync: idempotency assert

```sh
echo "=== Step 9: re-run sync (idempotency) ==="
R=$(mcp_call "sync_github_milestones" "{\"goalId\":\"$GOAL_ID\"}")
echo "$R"
echo "$R" | python3 -c "
import json,sys
d=json.load(sys.stdin)
t=d['result']['content'][0]['text']
body=json.loads(t)
assert body.get('synced') == 0, f'FAIL: expected synced=0 on re-run, got: {body}'
assert body.get('updated') == 1, f'FAIL: expected updated=1 on re-run, got: {body}'
assert body.get('skipped') == 1, f'FAIL: expected skipped=1, got: {body}'
print('PASS: idempotent re-run: synced=0, updated=1, skipped=1')
"

# DB row count still 1
npx tsx --env-file=.env -e "
import { prisma } from './src/lib/db';
prisma.scheduledItem.count({
  where: { goalId: '$GOAL_ID', externalRef: { startsWith: 'gh:milestone:' } }
}).then(n => { console.log('DB row count:', n); console.log(n===1 ? 'PASS: count=1 (no duplicates)' : 'FAIL: expected 1, got ' + n); process.exit(0); })
  .catch(e => { console.error(e); process.exit(1); });
"
```

---

## STEP 10 — Manual completion preservation (v2 ISSUE-1)

```sh
echo "=== Step 10: complete_item + re-sync preserves status ==="

# Get the ScheduledItem id
ITEM_ID=$(mcp_call "list_scheduled_items" "{\"goalId\":\"$GOAL_ID\",\"type\":\"milestone\"}" | python3 -c "
import json,sys
d=json.load(sys.stdin)
t=d['result']['content'][0]['text']
body=json.loads(t)
items=body.get('items',[])
print(items[0]['id'] if items else '')
")
echo "ITEM_ID=$ITEM_ID"
[ -z "$ITEM_ID" ] && echo "FAIL: could not get item id" && exit 1

# Mark done manually
R=$(mcp_call "complete_item" "{\"id\":\"$ITEM_ID\"}")
echo "$R"
echo "$R" | python3 -c "
import json,sys
d=json.load(sys.stdin)
t=d['result']['content'][0]['text']
body=json.loads(t)
assert body.get('status') == 'done', f'FAIL: expected done, got: {body}'
print('PASS: item manually completed')
"

# Re-run sync — open milestone update must NOT reset status to planned
R=$(mcp_call "sync_github_milestones" "{\"goalId\":\"$GOAL_ID\"}")
echo "$R"

# Verify status still done
R=$(mcp_call "list_scheduled_items" "{\"goalId\":\"$GOAL_ID\",\"type\":\"milestone\"}")
echo "$R"
echo "$R" | python3 -c "
import json,sys
d=json.load(sys.stdin)
t=d['result']['content'][0]['text']
body=json.loads(t)
items=body.get('items',[])
assert len(items)==1
item=items[0]
assert item.get('status')=='done', f'FAIL: v2 ISSUE-1 regression — re-sync reset status to: {item.get(\"status\")} (expected done)'
print('status=', item['status'])
print('PASS: v2 status-preservation — open milestone re-sync did not un-complete item')
"
```

---

## STEP 11 — closeCompleted path: M3 fixture

```sh
echo "=== Step 11: closeCompleted path via M3 ==="

# Create M3 with due_on
M3_RESP=$(gh api /repos/jronnomo/Chewgether/milestones \
  -X POST \
  -f title="EPIC-C TEST M3" \
  -f description="QA smoke closeCompleted test" \
  -f due_on="2026-10-01T07:00:00Z")
M3_NUMBER=$(echo "$M3_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['number'])")
echo "M3_NUMBER=$M3_NUMBER"
[ -z "$M3_NUMBER" ] && echo "FAIL: could not create M3" && exit 1

# Close M3 in GitHub
gh api -X PATCH /repos/jronnomo/Chewgether/milestones/${M3_NUMBER} \
  -f state=closed
echo "M3 closed in GitHub"

# Sync with closeCompleted=true — M3 should arrive as status=done with completedAt set
R=$(mcp_call "sync_github_milestones" "{\"goalId\":\"$GOAL_ID\",\"closeCompleted\":true}")
echo "$R"
echo "$R" | python3 -c "
import json,sys
d=json.load(sys.stdin)
t=d['result']['content'][0]['text']
body=json.loads(t)
assert 'isError' not in body or body.get('isError') != True, f'FAIL: {body}'
# M1 was already existing (step 10 ran) — should be updated=1; M3 is new — synced=+1; M2 skipped
print('synced=',body.get('synced'),'updated=',body.get('updated'),'skipped=',body.get('skipped'))
items=body.get('items',[])
m3_item=[i for i in items if str($M3_NUMBER) in i.get('externalRef','')]
assert len(m3_item)==1, f'FAIL: M3 item not in response: {items}'
print('M3 item:', m3_item)
print('PASS: closeCompleted sync response shape OK')
"

# Verify M3 ScheduledItem has status=done and completedAt set
npx tsx --env-file=.env -e "
import { prisma } from './src/lib/db';
prisma.scheduledItem.findFirst({
  where: { goalId: '$GOAL_ID', externalRef: 'gh:milestone:$M3_NUMBER' },
  select: { status: true, completedAt: true, date: true }
}).then(r => {
  if (!r) { console.log('FAIL: M3 ScheduledItem not found'); process.exit(1); }
  console.log('M3 ScheduledItem:', JSON.stringify(r));
  if (r.status !== 'done') { console.log('FAIL: expected status=done, got:', r.status); process.exit(1); }
  if (!r.completedAt) { console.log('FAIL: completedAt is null'); process.exit(1); }
  if (r.date.toISOString().slice(0,10) < '2026-10-01') { console.log('WARN: date unexpected:', r.date); }
  console.log('PASS: M3 status=done, completedAt set:', r.completedAt);
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
"

# Also confirm M1 item still status=done (from step 10 manual completion — closeCompleted on open M1 should not change it,
# and M1 is still open in GitHub at this point)
R=$(mcp_call "list_scheduled_items" "{\"goalId\":\"$GOAL_ID\",\"type\":\"milestone\"}")
echo "$R"
echo "$R" | python3 -c "
import json,sys
d=json.load(sys.stdin)
t=d['result']['content'][0]['text']
body=json.loads(t)
items=body.get('items',[])
m1=[i for i in items if 'gh:milestone:${M1_NUMBER}' in str(i.get('externalRef',''))]
m3=[i for i in items if 'gh:milestone:${M3_NUMBER}' in str(i.get('externalRef',''))]
assert len(m1)==1 and m1[0]['status']=='done', f'FAIL: M1 should still be done, got: {m1}'
assert len(m3)==1 and m3[0]['status']=='done', f'FAIL: M3 should be done, got: {m3}'
print('PASS: M1 still done (manual), M3 done (closeCompleted), v2 ISSUE-1 confirmed')
"
```

---

## STEP 12 — set_github_issue_status: round-trip + 404

```sh
echo "=== Step 12: set_github_issue_status ==="

# Create throwaway issue
ISSUE_RESP=$(gh api /repos/jronnomo/Chewgether/issues \
  -X POST \
  -f title="EPIC-C TEST issue — safe to close" \
  -f body="QA smoke test issue — will be closed/reopened/closed")
ISSUE_NUMBER=$(echo "$ISSUE_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['number'])")
echo "ISSUE_NUMBER=$ISSUE_NUMBER"
[ -z "$ISSUE_NUMBER" ] && echo "FAIL: could not create test issue" && exit 1

# 12a. Close via tool
echo "=== 12a: close via tool ==="
R=$(mcp_call "set_github_issue_status" "{\"goalId\":\"$GOAL_ID\",\"issueNumber\":$ISSUE_NUMBER,\"state\":\"closed\"}")
echo "$R"
echo "$R" | python3 -c "
import json,sys
d=json.load(sys.stdin)
t=d['result']['content'][0]['text']
body=json.loads(t)
assert 'isError' not in body or body.get('isError') != True, f'FAIL: {body}'
assert body.get('state')=='closed', f'FAIL: expected closed, got: {body}'
assert body.get('issueNumber')==$ISSUE_NUMBER, f'FAIL: wrong issue number: {body}'
print('PASS: issue closed via tool, state=', body['state'])
"

# Verify via gh api
STATE=$(gh api /repos/jronnomo/Chewgether/issues/${ISSUE_NUMBER} | python3 -c "import json,sys; print(json.load(sys.stdin)['state'])")
[ "$STATE" = "closed" ] && echo "PASS: verified closed via gh api" || echo "FAIL: expected closed, gh shows: $STATE"

# 12b. Reopen via tool
echo "=== 12b: reopen via tool ==="
R=$(mcp_call "set_github_issue_status" "{\"goalId\":\"$GOAL_ID\",\"issueNumber\":$ISSUE_NUMBER,\"state\":\"open\"}")
echo "$R"
echo "$R" | python3 -c "
import json,sys
d=json.load(sys.stdin)
t=d['result']['content'][0]['text']
body=json.loads(t)
assert body.get('state')=='open', f'FAIL: expected open, got: {body}'
print('PASS: issue reopened via tool')
"

# 12c. Close again (cleanup)
mcp_call "set_github_issue_status" "{\"goalId\":\"$GOAL_ID\",\"issueNumber\":$ISSUE_NUMBER,\"state\":\"closed\"}" > /dev/null
echo "Test issue closed (cleanup)"

# 12d. issueNumber 99999 → "Issue #99999 not found in jronnomo/Chewgether."
echo "=== 12d: 404 path ==="
R=$(mcp_call "set_github_issue_status" "{\"goalId\":\"$GOAL_ID\",\"issueNumber\":99999,\"state\":\"closed\"}")
echo "$R"
echo "$R" | python3 -c "
import json,sys
d=json.load(sys.stdin)
t=d['result']['content'][0]['text']
body=json.loads(t)
# isError should be true
assert body.get('isError') == True, f'FAIL: expected isError=true, got: {body}'
msg=body.get('content',[{}])[0].get('text','') if isinstance(body.get('content'),list) else t
assert 'Issue #99999' in t and 'jronnomo/Chewgether' in t, f'FAIL: expected issue not-found message, got: {t}'
print('PASS: 404 message:', t[:100])
"
```

---

## STEP 13 — Token non-leak assertion

```sh
echo "=== Step 13: token non-leak ==="
# The orchestrator must NOT echo the token value in output.
# This comparison uses process substitution to avoid printing the token.
TOKEN_HITS=$(grep -c "$(gh auth token)" "$RESPONSES_FILE" 2>/dev/null || echo "0")
if [ "$TOKEN_HITS" = "0" ]; then
  echo "PASS: token non-leak — 0 occurrences of GITHUB_TOKEN in all captured responses"
else
  echo "FAIL: GITHUB_TOKEN found $TOKEN_HITS time(s) in captured responses"
fi
# NOTE: Do not print the result of `gh auth token` — compare only.
```

---

## STEP 14 — Kind gate assertion (code-review only)

```sh
echo "=== Step 14: kind gate ==="
# The fitness goal cmopuj97x0000ykdnsyghostg has no githubRepo set.
# First assert the "not-linked" error fires BEFORE the kind check.
FITNESS_GOAL_ID="cmopuj97x0000ykdnsyghostg"
R=$(mcp_call "sync_github_milestones" "{\"goalId\":\"$FITNESS_GOAL_ID\"}")
echo "$R"
echo "$R" | python3 -c "
import json,sys
d=json.load(sys.stdin)
t=d['result']['content'][0]['text']
body=json.loads(t)
assert body.get('isError')==True, f'FAIL: expected error for unlinked fitness goal: {body}'
assert 'link_github_project' in t, f'FAIL: expected link_github_project suggestion, got: {t}'
print('PASS: not-linked error fires for fitness goal (no githubRepo)')
print('KIND GATE: kind check is not reachable without a linked repo; verified by code review that:')
print('  resolveLinkedGoal throws before kind check if githubRepo is null')
print('  sync_github_milestones checks kind AFTER resolveLinkedGoal succeeds')
print('  kind=project enforcement at github-tools.ts line 702-706')
"
# Do NOT link the fitness goal — mutating it is forbidden per instructions.
echo "KIND GATE: code-review verified (cannot test without mutating fitness goal)"
```

---

## STEP 15 — Cleanup + final orphan check

```sh
echo "=== Step 15: cleanup ==="

# Delete milestones
gh api -X DELETE /repos/jronnomo/Chewgether/milestones/${M1_NUMBER} && echo "M1 deleted"
gh api -X DELETE /repos/jronnomo/Chewgether/milestones/${M2_NUMBER} && echo "M2 deleted"
gh api -X DELETE /repos/jronnomo/Chewgether/milestones/${M3_NUMBER} && echo "M3 deleted"

# Delete temp goal (cascades all ScheduledItems)
R=$(mcp_call "delete_goal" "{\"goalId\":\"$GOAL_ID\",\"confirm\":true}")
echo "$R"
echo "$R" | python3 -c "
import json,sys
d=json.load(sys.stdin)
t=d['result']['content'][0]['text']
body=json.loads(t)
assert 'isError' not in body or body.get('isError') != True, f'FAIL: delete_goal: {body}'
print('PASS: temp goal deleted')
"

# Final orphan check — no ScheduledItems with gh:milestone: refs for deleted goal
npx tsx --env-file=.env -e "
import { prisma } from './src/lib/db';
prisma.scheduledItem.count({
  where: { goalId: '$GOAL_ID', externalRef: { startsWith: 'gh:milestone:' } }
}).then(n => {
  console.log('Orphan count after cascade:', n);
  console.log(n===0 ? 'PASS: 0 orphans — cascade delete worked' : 'FAIL: ' + n + ' orphans remain');
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
"

# Chewgether milestones back to 0
echo "=== Final: Chewgether milestones ==="
REMAINING=$(gh api /repos/jronnomo/Chewgether/milestones?state=all | python3 -c "import json,sys; print(len(json.load(sys.stdin)))")
echo "Milestones remaining: $REMAINING"
[ "$REMAINING" = "0" ] && echo "PASS: Chewgether milestones = 0" || echo "FAIL: expected 0, got $REMAINING"

echo ""
echo "=== SMOKE COMPLETE ==="
```
