# BOS Project — Automated Test Runner Instruction

> This document covers everything about the automated test suite: setup, execution,
> test coverage, known issues, troubleshooting, and how to extend the suite.

## Quick start

```bash
# 1. Add credentials to .env (one-time)
echo "TEST_ADMIN_PASSWORD=yourpassword"       >> .env
echo "SUPABASE_SERVICE_ROLE_KEY=your_key"    >> .env

# 2. Run the full suite
npm test

# 3. Check output — 147 tests; 144 pass + 3 fail until migration #30 is applied
#    (post-migration: 147/147 pass, 1 expected skip)
```

---

## Prerequisites

### Required `.env` keys

| Key | Where to get it | Required for |
|-----|----------------|-------------|
| `VITE_SUPABASE_URL` | Already in `.env` (Vite app config) | All tests |
| `VITE_SUPABASE_ANON_KEY` | Already in `.env` | All tests |
| `TEST_ADMIN_PASSWORD` | Password for `phamvietdung812020@gmail.com` | All tests |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Settings → API → `service_role` | Multi-user tests |

Without `SUPABASE_SERVICE_ROLE_KEY`, multi-user tests are **skipped** (not failed):
- Approval chain tests
- Multi-stage workflow tests
- DM channel tests
- User group tests
- Role restriction tests
- 3-user parallel posting
- Notification trigger chain tests

Single-user tests (101 total, ~70 of which are single-user) still run fine without it.

---

## Run modes

| Command | What it runs |
|---------|-------------|
| `npm test` | Full suite (feature + deep scenarios) |
| `npm run test:stress` | + 50-message concurrent test + 3-user parallel stress |
| `npm run test:realtime` | + Realtime delivery test (5s subscribe + receive) |
| `npm run test:all` | Everything |
| `npm run test:clean` | Delete all `[TEST]` data and exit — safe to run anytime |

Add `--verbose` to any command for full error stack traces on failures:
```bash
node scripts/test-runner.mjs --verbose
node scripts/test-runner.mjs --stress --verbose
```

---

## Test suites (in execution order)

### 1. Connection & Auth
Tests Supabase reachability and admin sign-in.

### 2. Chat — messages & reactions
- Post text message to a team channel
- Post `@mention` message (with `mentions` array)
- Add and toggle-off an emoji reaction (`chat_message_reactions`)
- Post a rich card (`payload: { kind: 'form_submission_link', ... }`)
- Fetch messages with nested reactions (single PostgREST query)

**Returns** the channel ID used by later suites.

### 3. Chat — project thread
- Post a message in `context_type: 'project'`
- Requires at least one project in the DB (skips gracefully if none)

### 4. Chat — DM channels *(requires service role)*
- Call `get_or_create_dm_channel(partner_id)` RPC
- Send a DM, verify partner can read it
- Confirm viewer cannot read DM (RLS)

### 5. Workflows — existing templates
- List templates
- Create a workflow run
- Snapshot steps via `snapshot_workflow_run` RPC
- Create step results, complete first step
- Complete the entire run

### 6. Multi-user: @mention → notification *(requires service role)*
- Admin mentions editor in team channel
- Waits 1.5 s for `fan_out_mentions` DB trigger
- Verifies editor receives `kind='mention'` notification
- Marks notification read, then restores to unread

### 7. Multi-user: Full workflow approval chain *(requires service role)*
Full end-to-end flow:
1. Admin creates a 2-step template (step 2 requires admin approval)
2. Editor starts a run
3. Editor snapshots steps, creates step results
4. Editor completes step 1 (no approval)
5. Editor submits step 2 with `approval_status = 'pending'` → DB trigger fires
6. Waits 2 s for `fan_out_approvals` trigger
7. Verifies `approval_request` card appears in admin's personal channel
8. Verifies `kind='approval_requested'` notification for admin
9. Admin approves step 2 (`approval_status = 'approved'`)
10. Run marked completed

### 8. Multi-user: User groups & team visibility *(requires service role)*
- Admin creates a user group
- Adds editor as member
- Editor sees own membership (RLS check)
- Admin sees all members (leader view)
- Viewer is not in group
- Admin removes editor, group cleaned up

### 9. Forms
- List active form templates (skips if none exist)
- Submit a form response with sample data
- Query submissions

### 10. Projects
- List projects
- Create a test project
- Update project status

### 11. Notifications
- Fetch notifications
- Mark a notification read, restore to unread

### 12. Unread count RPCs
- `get_chat_unread_counts(p_context_ids)` — per-context unread
- `get_chat_total_unread()` — scalar total

### 13. Lab — AI Assistants & FAQ
- List AI bots (`helper_panels.type = 'chatbot'`)
- List FAQ docs (`helper_panels.type = 'faq'`)
- List documents
- Check `ai_usage_logs` table (errors with hint if migration not run)

### 14. Role-based access control *(requires service role)*
- Editor can post a chat message
- Viewer can read team channels
- Viewer cannot delete others' messages (RLS silent block)

### 15 (optional). Realtime delivery `--realtime`
- Subscribe to `chat_messages` INSERT on the test channel
- Insert a message and verify it arrives via realtime within 5 s

### 16 (optional). Stress test `--stress`
- 50 concurrent inserts via `Promise.all`
- 3-user parallel: 25 messages each (75 total)
- Reports messages/second throughput

---

## Deep scenario tests (added after initial suite)

These run after the standard suites and test more complex multi-step flows.

### Deep: Multi-stage workflow (4 steps, 2 approval gates) *(requires service role)*
- Admin creates a 4-step template:
  - Step 0: plain (editor does work)
  - Step 1: approval gate — admin approves
  - Step 2: plain (editor does more work)
  - Step 3: approval gate — editor **self-approves**
- Editor starts run, snapshots, creates results
- Editor completes step 0
- Editor submits step 1 for approval → admin approves
- Editor completes step 2
- Editor submits step 3 → editor self-approves
- Run marked completed
- Template cleaned up

### Deep: FAQ helper panel — CRUD + ordering
- Create a `type='faq'` helper panel
- Insert 3 FAQ items with `order_index` 0/1/2
- Query ordered by `order_index` (asserts exactly 3 items)
- Update one item's answer
- Delete the panel — verifies cascade delete removes items

### Deep: Form template creation + linked to workflow step
- Create a form template with 2 fields (text + number), `summary_field_ids`
- Create a workflow template with a step linking `form_template_id`
- Start a run, snapshot steps
- Assert `form_template_id` is present in snapshot (`workflow_run_steps`)
- Create a form submission, link `form_submission_id` to the step result

### Deep: Full project lifecycle (all statuses + multi-user thread)
- Create project assigned to editor (triggers `project_assigned` notification)
- Waits 1 s, verifies editor receives `kind='project_assigned'` notification
- Cycles through all 5 statuses: `open → in_progress → review → completed → cancelled`
- Admin and editor each post to the project thread
- Verifies multi-user thread is visible

### Deep: Workflow run link posted to chat channel
- Looks for the most recent workflow run in the DB
- Posts a `kind='workflow_run_link'` rich card to the test channel
- Fetches feed and verifies the card appears with correct payload

**Note:** This test often skips — by the time it runs, runs created earlier in the suite
have been cascade-deleted when their templates were cleaned. The rich card path is verified
in the earlier "Post rich card (payload)" test. **This is not a bug.**

### Deep: Workflow schedules (create / toggle / delete)
- Requires at least one workflow template in the DB
- Creates a `enabled=false` daily schedule (`routine: { kind: 'daily', at: '03:00', tz: 'Asia/Ho_Chi_Minh' }`)
- Queries routine jsonb and `next_run_at`
- Checks `schedule_runs_history` table exists
- Enables schedule, then deletes it
- Gracefully skips if `workflow_schedules` table not in schema cache (migration not run)

### Deep: File attachments in chat
- Posts a message to the test channel
- Inserts a `chat_attachments` row (simulated upload metadata — **no file upload**)
- Verifies nested select: `chat_messages.select('..., attachments:chat_attachments(...)')`

**Schema confirmed:** `chat_attachments` columns: `id, message_id, file_name, file_url, file_type, file_size, created_at`
**No `uploaded_by` column** — the uploader is derived from the message's `author_id`.

### Deep: Rich text HTML messages — multi-user
- Admin posts an HTML message (`<strong>`, `<ul>`, `<li>`)
- Editor posts an HTML reply (`<em>`)
- Fetches feed and counts messages containing HTML tags

### Deep: Chat — parallel posting, multi-reactions, unread tracking
- 3 users post simultaneously (3 messages each = 9 total, `Promise.allSettled`)
- Admin posts a target message; admin, editor, and viewer each add a different emoji reaction (`👍 😮 ❤️`)
- Each user upserts `chat_last_read` for the test channel
- Verifies `get_chat_unread_counts` returns correct totals

---

## Test data isolation

- **All inserted rows use `[TEST]` prefix** in name/title/content/template_name fields.
- Cleanup runs automatically at the end of every suite via:
  - `ilike '%[TEST]%'` on content/name/title columns
  - Tracked IDs in `created.messages`, `created.runs`, `created.submissions`, `created.projects`, `created.channels`
- **Safe to run against the production DB** — test data is clearly separated.
- Run `npm run test:clean` at any time to purge leftover `[TEST]` data.

---

## Test user setup

When `SUPABASE_SERVICE_ROLE_KEY` is set, the runner creates 3 isolated test users
via `svc.auth.admin.createUser({ email_confirm: true })`:

| User | Email | Password | Role |
|------|-------|----------|------|
| Test Admin | `test-admin@bos-test.local` | `TestAdm1n!` | `admin` |
| Test Editor | `test-editor@bos-test.local` | `TestEd1t!` | `editor` |
| Test Viewer | `test-viewer@bos-test.local` | `TestV1ew!` | `member` |

Profiles are upserted via service role so RLS is accurate. Each user gets a
signed-in Supabase client (Bearer JWT) so RLS applies to every query.

These users are deleted during cleanup. If cleanup is interrupted, run
`npm run test:clean` to remove them.

---

## Known issues & expected behavior

### "Post workflow run card" always skips
By the time `testWorkflowFromChat` runs, runs created earlier in the suite have been
cascade-deleted when their test templates were cleaned up. Not a bug — the rich card
posting logic is covered by the earlier "Post rich card (payload)" test.

### Schema cache error on `workflow_schedules`
If `migration_phase_schedules.sql` hasn't been run, the INSERT returns:
```
Could not find the table 'public.workflow_schedules' in the schema cache
```
The `testWorkflowSchedules` function gracefully skips with a hint. Run the migration
in Supabase SQL Editor, then re-run the suite.

### `cron.schedule()` returns "Schedule = 1"
This is the **pg_cron job ID** — an integer assigned to the registered job. It is
**not an error**. Verify with:
```sql
select jobid, jobname, schedule, command, active from cron.job;
```

### `chat_attachments` has no `uploaded_by` column
Confirmed schema: `id, message_id, file_name, file_url, file_type, file_size, created_at`.
Never include `uploaded_by` in inserts to this table.

### `notifications.read_at` is nullable — no `is_read` column
Unread = `read_at IS NULL`. Mark read by setting `read_at = now()`.

### `workflow_step_results.done_at` — not `completed_at`
The column is `done_at timestamptz`. Tests use `.update({ is_done: true, done_at: new Date().toISOString() })`.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| "TEST_ADMIN_PASSWORD not set" | Missing `.env` entry | `echo "TEST_ADMIN_PASSWORD=..." >> .env` |
| All multi-user tests skip | Missing `SUPABASE_SERVICE_ROLE_KEY` | Add it to `.env` |
| 403 on any table query | Missing GRANT | Run `grant select, insert on public.<table> to authenticated;` |
| "schema cache" error | PostgREST hasn't picked up new columns | Run `notify pgrst, 'reload schema';` in SQL Editor |
| Approval card not found | `fan_out_approvals` trigger missing | Run `migration_phase_workflow_approval.sql` |
| `ai_usage_logs` error | Migration not run | Run `migration_phase_ai_usage_log.sql` |
| `workflow_schedules` skip | Migration not run | Run `migration_phase_schedules.sql` |
| Realtime test fails | Realtime publication missing | Add table to `supabase_realtime` publication |
| Stress test fails >5/50 | DB connection pool exhausted | Normal on free tier; re-run once |

---

## Schema facts confirmed by the test suite

These were verified empirically and are the authoritative source — trust these over
assumptions or older docs:

| Fact | Verified by |
|------|------------|
| `chat_attachments` has no `uploaded_by` column | `testFileAttachments` |
| `workflow_step_results.done_at` (not `completed_at`) | `testWorkflows`, `testApprovalChain` |
| `notifications.read_at` nullable (no `is_read`) | `testNotifications` |
| `get_chat_unread_counts` param = `p_context_ids` | `testUnreadCounts` |
| `projects.status` values: `open\|in_progress\|review\|completed\|cancelled` | `testProjectsDeep` |
| `cron.schedule()` returns integer job ID | `testWorkflowSchedules` |
| `workflow_run_steps.form_template_id` present after snapshot | `testFormCreationAndWorkflow` |
| `chat_message_reactions` unique on `(message_id, user_id, emoji)` | `testChatDeep` |
| `fan_out_approvals` trigger fires within ~2 s | `testApprovalChain`, `testMultiStageWorkflow` |
| `fan_out_mentions` trigger fires within ~1.5 s | `testMentionNotification` |
| `project_assigned` trigger fires within ~1 s | `testProjectsDeep` |

---

## Adding new tests

1. Write a new `async function testMyFeature(client, ...)` using `test()`, `skip()`, and `section()`.
2. Track any created rows in `created.*` arrays for automatic cleanup.
3. Use `[TEST]` prefix in all inserted names/titles/content.
4. Add a `skip()` guard when the feature requires migrations or service role.
5. Call the function in `main()` after the relevant existing tests, passing the right clients.
6. Update the test count in CLAUDE.md gotcha #36.

Example skeleton:
```js
async function testMyFeature(adminClient, adminId) {
  section('My Feature — CRUD')

  let recordId = null

  await test('Create record', async () => {
    const { data, error } = await adminClient.from('my_table').insert({
      name: '[TEST] My record',
      created_by: adminId,
    }).select('id').single()
    if (error) throw error
    recordId = data.id
    return `id: ${recordId.slice(0, 8)}…`
  })

  if (!recordId) return

  await test('Read record back', async () => {
    const { data, error } = await adminClient.from('my_table').select('*').eq('id', recordId).single()
    if (error) throw error
    return data.name
  })

  // Cleanup — or let the ilike cleanup handle it if name has [TEST]
  await adminClient.from('my_table').delete().eq('id', recordId)
}
```

---

## Migration dependency map for tests

Tests that require specific migrations to have been run:

| Test suite | Required migration |
|------------|-------------------|
| Chat messages | `schema.sql` (base) |
| Rich cards (payload) | `migration_phase_chat_rich_card.sql` (#11) |
| DM channels | `migration_phase_workflow_approval.sql` (#15) |
| Workflow approval chain | `migration_phase_workflow_approval.sql` (#15) |
| Unread RPCs | `migration_phase_chat_unread.sql` (#14) |
| Reactions | `migration_phase_reactions.sql` (#16) |
| AI usage logs | `migration_phase_ai_usage_log.sql` (#17) |
| Workflow schedules | `migration_phase_schedules.sql` (#9) |
| Notifications + triggers | `migration_phase_notifications.sql` (#8) |
| User groups | `migration_phase_perms_groups.sql` (#5) |
| Workflow snapshot | `migration_phase_run_snapshot.sql` (#6) |
| Approval fields on steps | `migration_phase_workflow_approval.sql` (#15) |
