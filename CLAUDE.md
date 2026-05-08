# BOS Project Manager — Context for Claude

> Read this first whenever you join a session on this codebase. It captures
> non-obvious decisions and gotchas accumulated over many shipping iterations.

## What this app is

An **operations management platform** positioned for SME teams (currently Vietnamese-language UI). It started as a project management tool but has expanded to:

- Team chat (channels + project threads + DM channels) with realtime
- Projects (Kanban + Table views, customer portal with username/password)
- Workflows (templates → runs → step results, with branching + **approval steps**)
- Forms (templates with conditional fields, dynamic submissions — managed in Settings → Lab)
- **Lab** (AI Assistants + FAQ Docs + Document Library + Form Templates)
- Workflow Scheduling (pg_cron)
- Notifications (in-app, realtime)
- User Groups (tag-based ACL + workflow template access control)

Live at: **xichtho.vercel.app**. GitHub: **github.com/xichtho996/bos-project**.

## Stack

- **Frontend:** React 19 + TypeScript + Vite, Tailwind CSS v4 (CSS-based config via `@theme`), `@tanstack/react-query` for fetching, `react-router-dom` v7 BrowserRouter
- **Backend:** Supabase Cloud (Postgres + Auth + Storage + Realtime + Edge Functions + pg_cron)
- **Auth user:** `phamvietdung812020@gmail.com`, role `admin`
- **Hosting:** Vercel (free tier)
- **Automated test runner** — `npm test` runs `scripts/test-runner.mjs` (Node.js ES module, no extra deps). 101 tests covering all features. See gotcha #36.

## Critical gotchas (read before doing anything)

### 1. Tailwind v4, not v3

`tailwind.config.ts` does NOT exist. Theme tokens live in `src/index.css` under `@theme { ... }`. Plugin: `@tailwindcss/vite`. **Don't try `npx tailwindcss init -p`** — it'll fail.

### 2. `verbatimModuleSyntax` is on

Every type-only import must use `import type { Foo }`. TypeScript will fail the build otherwise. This catches first-time contributors constantly.

### 3. Lab tab is INSIDE Settings — not a top-level nav

Users (and Claude) often hunt for the "Lab tab" in the main left sidebar. It's **not there**. Path: gear icon (Settings) → left sub-sidebar → **Lab** button. Sub-tabs inside Lab: AI, FAQ, Docs, **Biểu mẫu** (Forms). There are also `Cá nhân` (Personal) and other sub-tabs inside Settings.

### 4. Migrations are run-once, not auto-applied

Files in `supabase/` named `migration_phase_*.sql` are **idempotent SQL files**. The user runs them manually in Supabase SQL Editor. There is no migration runner. When you add a new migration, **list it explicitly in your final reply** so the user knows to run it. The current chain (in order):

1. `schema.sql` — initial setup
2. `migration_phase_a.sql` — slugs + portal username
3. `migration_phase_helpers.sql` — helper_panels, helper_faq_items
4. `migration_phase_lab.sql` — per-step helper/form attachments
5. `migration_phase_perms_groups.sql` — user_groups + ACL
6. `migration_phase_run_snapshot.sql` — workflow_run_steps
7. `migration_phase_documents.sql` — documents table + bucket
8. `migration_phase_notifications.sql` — notifications + triggers (fan_out_mentions, project_assigned, workflow_completed triggers)
9. `migration_phase_schedules.sql` — pg_cron + workflow_schedules
10. `migration_phase_chat_workflow.sql` — chat_messages.workflow_run_id + message_type='workflow_run_link'
11. `migration_phase_chat_rich_card.sql` — drops rigid message_type CHECK, adds `payload jsonb`, adds `form_templates.summary_field_ids`, adds chat_messages to realtime publication
12. `migration_phase_form_drafts.sql` — form_drafts table (owner-only RLS)
13. `migration_phase_self_chat.sql` — chat_channels.owner_id, personal channel policies, `get_or_create_self_chat()` RPC
14. `migration_phase_chat_unread.sql` — chat_last_read table, `get_chat_unread_counts(uuid[])` + `get_chat_total_unread()` RPCs
15. `migration_phase_workflow_approval.sql` — workflow_template_access, approval columns on workflow_steps/workflow_run_steps/workflow_step_results, DM channels (channel_type + dm_partner_id), `get_or_create_dm_channel()` RPC, `fan_out_approvals` trigger, updated `snapshot_workflow_run`
16. `migration_phase_reactions.sql` — `chat_message_reactions` table (message_id, user_id, emoji, unique constraint), RLS, realtime publication
17. `migration_phase_ai_usage_log.sql` — `ai_usage_logs` table (tracks every personal-bot call: user_id, panel_id, bot_name, query, reply, model, created_at), RLS (owner or admin/editor), `service_role` SELECT + INSERT grants
18. `migration_phase_workflow_duration.sql` — adds `duration_hours numeric default 3` to `workflow_steps` and `workflow_run_steps` for progress-bar visualisation
19. `migration_phase_approver_rls.sql` — four new RLS policies allowing non-owner approvers to SELECT runs/run_steps/step_results and UPDATE approval fields on `workflow_step_results`
20. `migration_phase_approver_rls_fix.sql` — fixes 42P17 infinite RLS recursion between `workflow_runs` and `workflow_run_steps`; replaces the recursive approver policies with two `SECURITY DEFINER` helper functions (`auth_is_approver_for_run`, `auth_can_view_run_steps`). **Must run after #19.** Without this, MessageFeed shows empty for ALL users when any run with approval steps exists.
21. `migration_phase_push_subscriptions.sql` — `push_subscriptions` table (owner-only RLS) + `fan_out_push()` trigger (AFTER INSERT on notifications) that calls the `send-push` Edge Function via `pg_net`. Requires pg_net enabled + two GUC vars set (see gotcha #52).
22. `migration_phase_form_progressive_fill.sql` — adds `form_submissions.last_updated_by_step_id` audit column + a unique partial index `(context_id, template_id) WHERE context_type='workflow_run'` enforcing 1 submission row per (run, template). Enables progressive multi-step fill — see gotcha #54.
23. `migration_phase_workflow_guidance.sql` — adds `workflow_templates.guidance_html text` for long-form rich-text notes (replaces no DB-side notes field). See gotcha #57.
24. `migration_phase_project_code_activity.sql` — adds `projects.code` (auto-generated `D{YYMMDD}` with suffix), `project_status_history` audit table + trigger, `get_project_activity_feed` RPC unioning 7 event sources, and relaxes `form_submissions.context_type` CHECK to allow `'workflow_run'`. See gotcha #58.
25. `migration_phase_project_info_cards.sql` — adds `project_info_cards` table for staff-internal annotations on the customer-portal tab. See gotcha #59.
26. `migration_phase_branch_config.sql` — adds `workflow_steps.branch_config jsonb` + `workflow_steps.show_when jsonb` (and matching snapshot columns on `workflow_run_steps`) for the round-5b condition redesign. Editor writes the new shapes; runtime evaluator port is a follow-up commit. See gotcha #67.
27. `migration_phase_ai_conversation.sql` — adds `workflow_ai_conversations` table for per-template persisted AI assistant chat history (round-6 wizard). One row per template; `messages` jsonb array trimmed to last 50 turns by the edge function. RLS: read = anyone with template access; write = owner / admin / editor. See gotcha #68.
28. `migration_phase_chat_channel_members.sql` — adds `chat_channels.is_private bool` + new `chat_channel_members(channel_id, user_id, role)` table + tightens RLS on `chat_channels` and `chat_messages` so private channels are members-only. New channels created via the UI default to private; legacy channels stay public. Helper RPC `add_channel_member(channel_id, user_id)` for invitations. See gotcha #70.
28b. `migration_phase_chat_channel_members_fix.sql` — RLS recursion fix follow-up to #28. Replaces the recursive policies with `auth_is_channel_member` + `auth_is_admin_or_editor` SECURITY DEFINER helpers (gotcha #48 pattern). **Run AFTER #28** if you hit `42P17 infinite recursion detected in policy for relation chat_channel_members`.
29. `migration_phase_workflow_steps_fk_fix.sql` — fixes the FK constraints that silently blocked the workflow editor's save flow (`workflow_step_results.step_id` and `workflow_run_steps.source_step_id` were `NO ACTION`, so DELETE-and-replace failed on workflows with run history). Sets `step_id` and `source_step_id` to `ON DELETE SET NULL` (preserves run history with broken pointers) and `parent_step_id` to `ON DELETE CASCADE` (self-ref auto-cascade). Without this, edits to a workflow that's been run before silently fail; the page's persist function now also nulls these refs proactively as a fallback. See gotcha #71b.
30. `migration_phase_rls_update_policies_fix.sql` — round-8 RLS gap fixes surfaced by the new sequential test suite. Two missing/over-restrictive policies: (a) `form_submissions` had NO UPDATE policy, so `StepFormModal`'s progressive-fill UPSERT (gotcha #54) silently affected 0 rows — users got "Đã cập nhật" toasts but nothing changed; (b) `workflow_runs` UPDATE was gated by `for all using (run_by = auth.uid())`, so admin/editor pressing "Hoàn thành" on a run they didn't start (the common multi-user approval flow) also silently failed. Migration #30 adds an UPDATE policy to `form_submissions` for submitter + admin/editor, and splits the monolithic `workflow_runs` policy into INSERT/UPDATE/DELETE so admin/editor can UPDATE any run. See gotcha #76.
31. `migration_phase_quick_tasks.sql` — round-9 Quick TODO center. Adds `quick_tasks` table (title + optional rich-text description + `assignee_user_id` OR `assignee_group_id` + optional `source_message_id` link to `chat_messages` + status open/done/cancelled + due date) with a CHECK enforcing one assignee dimension. RLS: visibility for creator + assignee + group members + admin/editor; INSERT requires `created_by = auth.uid()`; UPDATE/DELETE follow visibility rules. Extends `notifications.kind` enum to include `'task_assigned'` + `'task_completed'`. New `fan_out_task_assignment` trigger fires on INSERT — sends a `task_assigned` notification to the assigned user (group assignments stay quiet to avoid spam). See gotcha #77.

The user has been mostly running these but sometimes lags. If a feature "doesn't work" and Lab is empty / 403s / 404s appear, **check whether the relevant migration ran first** (use the browser DevTools Network tab — a 404 on `/rest/v1/<table>` confirms the table doesn't exist yet). Features should also tolerate this gracefully — see gotcha #17.

### 5. RLS is the security boundary, not the client

Every table has Row Level Security. Client-side `isAdmin || isEditor` checks are UI hints only — the database enforces. **Never bypass RLS** by using service role key in the browser. Edge Functions can use service role.

### 6. GRANTs are not automatic — and `service_role` is not exempt

Tables created via SQL Editor don't auto-grant `SELECT/INSERT/UPDATE/DELETE` to `anon` and `authenticated` roles. **Every new table needs explicit grants** in its migration. Without this, queries return 403 even for authenticated users. The original symptom: "Lab tab shows but is empty; console shows 403 on /helper_panels".

**`service_role` also needs explicit grants.** It bypasses RLS but still needs GRANT for DML. Edge Functions using the service-role key will get "permission denied for table X" if the table was only granted to `authenticated`. Pattern for any table an Edge Function writes to:
```sql
grant select, insert on public.my_table to authenticated;
grant select, insert on public.my_table to service_role;
```
This bit us when `personal-bot` tried to INSERT into `chat_messages` — the table had no `service_role` INSERT grant.

### 7. Supabase Storage URLs are public

The `chat-attachments`, `documents`, and any future buckets are **public read**. This enables the Office Online viewer trick (docx/xlsx/pptx preview) but means files have no auth gate. Don't put private documents there — the URL is shareable. RLS only applies to the metadata rows, not the blob content.

### 8. Forms storage paths follow a convention

- Chat attachments: `chat-attachments/<context_id>/<date>/<uuid>.<ext>`
- Form-field assets: `chat-attachments/forms/<field_id>/...` (yes, in chat-attachments bucket — legacy)
- Documents library: `documents/<slugified-folder>/<timestamp>-<name>.<ext>`

The cleanup script in `supabase/maintenance_storage_cleanup.sql` finds orphans.

### 9. Workflow runs use snapshot, not live template

Older runs reference `workflow_steps` directly (legacy). Newer runs (after `migration_phase_run_snapshot.sql`) snapshot into `workflow_run_steps`. **Both WorkflowRunPage and WorkflowRunPanel detect mode automatically** — if the run has snapshot rows, uses `snapshot_id` to key step_results; otherwise `step_id`. Don't touch this dual-mode logic without thinking about both paths.

`WorkflowRunPanel` (in the chat side panel) is now the **primary** execution interface — fully interactive (check steps, branches, notes, form modals, approval controls, complete button). `WorkflowRunPage` still exists for direct URL access but is no longer required from chat.

### 10. The `__OTHER__` marker in form data is hacky

When a user picks "Khác" (Other) in a select/radio field, the value stored is the string `"Khác: <free text>"`. Multi-select stores it as an array element. This is hard to query later (`WHERE answer = 'Khác'` doesn't work for individual users' "other" responses). **It's a known sorry-decision** documented in the architecture critique. Don't compound the issue — if you add new option-style fields, follow the same pattern, but flag in the PR if you can do better.

### 11. `helper_panels.type='chatbot'` is the AI Assistant; `'faq'` is the FAQ Doc

The schema name is `helper_panels` but the UX surface calls them "AI Assistant" and "FAQ Doc". This naming mismatch is intentional — renaming the schema is high-cost. Keep it in mind when reading SQL or writing new admin UI.

### 12. Realtime selectively enabled

Currently published in `supabase_realtime`: `chat_messages`, `notifications`. NOT in: `workflow_runs`, `workflow_step_results`, `projects`, `form_submissions`. If you need live updates for those, add to the realtime publication AND wire a subscription in the relevant page. Without realtime they fall back to `refetchInterval` polling.

### 13. AI runtime requires Edge Function setup

Two Edge Functions handle AI features — both must be deployed manually via the Supabase Dashboard (paste code into the editor, click Deploy):

- **`chat-helper`** — powers AI Assistants in `HelperPanelView` (Settings → Lab → AI). Code: `supabase/functions/chat-helper/index.ts`.
- **`personal-bot`** — powers the `@bot` picker in the personal "Cá nhân" channel. Code: `supabase/functions/personal-bot/index.ts`.

Both require `LLM_API_KEY` set in Supabase Dashboard → Project Settings → Edge Functions → Secrets.

Without deployment, `chat-helper` returns a clear error message. `personal-bot` returns a 500 that shows as "Bot lỗi: …" in the toast. See gotcha #32 for the full setup checklist for `personal-bot`.

### 14. pg_cron may not run on free tier

`migration_phase_schedules.sql` schedules `run_due_schedules()` every minute via pg_cron. **Supabase free tier sometimes pauses pg_cron when DB sleeps.** Check Database → Extensions → pg_cron is enabled. If schedules don't fire, this is the first thing to check.

### 15. Vercel Git Author Verification

If a commit's author email doesn't match a verified GitHub email, Vercel Hobby blocks the deploy with "commit email could not be matched". The user's verified email is `phamvietdung812020@gmail.com`. **Don't commit with `dev@bos.app` or generic emails.** Already-deployed commits with that email had to be force-rewritten via `git rebase --root --exec "git commit --amend --no-edit --reset-author"` then `git push --force-with-lease`.

### 16. Supabase Realtime channels MUST have unique names per mount

`supabase.channel('foo')` returns the **cached** channel if one with that name already exists. In React StrictMode/HMR/dev double-mount, the cleanup `removeChannel` may not have completed before the next mount runs. Result: `.on('postgres_changes', ...)` is called on an already-subscribed channel → **uncaught throw → blank app**.

**Pattern to follow:**
```ts
const channel = supabase
  .channel(`notifications-${user.id}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`)
  .on('postgres_changes', {...}, handler)
  .subscribe(status => {
    if (status === 'CHANNEL_ERROR') console.warn('realtime unavailable')
  })
return () => { supabase.removeChannel(channel) }
```

Always:
- Unique channel name (timestamp + random suffix)
- `.subscribe(status => …)` callback so failures log instead of throw
- Wrap subscribe call in `try/catch` for extra safety
- See `NotificationBell.tsx` for the canonical example

### 17. Features must not crash when their migration hasn't run

The user runs migrations manually (gotcha #4). New features must **gracefully degrade** when the relevant table doesn't exist yet — typically a 404 on the first query. **Never let an unhandled query error blank the entire app.**

**Pattern:**
```ts
useQuery({
  queryKey: [...],
  queryFn: async () => {
    const { data, error } = await supabase.from('new_table').select(...)
    if (error) {
      console.warn('[Feature] query failed (migration pending?):', error.message)
      return []  // or sensible default
    }
    return data
  },
  retry: false,  // don't spam retries on a permanently 404'd table
})
```

This was the root cause of the "app blank after IBM Carbon theme deploy" incident — the bell's notifications query threw on 404 when the user hadn't run the notifications migration.

### 18. Side panel store uses `useSyncExternalStore` — no Zustand

`src/lib/sidePanelStore.ts` is a hand-rolled singleton store (module-level state + subscriber set) exposed via `useSyncExternalStore`. No external state library needed. Key exports:

```ts
openPanel({ id, kind, title, meta? })   // opens panel (or replaces active)
closePanel(id?)                          // close active or specific panel
minimizePanel()                          // active → minimized chips
restorePanel(id)                         // chip → active
clearPanels()                            // wipe all state (called on route change)
replaceActiveId(newId, newTitle)         // swap id after draft creation
useSidePanel()                           // React hook → { active, minimized }
```

`PanelKind = 'submission_view' | 'workflow_run'`. The `workflow_run` kind renders as a centred modal overlay; `submission_view` renders as a right-side slide-in (480px). `AppShell` reads `useSidePanel()` to apply `md:mr-[480px]` to the main column only on `/chat` and only for non-workflow-run panels.

`meta?: Record<string, unknown>` is passed through without interpretation. `workflow_run` panels use `meta: { context_type, context_id }` so `WorkflowRunPanel` knows which chat thread to post rich cards back to.

### 19. "Chat" is "Tin nhắn" in all UI text — route and code names stay `/chat`

The nav label, page title, and any user-visible references use **"Tin nhắn"** (never "Chat"). Internally: route is `/chat`, component is `ChatPage`, files are `chat/MessageFeed.tsx` etc. Don't rename files or routes — just keep visible strings as "Tin nhắn".

### 20. `chat_messages.payload` is the extension point — not `message_type`

Issue I1 (rigid CHECK enum) is resolved. `message_type` is now an open text field (CHECK removed in migration #11). New card kinds go in `payload: RichCardPayload` (a TS discriminated union in `src/types/index.ts`). Add a new `kind` variant there — no SQL migration needed. Legacy `message_type='form_submission'` rows (no payload) still render via the old `FormSubmissionCard` in MessageFeed; don't remove that branch.

### 21. Mention notifications work automatically via DB trigger — no client code needed

`fan_out_mentions()` trigger fires on every `chat_messages INSERT`. It reads `new.mentions uuid[]` (sent by `MessageInput` when the user tags someone) and inserts a `notifications` row with `kind='mention'` for each mentioned user. The `NotificationBell` already shows these. **Do not add client-side notification creation for mentions** — the trigger handles it.

### 22. Own messages right-align in MessageFeed — `author_id` comparison

`MessageFeed` passes `currentUserId={user?.id ?? null}` to each `MessageBubble`. When `msg.author_id === currentUserId`: layout flips to `flex-row-reverse`, avatar becomes filled primary-600, text renders in a blue bubble, name is hidden. Cards and attachments right-align via `items-end` on the column. This check is purely client-side cosmetic — no DB change.

### 23. Mobile chat input: only Type + Workflow + Attach + Send

On `<md` screens, action buttons are hidden (`hidden md:flex`). A single `MoreHorizontal` button (`md:hidden`) shows a popup with: **Chạy Workflow**, **Đính kèm file**. **There is no form/draft button and no bot placeholder** — forms were removed from chat; the bot is triggered via the `@` picker in the textarea (not a button). Desktop layout unchanged: Type toggle, Workflow (GitBranch), Attach (Paperclip), Send.

### 24. `AppShell` mobile top bar always renders — bell is inside it, not floating

Previously the top bar only showed when a page had `sidebar || title`, and `NotificationBell` was a separate `fixed top-2 right-2` overlay in NavTabs. Both caused coverage issues. Now: AppShell's mobile top bar **always renders** (no condition), and `NotificationBell` is imported directly into AppShell and placed at the right of the top bar. The floating bell div in NavTabs is gone. Desktop sidebar bell (inside the `hidden md:block` nav) is unchanged.

### 25. Chat active context persists in localStorage per-user

`ChatPage` saves `active: ActiveContext` to `localStorage` under key `bos_chat_active_${user.id}` on every change, and restores it on mount when `user.id` first becomes available. This means navigating away and back returns to the same thread. The restore effect runs once (`[user?.id]` deps) and does nothing if no saved state exists or if the JSON is malformed.

### 26. Unread counts use `chat_last_read` table + two RPCs

`chat_last_read (user_id, context_type, context_id, last_read_at)` — primary key on `(user_id, context_id)`, owner-only RLS. Upserted via `useMarkChatRead()` when user opens a thread. Two RPCs:
- `get_chat_unread_counts(uuid[])` — per-context counts (excludes own messages, omits 0s)
- `get_chat_total_unread()` — scalar total (for NavTabs dot)

Both RPCs are `stable security definer` so they use `auth.uid()` server-side and are safe to call from the browser. Both gracefully return empty/0 if migration hasn't run (`retry: false` + console.warn pattern).

### 27. Migrations that depend on predecessor columns must re-add them with `add column if not exists`

If migration N references a column (e.g. `owner_id`) that was added by migration M < N, and the user might not have run M yet, **migration N must also include `alter table ... add column if not exists owner_id ...`** before referencing it. This is idempotent and safe.

This bit us in `migration_phase_workflow_approval.sql`: the backfill and RLS policy referenced `chat_channels.owner_id` (added in `migration_phase_self_chat.sql`). The fix was to add idempotent guards at the top of section 5:
```sql
alter table public.chat_channels
  add column if not exists owner_id    uuid references public.profiles(id),
  add column if not exists created_by  uuid references public.profiles(id),
  add column if not exists description text;
```

### 28. Workflow approval flow — how it works end-to-end

Steps with `requires_approval = true` follow this lifecycle:
1. Runner completes the step → `workflow_step_results` row created with `approval_status = 'pending'`
2. DB trigger `fan_out_approvals` fires → posts an `approval_request` rich card to the approver's personal chat channel + inserts a `notifications` row (`kind = 'approval_requested'`)
3. Approver opens `WorkflowRunPanel` (via card's "Xem chi tiết →" button) → sees Approve/Reject controls
4. Approver clicks → `approval_status` updated to `'approved'` or `'rejected'`; run continues or halts

Approver resolution: `workflow_run_steps.approver_user_id` (snapshot) → falls back to `workflow_steps.approver_user_id` (template). Role-based resolution (`approver_role = 'admin'|'editor'`) resolves to the first matching user — currently handled in the trigger via `approver_user_id` only (role-based lookup is a TODO). `stepEffectivelyDone()` in WorkflowRunPanel returns `false` for approval-required steps until `approval_status === 'approved'`.

**In the trigger function (`fan_out_approvals`)**: use only scalar variables in `SELECT ... INTO` — never a `record` variable. The bug `"snap_row" is not a scalar variable` was caused by mixing `record` and scalars in the same `INTO` clause.

### 30. Message reactions — emoji set + reaction model

`chat_message_reactions (id, message_id, user_id, emoji, created_at)` with a `unique(message_id, user_id, emoji)` constraint. Emoji set is fixed client-side: `['👍', '😮', '😢', '😂', '❤️', '💔', '😎']` (defined in `REACTION_EMOJIS` in `MessageFeed.tsx`).

Reactions are fetched **embedded in the messages query** via a nested PostgREST select (`reactions:chat_message_reactions(id, emoji, user_id, created_at)`). This avoids N+1 — one query loads messages + reactions. The chat message `refetchInterval` is **15 seconds** (Realtime handles instant delivery; polling is fallback only). Realtime subscriptions handle instant delivery for both messages and reactions.

Toggle logic: if the user's own reaction for that emoji already exists → DELETE by id; otherwise → INSERT. The `ReactionsArea` component in `MessageFeed.tsx` handles both the reaction row (grouped by emoji, count, highlight-if-mine) and the `<Smile>` picker popover (shows on group-hover of the message row).

**New table needs migration #16 to be run.** Before the migration, the nested `reactions:chat_message_reactions(...)` in the messages query returns a 404 column error — but the query gracefully falls back (reactions will be undefined/empty).

### 31. WorkflowRunPanel is now a push panel, not a modal

`SidePanel.tsx` now renders `workflow_run` panels in the same 480px right-side push panel as `submission_view` by default. The only difference: the workflow panel header has a `<Maximize2>` button that sets `active.expanded = true`, switching it to the centred modal overlay (original behavior).

**`OpenItem.expanded?: boolean`** in `sidePanelStore.ts` — when `true` → overlay; when `false`/absent → push panel. `togglePanelExpand()` flips it. `AppShell`'s `pushRight` logic: `!panelActive.expanded` (so overlay mode doesn't push content).

This means chat content is always visible alongside workflow runs unless the user explicitly maximizes. Use `<Minimize2>` button in the expanded header to return to push-panel mode.

### 32. Personal-bot Edge Function — full setup checklist

The `@` bot picker in the personal channel ("Cá nhân") requires all of these to work end-to-end:

1. **`migration_phase_chat_rich_card.sql` must have run** — adds `payload jsonb` to `chat_messages`. Without it the insert fails with "column payload does not exist".

2. **PostgREST schema cache must be reloaded** after that migration:
   ```sql
   notify pgrst, 'reload schema';
   ```
   This is the canonical way to tell PostgREST about new columns without restarting anything.

3. **`service_role` INSERT grant on `chat_messages`** (see gotcha #6):
   ```sql
   grant insert on public.chat_messages to service_role;
   ```

4. **`service_role` SELECT grant on `helper_panels`** (so the function can load custom bot config):
   ```sql
   grant select on public.helper_panels to service_role;
   ```

5. **`service_role` SELECT + INSERT grant on `ai_usage_logs`** (edge function logs every call):
   ```sql
   grant select, insert on public.ai_usage_logs to service_role;
   ```
   Requires migration #17 (`migration_phase_ai_usage_log.sql`) to have run first.

6. **`LLM_API_KEY` secret set** in Supabase Dashboard → Project Settings → Edge Functions → Secrets.

7. **`personal-bot` edge function deployed** (paste `supabase/functions/personal-bot/index.ts` into the dashboard editor).

**How the bot picker works:** `MessageInput` queries `helper_panels WHERE type='chatbot'` (+ a hardcoded "Trợ lý chung" entry) and shows them as a dropdown when the user types `@` in the personal channel. Selecting a bot sends `panel_id` to the edge function, which loads that panel's `system_prompt` + `knowledge_base` from the DB. Adding a new bot in Settings → Lab → AI automatically makes it appear in the picker — no redeploy needed.

**`bot_response` payload fields**: `{ kind: 'bot_response', reply, query, model, panel_id, bot_name }` — `panel_id` and `bot_name` were added in the AI usage log session. `MessageFeed` uses `bot_name` to label the reply chip and `panel_id` to scope conversation history.

### 33. `create policy` has no `if not exists` guard — error 42710 = migration already ran

`create table if not exists` is idempotent. `create policy "name" on ...` is **not** — running it twice gives:

```
ERROR: 42710: policy "owner or admin sees logs" for table "ai_usage_logs" already exists
```

This means the migration ran successfully the first time. No action needed. When writing migrations, consider wrapping policy creation in a `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$` block if idempotency matters — but for one-shot migrations it's fine to let it error on re-run.

### 34. Reply-to-bot: `BotReplyContext` state lifting pattern

Bot conversation history is only included when the user explicitly replies to a bot message (not on every send). Architecture:

- `MessageFeed` has access to the full `messages` array — it defines `handleReplyToBotMsg(msg)` inside the component body (closure over `messages`). When the user clicks the reply icon on a `bot_response` message, it collects up to 5 Q&A pairs walking backward from that message index, then calls `onReplyToBot({ botName, panelId, history[] })`.
- `ChatPage` holds `botReplyContext: BotReplyContext | null` state. It passes `onReplyToBot={isSelfChat ? setBotReplyContext : undefined}` to `MessageFeed` and `botReplyContext` + `onClearBotReply` to `MessageInput`.
- `MessageInput` uses `botReplyContext` when non-null: shows a violet reply chip, uses `botReplyContext.history` as the conversation context for the edge function call, then calls `onClearBotReply()` after send.

Normal (non-reply) sends always use only `[{ role: 'user', content: query }]` — no accumulated history.

The `conversation_history_enabled` / `conversation_history_pairs` settings live in `helper_panels.config` jsonb (no migration needed — reuses existing column). The edge function checks these to trim the message array before the LLM call.

### 35. Mobile back-button exit guard — `ExitGuard` in `App.tsx`

On **mobile** web, pressing the hardware back button when already at the app root would close the tab without warning. `ExitGuard` (mounted inside `<BrowserRouter>` in `App.tsx`) handles this:

```ts
if (!window.matchMedia('(max-width: 767px)').matches) return  // desktop: do nothing
```

1. On mount (mobile only), pushes `{ _bosGuard: true }` into `window.history` via `pushState`.
2. On `popstate`, checks `window.history.state?._bosGuard` — fires when backed to the sentinel.
3. Shows `window.confirm('Bạn có muốn thoát ứng dụng không?')`. Cancelled → re-push sentinel. Confirmed → next back exits.

Desktop back button navigates normally between in-app pages and must **never** trigger an exit dialog — hence the early return. React Router's own history states have `idx`/`key` properties so the `_bosGuard` check only matches the sentinel.

### 36. Automated test runner — `scripts/test-runner.mjs`

Full documentation: **[TEST_INSTRUCTION.md](TEST_INSTRUCTION.md)** — setup, all test suites, troubleshooting, how to add tests.

`npm test` runs 101 tests against the live Supabase instance. No build step — uses `@supabase/supabase-js` from `node_modules`.

**Required `.env` keys:**
```
TEST_ADMIN_PASSWORD=<password for phamvietdung812020@gmail.com>
SUPABASE_SERVICE_ROLE_KEY=<service role key from Dashboard → Settings → API>
```
Without `SUPABASE_SERVICE_ROLE_KEY`, multi-user tests (approvals, mentions, DMs, groups) are **skipped** (not failed) — single-user tests still run.

**Flags:** `npm test` | `npm run test:stress` | `npm run test:realtime` | `npm run test:all` | `npm run test:clean` | `--verbose`

**Test data isolation:** `[TEST]` prefix on all data. Cleanup runs automatically. Safe against production DB.

**One persistent skip:** "Post workflow run card" — earlier runs were cascade-deleted by template cleanup. Not a bug; rich card path is covered by "Post rich card (payload)". See TEST_INSTRUCTION.md for full explanation.

### 37. `chat_attachments` schema — `uploaded_at`, no `uploaded_by`, no `created_at`

The `chat_attachments` table actual columns (verified in `schema.sql`):
`id, message_id, file_name, file_url, file_type, file_size, extracted_text, uploaded_at`

Two gotchas:
- **No `uploaded_by`** column — uploader identity comes from the joined message's `author_id`. Don't add it to inserts.
- **Timestamp column is `uploaded_at`, NOT `created_at`** — earlier versions of this gotcha incorrectly listed `created_at`. When writing SQL aggregates that need an "event time" for an attachment, prefer `m.created_at` from the joined `chat_messages` row (the values are essentially identical, and `m.created_at` is portable across deployments). Calling `a.created_at` will throw 42703.

PostgREST nested select works: `chat_messages.select('id, attachments:chat_attachments(id, file_name, file_type, file_size, uploaded_at)')`.

### 38. `cron.schedule()` returns the job ID — "Schedule = 1" is normal

The last line of `migration_phase_schedules.sql` is:
```sql
select cron.schedule('run_due_schedules', '* * * * *', $$select public.run_due_schedules();$$);
```

Running this in the SQL Editor returns a single-row result like `Schedule = 1`. This is the **pg_cron job ID** — an integer assigned to the newly registered job. It is **not an error**. `1` means it's the first (or only) cron job in the project.

Verify it's wired correctly:
```sql
select jobid, jobname, schedule, command, active from cron.job;
```

### 39. Project cards — `projectStatusBorderColors` + `creator` join

`Badge.tsx` exports `projectStatusBorderColors: Record<ProjectStatus, string>` for `border-l-4` classes:
```ts
open → 'border-l-neutral-300', in_progress → 'border-l-amber-400',
review → 'border-l-primary-400', completed → 'border-l-green-500', cancelled → 'border-l-red-400'
```

`projectStatusColors` (used by `ProjectStatusBadge`) is intentionally **neutral** — all statuses render `border border-neutral-200 bg-white text-neutral-700`. The colored `border-l-4` strip on the card already communicates status; the badge chip just labels it. Don't add color fills back to the badge.

Kanban column backgrounds (`columnColors`) are all `bg-neutral-50` — no per-status tinting. The cards inside have their own `border-l-4` color strip.

Used in `KanbanBoard.tsx` (card outer div) and `ProjectTable.tsx` (first `<td>`). Both views also show:
- "Cập nhật X ago" relative time via `formatDistanceToNow` from `date-fns` with `vi` locale
- `(i)` info icon → tooltip with creation date + creator name (uses `group/info` named-group pattern for hover)

`Project` interface has `creator?: { full_name: string | null }` (joined from `profiles!created_by`).
`ProjectsPage` query: `.select('*, assignee:profiles!assigned_to(*), creator:profiles!created_by(full_name)')`.

### 40. Scrollable tab bars — `overflow-x-auto scrollbar-none` pattern

Any horizontal tab row that may overflow on mobile needs:
```tsx
<div className="flex overflow-x-auto scrollbar-none border-b border-neutral-100">
  <button className="shrink-0 whitespace-nowrap ...">Tab 1</button>
  ...
</div>
```

Applied in: `LabTab.tsx` sub-tabs, `WorkflowsPage.tsx` section tabs.
`NavTabs.tsx` mobile bottom bar: active tab has a 2px top-line accent (`bg-primary-600 rounded-b-full`) + bolder icon (`strokeWidth 2.2`).

### 29. DM channels — `channel_type` discriminator + `get_or_create_dm_channel` RPC

`chat_channels.channel_type` is `'team' | 'personal' | 'dm'` (default `'team'`). DM channels also have `dm_partner_id uuid`. To open a DM from anywhere in the app:

```ts
const { data: ch } = await supabase.rpc('get_or_create_dm_channel', { partner_id: userId })
navigate(`/chat?dm=${ch.id}&dm_name=${encodeURIComponent(name)}`)
```

`ChatPage` reads the `?dm=` + `?dm_name=` URL params on mount, calls `setActive(...)` for the channel, then clears the URL with `navigate('/chat', { replace: true })`. The DM channels section in the sidebar only renders if `dmChannels.length > 0` (filtered by `channel_type === 'dm'`).

### 41. "Luồng Nghiệp vụ" is the UI name — routes and code stay `/workflows`

All user-visible strings say **"Luồng Nghiệp vụ"** (nav label "Nghiệp vụ", page h1, tab labels). Route is `/workflows`, component is `WorkflowsPage`, files are `WorkflowsPage.tsx`, `WorkflowEditPage.tsx`, etc. Don't rename files or routes.

Sub-tab labels inside WorkflowsPage: `'Mẫu NV'` (templates), `'Của tôi'` (my-runs), `'Của team'` (team-runs), `'Lịch tự động'` (scheduled). Active tab persists to `localStorage` under key `bos_workflows_tab_${user.id}` — restored on mount.

### 42. Pending approval dot — `usePendingApprovalCount` hook

`src/lib/usePendingApprovals.ts` exports `usePendingApprovalCount()` — counts `workflow_step_results WHERE approval_status='pending'`. Refetches every 30 s, gracefully returns `0` on error.

Two consumers:
- **`NavTabs.tsx`**: red dot on the "Nghiệp vụ" sidebar icon (desktop) and mobile bottom tab — same pattern as chat unread dot.
- **`WorkflowsPage.tsx`**: small red dot on the "Của tôi" tab when `pendingApprovals > 0`.

### 43. Workflow step `duration_hours` + progress bars

`workflow_steps.duration_hours` (and `workflow_run_steps.duration_hours`) default to `3` hours. Added via migration #18.

**WorkflowEditPage**: each step shows a `⏱ [X] tiếng` number input (`defaultValue`, `onBlur` → `updateStep`). Default 3, step 0.5.

**WorkflowsPage** has two pure-presentational bar components:
- `StepDurationBar({ steps, className })` — **24h-scaled** segmented bar. `barWidth = (min(total, 24) / 24) * 100%`. Each segment is proportional to its `duration_hours` within the bar. Colors: `STEP_COLORS = ['bg-sky-300','bg-sky-400','bg-sky-200','bg-blue-300','bg-sky-300']`. When `total > 24h`, an `<AlertCircle>` icon appears with a tooltip. Label: **"Thường thực hiện trong X tiếng"**. Only root steps (not branch children) included.
- `ActualTimeBar({ actualHours, expectedHours, className })` — grey bar showing actual elapsed with a vertical expected-marker line. Turns red when `actualHours > expectedHours`. Label shows "Thực tế: X.X tiếng (vượt kế hoạch)" in red.

Template list fetches steps inline: `workflow_templates.select('*, steps:workflow_steps(...)')`. Run list fetches `run_steps:workflow_run_steps(...)` with fallback query if that join fails.

### 44. NotificationBell — fixed anchor, icon style, approval 3-button layout

**Anchor fix**: on desktop the panel is positioned at `left: 60` (48px sidebar slot + 12px gap), computed once when `open` becomes `true`. No longer uses a polling interval to track the expanding sidebar — the interval caused the panel to float mid-screen after the sidebar collapsed.

**Icon style**: `KindIcon` uses `bg-white border border-neutral-200` for all notification types. The icon color (e.g. `text-primary-600`) is preserved; only the colored background tint was removed.

**Approval 3-button layout**: `approval_requested` items render a special non-button `<div>` layout with three inline action buttons instead of the standard click-to-navigate `<button>`:
1. "Xem tại Luồng NV" → `openPanel(run_id, 'workflow_run') + navigate('/workflows')`
2. "Xem tại Tin nhắn" → async: queries `chat_messages WHERE workflow_run_id = run_id ORDER BY created_at ASC LIMIT 1`, opens the panel, navigates to `/chat?ctx_type=...&ctx_id=...&ctx_name=...&msg_id=<msg.id>` — ChatPage picks up `msg_id` and passes it as `scrollToMessageId` to `MessageFeed` for scroll-to + ring highlight. Only shown if `payload.run_id` exists.
3. "Đã đọc" → `markRead(id)` (only shown if `!read_at`)

`notification.payload` for `approval_requested` contains `{ run_id, step_result_id }` (set by the `fan_out_approvals` trigger).

### 45. Scroll-to-message pattern in MessageFeed

`MessageFeed` supports deep-linking to a specific message via `scrollToMessageId?: string` + `onScrolled?: () => void` props. Each message is wrapped in `<div data-msg-id={msg.id}>`. On mount (or when `scrollToMessageId` changes with messages available), a `useEffect` runs:

```ts
const el = document.querySelector(`[data-msg-id="${scrollToMessageId}"]`)
if (el) {
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('ring-2', 'ring-primary-300', 'rounded-lg')
  setTimeout(() => el.classList.remove(...), 2500)
  onScrolled?.()
}
```

The scroll-to-bottom effect (`bottomRef.current?.scrollIntoView`) is suppressed when `scrollToMessageId` is set so they don't fight each other.

`ChatPage` holds `pendingScrollMsgId: string | null` state. Set when `?msg_id=` is present in the URL; cleared on channel switch and when `onScrolled` fires. Passed as `scrollToMessageId={pendingScrollMsgId ?? undefined}`.

### 46. Approver RLS — separate migration required (`migration_phase_approver_rls.sql`)

The base `workflow_step_results` policy (in `schema.sql`) only allows `run_by = auth.uid()` to UPDATE. Non-owner approvers are silently blocked — they see the approval buttons but the PATCH returns no rows updated.

**Fix**: run `migration_phase_approver_rls.sql` (migration #19). It adds four policies:
1. `"Approvers can view assigned runs"` — SELECT on `workflow_runs`
2. `"Approvers can view own run steps"` — SELECT on `workflow_run_steps`
3. `"Approvers can view step results"` — SELECT on `workflow_step_results`
4. `"Approvers can update approval fields"` — UPDATE on `workflow_step_results`

All policies use the same three-clause approver check: `approver_user_id = auth.uid()` OR role-based (`approver_role = 'admin'|'editor'` + profile role match). Use `drop policy if exists` before `create policy` for idempotency (see gotcha #33).

### 52. PWA install + push notifications — full setup checklist

**Install prompt** works automatically once the app is deployed with:
- `vite.config.ts` — `VitePWA` plugin with `generateSW` strategy, `workbox.importScripts: ['/sw-push.js']`
- `index.html` — PWA meta tags (`theme-color`, `apple-mobile-web-app-*`, `apple-touch-icon`)
- `public/icon-192.png` + `public/icon-512.png` — generated by `node scripts/generate-icons.mjs`
- Chrome on Android shows "Add to Home Screen" banner when app is opened twice + HTTPS

**Push notification backend setup (one-time):**

1. **Generate VAPID keys**: `node scripts/generate-vapid-keys.mjs` — copy output to Supabase secrets + `.env`
2. **Supabase secrets** (Dashboard → Project Settings → Edge Functions → Secrets):
   ```
   VAPID_PUBLIC_KEY=...
   VAPID_PRIVATE_KEY=...
   VAPID_SUBJECT=mailto:phamvietdung812020@gmail.com
   ```
3. **Deploy `send-push` edge function**: paste `supabase/functions/send-push/index.ts` into Dashboard → Edge Functions → New function named `send-push`
4. **Enable pg_net**: Dashboard → Database → Extensions → `pg_net` → Enable
5. **Store secrets in Supabase Vault** (SQL Editor — run ONCE per project):
   ```sql
   select vault.create_secret(
     'https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-push',
     'push_edge_url'
   );
   select vault.create_secret('eyJ...YOUR_SERVICE_ROLE_KEY...', 'push_service_key');
   ```
   If vault secrets already exist (23505 duplicate key): use `vault.update_secret()` instead — see gotcha #53.
   `ALTER DATABASE SET` is blocked (42501) on Supabase — do not use it.
6. **Run migration #21**: `migration_phase_push_subscriptions.sql`
7. **Add env var to Vercel**: `VITE_VAPID_PUBLIC_KEY=...` (same as public key above; **NOT** the same as Supabase secrets which are server-side only)

**How it works end-to-end:**
- User visits Settings → Cá nhân → toggles "Thông báo đẩy" → browser permission prompt
- On grant: `pushManager.subscribe()` → subscription saved to `push_subscriptions`
- When any notification is INSERTed (mention, approval, project): `fan_out_push()` trigger fires → `net.http_post` to `send-push` edge function (async, non-blocking)
- Edge function: queries `push_subscriptions` for user_id → calls `webpush.sendNotification()` for each → removes expired/410-Gone subscriptions automatically
- Service worker receives `push` event → shows system notification
- User taps notification → `notificationclick` → opens app, focuses existing tab or opens new window

**Architecture files:**
- `public/sw-push.js` — push/notificationclick event handlers (plain JS, loaded via `importScripts` into Workbox-generated SW)
- `src/lib/usePushSubscription.ts` — React hook (`isSupported`, `permission`, `subscribed`, `subscribe()`, `unsubscribe()`)
- `src/components/settings/PersonalTab.tsx` — toggle UI in Settings → Cá nhân (section only renders when browser supports push + `VITE_VAPID_PUBLIC_KEY` is set)
- `supabase/functions/send-push/index.ts` — Edge Function using `npm:web-push@3.6.7` for VAPID signing + encryption

**If `VITE_VAPID_PUBLIC_KEY` is not set**, the push section simply doesn't render — no crash, no error. The push feature degrades gracefully.

**After regenerating VAPID keys**, users must re-subscribe (old subscriptions used the old public key and will fail silently). Toggle push off then on again in Settings → Cá nhân.

**pg_net `net.http_post` signature**:
```sql
net.http_post(
  url     text,
  headers jsonb default null,
  body    jsonb default null,
  ...
) returns bigint  -- request ID (async)
```
Use `perform net.http_post(...)` to discard the return value in triggers.

### 53. Push notification debugging — common failure modes

**Test insert** (trigger a push manually from SQL Editor):
```sql
insert into public.notifications (user_id, kind, title, body)
values ('<user_id>', 'generic', 'Test push', 'Test body');
```
The `notifications` table has no `metadata` column — omit it.

**Check pg_net outbound requests** (pg_net 0.20.0 column names — no `method`/`url` columns):
```sql
select id, status_code, error_msg, content, created
from net._http_response
order by created desc limit 5;
```
- `status_code 404` + `"NOT_FOUND"` → Edge Function not deployed or wrong name
- `status_code 200` → Edge Function ran; check its logs for push errors
- No new rows → trigger didn't fire (check trigger exists, pg_net extension enabled)

**Check push_subscriptions upsert grant**:
`INSERT ... ON CONFLICT DO UPDATE` (upsert) requires **UPDATE privilege**, not just INSERT. The migration grants `select, insert, update, delete` — if you recreated the table manually, re-run the GRANTs:
```sql
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select, insert, update, delete on public.push_subscriptions to service_role;
```

**VAPID private key format**: `web-push` requires the raw 32-byte EC scalar in base64url, NOT PKCS#8. `scripts/generate-vapid-keys.mjs` uses `exportKey('jwk', ...)` and takes the `d` field. Old versions exported as `pkcs8` — if you see `"Vapid private key should be 32 bytes long"` in Edge Function logs, regenerate with the fixed script and update all three places (Supabase secrets, Vercel env, `.env`).

**Vault secret already exists (23505)**:
```sql
-- Step 1: get IDs
select id, name from vault.decrypted_secrets where name in ('push_edge_url', 'push_service_key');
-- Step 2: update (direct UPDATE on vault.secrets is blocked — use the function)
select vault.update_secret('<id>', 'new-value', 'push_edge_url');
select vault.update_secret('<id>', 'new-value', 'push_service_key');
```
`vault.update_secret()` returns void (blank result = success).

**`usePushSubscription.ts` upsert must include `user_id`**: `push_subscriptions.user_id` is NOT NULL + FK. Always include it:
```ts
const { data: { session } } = await supabase.auth.getSession()
supabase.from('push_subscriptions').upsert(
  { user_id: session.user.id, endpoint, p256dh, auth },
  { onConflict: 'user_id,endpoint' }
)
```

**PostgREST schema cache**: after running migration #21, run `notify pgrst, 'reload schema';` so PostgREST picks up the new table.

### 48. RLS 42P17 infinite recursion — `migration_phase_approver_rls_fix.sql`

After migration #19 adds "Approvers can view assigned runs" on `workflow_runs`, a mutual-dependency cycle forms:

- `workflow_runs` SELECT policy → reads `workflow_run_steps`  
- `workflow_run_steps` SELECT policy → reads `workflow_runs`  

PostgreSQL detects the cycle and throws `42P17: infinite recursion detected in policy for relation "workflow_runs"`. Because the chat messages query does a nested select into `workflow_runs` (via `workflow_run_id`), **the entire MessageFeed query fails and returns empty for ALL users** — not just approvers.

**Fix**: run `migration_phase_approver_rls_fix.sql` (migration #20). It creates two `SECURITY DEFINER` functions that bypass RLS on the table they read, breaking the cycle:

```sql
-- Reads workflow_run_steps without triggering its RLS (security definer)
create or replace function public.auth_is_approver_for_run(p_run_id uuid)
returns boolean language sql stable security definer ...

-- Combines owner + admin/editor + approver checks without re-entering workflow_runs RLS
create or replace function public.auth_can_view_run_steps(p_run_id uuid)
returns boolean language sql stable security definer ...
```

Both functions are granted to `authenticated`. The "Approvers can view assigned runs" policy on `workflow_runs` is rewritten to call `auth_is_approver_for_run(id)`. The snapshot view/manage policies on `workflow_run_steps` are rewritten to call `auth_can_view_run_steps(run_id)`.

**Symptom to diagnose this**: open DevTools Network tab → look for the `chat_messages` PostgREST request → its response body contains `{"code":"42P17","message":"infinite recursion..."}` — the entire request fails, not just the approval-related part.

### 49. `workflow_step_results` correct column names

The actual column names are:
- `note` (NOT `notes`)
- `done_at` (NOT `completed_at`)
- **No `completed_by` column** — uploader identity comes from the run's `run_by`

Using wrong names in INSERT/UPDATE will throw a PostgREST "column does not exist" error. This tripped up the seed script — it was using `notes`, `completed_at`, `completed_by` which all fail.

Correct insert pattern:
```js
await svc.from('workflow_step_results').insert({
  run_id:      run.id,
  step_id:     s.source_step_id,
  snapshot_id: s.id,
  is_done:     true,
  done_at:     new Date().toISOString(),  // correct
  note:        null,                       // correct (not 'notes')
  // NO completed_by — column doesn't exist
})
```

### 50. Demo seed script — `seed_demo_grants.sql` must run first

`scripts/seed-demo.mjs` seeds the full Minh Phúc company demo dataset (25 users, 6 groups, 7 channels, 4 projects, 8 form templates, 8 workflow templates, workflow runs, messages). It uses the **service_role key** for all table operations (bypasses RLS).

**Before first run, execute `supabase/seed_demo_grants.sql` once in the SQL Editor.** It grants `SELECT, INSERT, UPDATE, DELETE` on 13 core tables to `service_role`. Without it, every insert returns "permission denied for table X" even though service_role bypasses RLS — table-level GRANT and RLS are separate (see gotcha #6).

```
npm run seed:demo
```

Required `.env`:
```
VITE_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```
The script does NOT need `SUPABASE_ANON_KEY` or user credentials — all ops go through service_role.

The `seedChannel()` helper in the script is **idempotent**: it only inserts messages if the channel currently has 0 messages, so re-running seed won't duplicate messages in already-seeded channels.

### 51. `cleanup_test_data.sql` — FK chain for form_templates deletion

`form_submissions.template_id` references `form_templates(id)` with **no ON DELETE CASCADE**. Similarly, `workflow_step_results.form_submission_id` and `chat_messages.form_submission_id` reference `form_submissions`. Trying to `DELETE FROM form_templates WHERE name ilike '%[TEST]%'` directly throws:

```
ERROR: 23503: update or delete on table "form_templates" violates foreign key constraint
"form_submissions_template_id_fkey" on table "form_submissions"
```

The correct cleanup order (already reflected in `supabase/cleanup_test_data.sql` step 3):
1. Null out `workflow_step_results.form_submission_id` for [TEST] submissions
2. Null out `chat_messages.form_submission_id` for [TEST] submissions
3. Delete `form_submissions` where `template_id IN (SELECT id FROM form_templates WHERE name ilike '%[TEST]%')`
4. Delete `form_templates WHERE name ilike '%[TEST]%'`

`workflow_schedules.project_id` also has **no ON DELETE CASCADE** — if deleting production projects that have workflow schedules attached, delete the schedules first. For `[TEST]` projects this is not an issue (test runner doesn't create schedules linked to test projects).

### 47. Chat sidebar section names and channel avatar chips

Section titles: **"Kênh"** (team channels), **"Tin nhắn riêng"** (DM channels), **"Tin nhắn theo dự án"** (project threads). No `#` prefix on channel names.

Team channels show a `MemberAvatarStack` component (defined in `ChatPage.tsx`) as the `icon` prop on `SidebarItem`. It queries all `profiles` (key `['all-profiles-brief']`, 5-minute stale time) and shows the first 2 alphabetically as 16×16 overlapping avatar chips with 2-letter initials, plus "+N" for the rest. There is no `chat_channel_members` table — all team channels are accessible to all authenticated users, so the stack always shows all members.

### 54. Form fill rules + progressive submission row

`FormField` (in `src/types/index.ts`) carries 4 optional Phase-D fields — all stored inline in `form_templates.fields` jsonb (no schema migration for the field shape):

- `fill_at_step_id?: string | null` — workflow_step.id (template-level) responsible for filling this field. `null` = the step the form is attached to.
- `fill_by_role?: 'runner' | 'approver' | 'specific_user' | null` — defaults to `runner`.
- `fill_by_user_id?: string | null` — when role = specific_user.
- `inherited_from_field_id?: string | null` — lineage marker when the field was cloned via "Inherit form" (advisory only — no enforcement).

**One submission row per (run × template).** Migration #22 adds a unique partial index `uniq_form_submission_per_run` on `form_submissions(context_id, template_id) WHERE context_type='workflow_run'`. `StepFormModal.submit()` looks up the existing row first; if found, UPDATE-merges the `data` jsonb. Otherwise INSERT. The audit column `last_updated_by_step_id` records which run-step last wrote.

**Critical: hidden + readonly fields are EXCLUDED from the materialized payload** in `submit()`. Otherwise a later step's submission would blank out fields filled by earlier steps. The exclusion uses `computeFieldMode()` from `FormFields.tsx` against the current `runContext`.

**Runtime gating** (`FormFields.tsx` + `StepFormModal.tsx`): `computeFieldMode(field, runContext, value)` returns:
- `editable` — this step + this user is allowed.
- `readonly` — different step's responsibility but a value already exists → show disabled.
- `hidden` — different step's responsibility AND no value yet → skip render entirely.

When opened standalone (Settings → Lab → Forms tab), no `runContext` is passed — gating is skipped, all fields editable.

**Approval gate** (`gateApproveOnApproverFields()` in `WorkflowRunPanel.tsx`): before approver clicks Duyệt, looks up the form submission for this step's template, collects required `fill_by_role='approver'` fields with empty values. If non-empty, blocks with toast and re-opens form modal in approver-edit mode (only approver fields editable per `runContext.isApprover=true`).

**Snapshot/legacy step ID mismatch**: `field.fill_at_step_id` is always a template-level `workflow_steps.id`. In snapshot-mode runs, the runtime step ids are snapshot ids — use `templateStepIdOf(step)` helper which reads from `sourceStepMap` (snapshot id → source_step_id). Legacy mode: step.id IS the template id.

### 55. WorkflowEditPage dual-panel structure (Phase 3 + Phase B refactor)

The page is an orchestrator. The original 858-line monolith was split into 7 files under `src/components/workflow-edit/`:
- `types.ts` — `StepDraft` + `blankStep()`
- `stepTree.ts` — `dfsOrdered` (depth-first traversal helper)
- `WorkflowMetaPanel.tsx` — name + description (left top, compact)
- `WorkflowFlowPanel.tsx` — React Flow canvas (left main) + collapsible "Quyền chạy" header
- `StepNode.tsx` — custom React Flow node component
- `StepDetailPanel.tsx` — full step editor (right)
- `StepApprovalSection.tsx` + `StepFormSection.tsx` — sub-sections of detail
- `InheritFormModal.tsx` — blank-vs-inherit chooser before TemplateEditor

**Visualization**: powered by **`@xyflow/react`** (React Flow v12) + **`@dagrejs/dagre`** for top-down auto-layout. Read-only canvas (`nodesDraggable={false}`, `nodesConnectable={false}`); pan + zoom enabled. Edges show `branch_condition` as labeled pills when the parent step is a branch. The library is lazy-loaded inside the WorkflowEditPage chunk (~78 KB gzipped, only fetched when the editor opens). The earlier text-tree (`├─ └─` rails via `buildTree()`) was removed in Phase B.

**Layout**: top-down (`rankdir: 'TB'`, `nodesep: 24`, `ranksep: 36`). `layoutTree()` is idempotent — re-runs whenever `steps` or `selectedStepId` change.

**Quyền chạy** (template access) lives at the top of `WorkflowFlowPanel` as a collapsible `<details>` block (folded by default, summary shows "X/Y nhóm" or "Mở cho mọi thành viên"). Removed from `WorkflowMetaPanel` to declutter.

**Mobile**: single-column with `useState<'tree'|'detail'>`. Selecting a step auto-switches to detail; back chevron returns. Desktop always shows both via `md:grid-cols-[368px_1fr]` (was 320 — bumped 15% per user feedback).

**Save flow unchanged** — single explicit Save button (no autosave per user direction). All step CRUD callbacks (`addRootStep`, `addChildStep`, `updateStep`, `removeStep`) live in the orchestrator; panels are dumb.

**Form creation** goes through 2 stages: (1) `InheritFormModal` to pick blank or inherit; (2) `TemplateEditor` modal pre-populated. When inheriting, fields are deep-cloned with fresh `id`, `inherited_from_field_id` lineage, and `fill_at_step_id` defaulted to the source step's draft id. The save flow's idMap maps draft ids → db ids on insert.

### 56. Run progress bar — colour mapping + per-step responsibility lines

`RunProgressBar.tsx` (in `src/components/workflow/`) is a status-coloured segmented bar. Used in `WorkflowsPage` "Của tôi" / "Của team" run cards AND in `WorkflowRunPanel` header.

**Inputs**: `steps[]` (`workflow_run_steps` rows) + `results[]` (`workflow_step_results` rows) + `runStatus`.

**Status → colour**:
- `is_done && (!requires_approval || approval_status==='approved')` → green (`--color-success`)
- `approval_status==='pending'` OR current-not-yet-done step → orange (`--color-warning`)
- `approval_status==='rejected'` → red (`--color-danger`)
- run cancelled/failed → incomplete segments turn red
- future step → neutral (`#E4E4E3`)

Segments sized proportionally by `duration_hours`. Only root steps included (branches collapse into parent for high-level progress).

**WorkflowsPage query enhancement**: the `my-workflow-runs` query now selects nested `step_results:workflow_step_results(snapshot_id, step_id, is_done, approval_status)` alongside `run_steps`. Falls back gracefully on error.

**WorkflowRunPanel** per-step body now shows two responsibility lines below the title:
- `👤 Người chạy: {run.runner.full_name}` (always)
- `🛡 Người duyệt: {approverName}` (only when `step.requires_approval`)

`approverName` resolves via `approverNameById` map populated by `useQuery(['approvers-for-run', ...])` over `step.approver_user_id`. Role-based fallback: `'admin'` → "Tất cả Admin", `'editor'` → "Tất cả Editor".

**Header**: shows "Chạy bởi: X · Bắt đầu: Y · Bước hiện tại: Z" + the new `RunProgressBar` (replaces the old single-colour `bg-primary-500` bar).

### 57. Workflow editor — left/right column redesign (round 3)

The editor is now organised as:
- **Left column** (368px desktop, slide-over on mobile): Meta (name + description) → `WorkflowAccessSection` (collapsible "Quyền chạy") → `WorkflowGuidanceEditor` (rich-text long-form notes; saves to `workflow_templates.guidance_html`).
- **Right column** (flex-1): `ResizableVerticalSplit` with the React Flow canvas on top (~25% by default) and the `StepDetailPanel` on the bottom (~75%). The split position persists per-user via localStorage key `bos_workflow_edit_split_top_px`.

`ResizableVerticalSplit` is a hand-rolled component (no library) — pointer-capture drag handle with min/max clamp and rAF-debounced persistence. ~85 lines.

`workflow_templates.guidance_html` was added by **migration #23** (`migration_phase_workflow_guidance.sql`). Round-trips through standard CRUD; nullable; HTML produced by `RichTextEditor`.

The mobile layout no longer toggles tree↔detail (the `mobileView` state was removed). On mobile, the right column always shows the split (visual + detail). The left column opens as a slide-over via the panel-left button in the header.

### 58. Project code + activity feed (round 3)

**`projects.code`** (text, unique partial index, max 10 chars) is auto-generated on insert by `_projects_fill_code` trigger:
- Format: `D` + `YYMMDD` (e.g. `D260418` for 2026-04-18). 7 chars baseline.
- Collision suffix: `A`–`Z`, then `1`–`9` (35 alternates per day). Then random 2-char hex.
- Backfilled on existing rows from `created_at::date` at migration time.
- Editable later — must remain unique.

**`project_status_history`** is a write-only audit table (no UI for editing). Trigger `_projects_log_status` writes a row on every INSERT (`old_status=null` → "Tạo dự án") and on UPDATE-of-status. Initial rows backfilled.

**`get_project_activity_feed(p_project_id uuid default null, p_limit int default 30)`** RPC unions 7 event sources:
1. `workflow_started` / `workflow_completed` / `workflow_cancelled` (from `workflow_runs`)
2. `chat_message` (from `chat_messages` where `context_type='project'`)
3. `file_upload` (from `chat_attachments` joined to messages)
4. `form_submission` (from `form_submissions` where `context_type='project'` — workflow-run forms are covered by the workflow events)
5. `project_created` / `project_status_changed` (from `project_status_history`)

`security definer` so the RPC sees all the underlying tables regardless of caller's RLS. Returns columns matching the `ProjectActivityEntry` TS type. Ordered by `created_at desc`.

**Click routing** in `ProjectActivityFeed.tsx`:
- `target_chat_message_id` → `/chat?ctx_type=project&ctx_id=...&msg_id=...` (deep-link with scroll-to-message)
- `target_workflow_run_id` → `openPanel({kind: 'workflow_run'})` + navigate to project
- `target_form_submission_id` → `openPanel({kind: 'submission_view'})`
- Otherwise → navigate to project detail

**Form submissions context_type CHECK** was relaxed in migration #24 to allow `'workflow_run'` (introduced by migration #22 progressive fill but never enforced — the CHECK constraint would have rejected workflow-run UPSERTs).

### 59. Customer portal moved to a tab + info cards

The customer-portal credential management was extracted from `ProjectDetailPage` into `CustomerPortalCard.tsx` and moved from the right info pane into a dedicated `'portal'` tab (Cổng KH) beside Tài liệu. Right info pane below project info now hosts `<ProjectActivityFeed projectId={...} />` instead.

The `'portal'` tab is **admin/editor only** (filtered via `canEdit` in the tab list).

`CustomerPortalTab.tsx` shows three sections:
1. The portal credentials card (existing functionality — toggle, username, password, copy URL)
2. Related workflows status — high-level overview only (template name, runner, status chip). **Internal step details are not shown here** to avoid leaking sensitive chat content.
3. Internal info cards (`project_info_cards` table, migration #25) — staff-only rich-text annotations. Read by all authenticated users; write/delete by author or admin/editor (RLS).

Info cards are NEVER exposed to the public `PortalPage` — they're staff-internal annotations only. Make sure not to query `project_info_cards` from any customer-facing route.

### 60. Rename "Workflow" → "Nghiệp vụ" + verb form "Run" → "Chạy" (round 3)

UI strings only — routes (`/workflows`), file paths, and code identifiers (`WorkflowEditPage`, `useProjectActivityFeed`) stay as-is.

Verb form: when used as a verb (start, run, cancel a workflow), Vietnamese label is **"Chạy"** (e.g. "Chạy nghiệp vụ", "+ Chạy nghiệp vụ mới"). Noun form: a workflow / workflow runs are called **"Nghiệp vụ"** (e.g. "1 nghiệp vụ đang chạy", tab "Của tôi"/"Của team" stay as-is — no "run" word).

Page title `"Luồng Nghiệp vụ"` (the workflows page) and `"Mẫu NV"` (templates) were already renamed in earlier sessions. Round 3 swept the remaining UI strings:
- "Workflow run" / "Run a workflow" → "Nghiệp vụ" / "Chạy nghiệp vụ"
- "Workflow template" → "Mẫu nghiệp vụ"
- "Bước workflow" → "Bước nghiệp vụ"
- ProjectDetailPage tab `"Workflows"` → `"Nghiệp vụ"` (via `TAB_LABELS` map)

Don't introduce English labels for these concepts going forward.

### 61. `public.profiles` schema — there is NO `email` column

`public.profiles` columns (verified): `id, full_name, role, preferences, created_at, updated_at` (+ optional avatar fields). The user's email lives in `auth.users.email`, NOT `profiles.email`.

A common pitfall when writing aggregating RPCs: `coalesce(p.full_name, p.email) as user_name`. This throws `42703: column p.email does not exist`. Use `p.full_name` directly (or join `auth.users` if you genuinely need email — but typically `full_name` is enough for display).

If you need a fallback when `full_name` is null, use `coalesce(p.full_name, '—')`.

### 62. React Flow visuals — Handle defaults + global CSS overrides

The workflow editor canvas (`WorkflowFlowPanel`) uses `@xyflow/react` v12. Custom inline styles on `<Handle>` components can subtly break edge endpoint resolution — leaving nodes visible but edges invisible. The proven pattern:

1. **Inside the custom node component (`StepNode.tsx`)**: use plain default `<Handle>` with NO inline style:
   ```tsx
   <Handle type="target" position={Position.Top}    isConnectable={false} />
   <Handle type="source" position={Position.Bottom} isConnectable={false} />
   ```

2. **Global CSS in `src/index.css`**: override visuals via the React Flow class selectors with `!important` so they win over both Tailwind preflight and the lib's own stylesheet (load-order-safe):
   ```css
   .react-flow__handle {
     width: 7px !important; height: 7px !important;
     background: #BCBCBC !important; border: 1.5px solid #FDFDFC !important;
     border-radius: 9999px !important;
   }
   .react-flow__edge-path { stroke: #6F6F6E; stroke-width: 1.6; }
   .react-flow__arrowhead path { fill: #6F6F6E; }
   .react-flow__edge-textbg  { fill: #FEF3C7; }
   .react-flow__edge-text    { font-size: 10px; font-weight: 600; fill: #92918D; }
   ```

3. **`defaultEdgeOptions`** on `<ReactFlow>` ensures any new edge inherits the same look:
   ```tsx
   defaultEdgeOptions={{
     type: 'smoothstep',
     style: { stroke: '#6F6F6E', strokeWidth: 1.6 },
     markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#6F6F6E' },
   }}
   ```

After deploying React Flow changes, **hard-refresh** the browser (`Ctrl+Shift+R`) to bust the PWA service-worker cache — otherwise the old chunk lingers and the user sees stale rendering.

### 63. Workflow editor — quick-collapse the visual map

`WorkflowFlowPanel` accepts `collapsed?: boolean` + `onToggleCollapse?: () => void`. Toolbar shows a chevron button (`ChevronUp` to collapse, `ChevronDown` to expand). When collapsed: the canvas + branch popover hide; only the header strip renders.

`WorkflowEditPage` holds `flowCollapsed` state, persisted to `localStorage` under `bos_workflow_edit_flow_collapsed`. When `true`, the right column skips `ResizableVerticalSplit` and renders just the header strip + `StepDetailPanel` at full height. When `false`, normal split. Toggling preserves the user's split height (separate localStorage key `bos_workflow_edit_split_top_px`).

### 64. Workflow editor — interactive flow builder + branch diamond + S/F codes (round 5)

The flow canvas is a true visual builder. Six interlocking pieces:

1. **Two node types** — `simple: StepNode` (pill) + `branch: BranchNode` (diamond). Registered in `WorkflowFlowPanel.NODE_TYPES`. Each step's `step_type` selects the type. Branch source handles are laid out per `branch_option`, each with `id = option name` so connecting anchors the right `branch_condition`.

2. **S{N} + F{N} short codes** — `src/components/workflow-edit/codes.ts` exports `deriveCodes(steps)` returning `{ stepCode, formCode, stepIdByCode, formIdByCode }`. Codes are pure-derived in DFS order each render — no DB column. Appear on canvas chips, in `StepDetailPanel` header, in form subtitles, and as the addressing convention for AI patches.

3. **Edge-mode toggle** — `WorkflowFlowPanel` owns `editMode` state persisted to `localStorage` under `bos_workflow_edit_flow_edit_mode`. Default = view (clean). Toggle button shows Pencil → Eye. Edit mode unlocks: draggable, connectable, `+ Bước`, `+ Rẽ nhánh`, `Xoá`, branch popover, edge context menu.

4. **1-outgoing rule for simple steps** — `connectSteps()` in `WorkflowEditPage` rejects a connect attempt if `source.step_type === 'simple'` AND a step with `parent_step_id === source.id` already exists. Toast: `"Bước đơn giản chỉ được nối tới 1 đích — xoá kết nối hiện tại trước."` Branches naturally fan out (one source handle per option).

5. **Edge right-click context menu** — `EdgeContextMenu` (floating popover, click-outside + Esc closes). Triggered by `onEdgeContextMenu` in edit mode only. Calls `onDisconnect(edge.target)` → clears `parent_step_id`. Backspace/Delete still works as a power-user shortcut.

6. **Ephemeral positions** — `StepDraft.position_x` / `position_y` materialised at hydrate time via `applyInitialLayout(steps)` (DFS y-stack with depth-indent). Drag-stop persists to draft state. NOT saved to DB; the graph (`parent_step_id` + `branch_condition`) is the source of truth — re-load applies the layout fresh.

### 65. Form-fill responsibility map + cross-step inheritance visualisation (round 5)

`StepFormFullPreview` renders inside `StepFormSection` whenever a form is attached. From the **current step's** perspective, every form field shows a status chip:

- **Filled at S{N}** — `field.fill_at_step_id` matches an ancestor of the current step → green check + neutral chip.
- **S{N} — bước này điền** — matches the current step → primary tint.
- **Sẽ điền tại S{N}** — matches a downstream/unrelated step → amber.
- **Chưa gán bước** — `fill_at_step_id` is null → grey, with an inline picker.

Each row is clickable → tiny inline editor reassigns `fill_at_step_id`, persisted via a single `UPDATE` on `form_templates.fields` jsonb (then `qc.invalidateQueries(['form-templates'])`). Hovering a row dispatches `onHoverSteps([id])`; the panel chain propagates up to `WorkflowEditPage.highlightedStepIds`, which `WorkflowFlowPanel` reads and applies as `className="bos-flow-highlighted"` on the React Flow node. CSS rule in `index.css`: `outline: 2px dashed #C8954A`.

**ID matching caveat**: `fill_at_step_id` may be either a draft client UUID (for newly-inherited forms — see `InheritFormModal`) OR a `workflow_steps.id` (for existing templates loaded from DB). The component matches both via `s.id === id || s.db_id === id`. The inline picker writes back `step.db_id ?? step.id` so existing templates round-trip correctly. Brand-new (unsaved) workflows write client UUIDs into the shared `form_templates.fields` — known limitation; don't share forms across workflows for new templates until you save once. (Carry-over from gotcha #54.)

### 66. AI workflow assistant — edge function + structured output (round 5)

Natural-language workflow design, addressed entirely by S/F codes (no raw uuids cross the boundary).

**Schema** (`src/lib/workflowAISchema.ts`): `AIWorkflowPatch` discriminated by `mode: 'replace_all' | 'incremental'`, with `template_meta`, `add_steps[]`, `modify_steps[]`, `remove_step_codes[]`. Add-steps reference parents via `{ kind: 'root' | 'code' | 's_code', value? }` — `code` for forward refs to other new steps, `s_code` for existing steps. Hand-rolled validator returns `{ ok }` or `{ error }`; both client AND server validate.

**Edge function** (`supabase/functions/workflow-ai/index.ts`): Deno + Anthropic API (mirrors `personal-bot`). System prompt instructs JSON-only output following the schema. The function re-implements the validator server-side — a malformed LLM response surfaces as a 400 here, not a runtime crash in the apply path. Read-only (no DB writes). Setup:
1. `LLM_API_KEY` already in Edge Function secrets (gotcha #13 — shared with `chat-helper` / `personal-bot`).
2. Deploy via Supabase Dashboard: paste `index.ts` into a new function named `workflow-ai`.
3. No DB migration. No grants change.

**Modal** (`WorkflowAIAssistantModal`): 4 stages — prompt, loading, preview (human-readable diff using S/F codes), error. Apply button mutates the editor's in-memory draft only; user still presses **Lưu nghiệp vụ** to commit.

**Apply path** (`WorkflowEditPage.applyAIPatch`):
1. Pre-validates that every referenced `S{N}` (in modify_steps and remove_step_codes) exists in current `deriveCodes(steps)`. Aborts with toast `"Patch tham chiếu bước không tồn tại: S99"` if not.
2. Removes (with descendants), then `replace_all` wipe (if applicable), then `modify_steps`, then `add_steps` via topological pass (forward client-id refs are supported — loop until all resolvable adds are placed; bails if a cycle remains).
3. `attach_form_code` resolves via `currentCodes.formIdByCode[a.attach_form_code]`; unknown codes are dropped + logged. AI cannot create new forms in v1.
4. `applyInitialLayout(next)` re-materialises positions so the canvas reads cleanly.
5. `template_meta` writes happen as a separate setState batch.
6. Toast: `"Đã áp dụng. Bấm Lưu nghiệp vụ để ghi vào DB."`

If the user presses Apply on a `replace_all` patch, the previously-selected step ID becomes dangling — `selectedStep` memo returns null and the detail panel shows the empty-state hint. Acceptable.

### 67. Branch config + show_when condition expressions (round-5b)

Round-5b reshapes branches into pure routers + introduces a unified condition-expression model used by both the branch panel and the per-step "Hiện khi" picker. Stored via migration #26 in two new jsonb columns on `workflow_steps` (and the snapshot copy on `workflow_run_steps`):

```ts
// src/components/workflow-edit/types.ts
type ConditionOperator = '=' | '!=' | '>' | '<' | '>=' | '<=' | 'contains'

interface ConditionCase {
  id: string                                    // ui-stable, NOT a db row
  label: string                                 // edge label / chip
  operator: ConditionOperator
  value: string                                 // compared against source data
}

interface BranchConfig {
  source_kind: 'outcome' | 'field'
  source_step_id: string | null
  source_field_id: string | null
  cases: ConditionCase[]
}

interface ShowWhen {
  source_kind: 'outcome' | 'field'
  source_step_id: string | null
  source_field_id: string | null
  operator: ConditionOperator
  value: string
}
```

**Key constraints**:
- A branch's cases all share the same `(source_step_id, source_kind, source_field_id)` — the branch is a switch on one expression. One operator/value per case.
- For `source_kind = 'outcome'`, operators are restricted to `=` / `!=` and the value comes from `source_step.branch_options` (legacy enum-like shape).
- For `source_kind = 'field'`, the source step must have a form attached; the field id refers to `form_template.fields[*].id`. All 7 operators allowed.
- Branch is a router, not a step: the detail panel hides form/approval/duration sections when `step_type='branch'`.

**Shared component** `ConditionExpression` (`src/components/workflow-edit/ConditionExpression.tsx`) is used in two places with different semantics via the `pinnedSource` + `hideKindToggle` props:
- "Hiện khi": full picker (source step + kind + field + operator + value).
- Branch case rows: only operator + value (source is pinned at the branch level).

**Save flow** (in `WorkflowEditPage.save`): the new fields are conditionally spread into the `workflow_steps` insert payload — only included when non-null — so users without migration #26 applied can still save legacy templates. Once they touch `branch_config` / `show_when`, the migration is required or PostgREST returns 400 on the unknown column.

**Mirroring legacy fields**: when the user edits via the new UI, the panel ALSO writes back to the legacy `branch_options[]` / `condition_step_id` / `condition_value` columns (mirror of label-only outcome equality), so the existing `WorkflowRunPanel` runtime keeps working without a port. The runtime evaluator for the richer expressions is a future commit.

### 69. AI workflow assistant v3 — conversational split-panel + sandbox draft + per-stage save (round 7)

The AI assistant evolves from a one-shot prompt+preview+apply flow (round 6) into a continuous chat. Key shape:

- **Modal layout = 2 panels**: chat (left) + draft preview list (right). Stage breadcrumb on top: `●Khung → ○S1 → ○S2 → ○Review`.
- **Sandbox draft**: every AI patch mutates a LOCAL draft (`StepDraft[]` deep-copied from editor's `steps[]` at modal open). The editor's main canvas does NOT update until the user clicks "Lưu" for that stage.
- **Form-op queue**: `add_forms[]` and `modify_forms[]` from each AI patch are accumulated into `pendingFormOps` (NOT committed to DB). On stage save, `commitDraftToEditor` flushes them in one batch.
- **Undo stack** of max 3: each AI exchange pushes `(draft, formOps)` pre-state. Undo restores the snapshot but keeps the chat thread.
- **Per-stage save**: clicking "Lưu khung" / "Lưu chi tiết S1" → `commitDraftToEditor` runs form CRUD → sets editor `steps[]` → clears undo + form-op queue + chat → advances to next stage (DFS-ordered: skeleton → S1 → S2 → ... → review).
- **Stage advancement**: auto via `nextStage(curr, draft)`. "Bỏ qua" skips. Review is terminal — clicking "Hoàn tất" closes the modal.
- **Conversation history** still persisted in `workflow_ai_conversations` (round 6); shown collapsibly at top of modal.

Files involved:
- `src/components/workflow-edit/applyAIPatchToDraft.ts` — pure `applyPatchToDraft(draft, patch)` + `commitDraftToEditor(draft, formOps, supabase, qc, codes)` async committer. The page no longer owns an `applyAIPatch` function.
- `src/components/workflow-edit/WorkflowAIAssistantModal.tsx` — fully rewritten. Owns sandbox state.
- `src/pages/WorkflowEditPage.tsx` — passes `onCommitDraft={(next) => setSteps(applyInitialLayout(next))}` to the modal.

NEW_F{N} sentinel: while the draft is in sandbox, an attached "yet-to-be-created" form is stored as `form_template_id = "__NEW_F_CODE__NEW_F1"`. `commitDraftToEditor` resolves these to real uuids after INSERTing the forms.

### 68. AI workflow assistant v2 — multi-stage wizard + form intelligence + conversation memory (round 6)

The AI assistant evolves from a single-shot patch generator into a multi-stage wizard that progressively fills in workflow detail. Three stages:

1. **Skeleton** — high-level structure (steps + branches). Existing v1 behaviour.
2. **Details** — per-step substance (description, duration, approval, helper, form attachment). Can target a single S{N} via `focus_step_s_code`.
3. **Review** — AI summarises the workflow + flags missing config; output is `{ rationale, suggestions[] }` (NOT a patch).

**Conversation memory** — every (user, assistant) turn is appended to `workflow_ai_conversations.messages` (one row per `template_id`, trimmed to last 50). Modal queries this on open and shows a collapsible "Lịch sử với AI" panel + injects last 10 turns into the next request as context.

**Form intelligence** — the request payload includes `current_forms_with_codes_full` (full field listing of every existing form). The Details-stage system prompt enforces a reuse-first policy:
- ≥80% match → attach existing F{N} via `attach_form_code`.
- 50-80% match → use `modify_forms[]` to add missing fields, then attach.
- <50% match → use `add_forms[]` with NEW_F{N} code.

**Schema additions** in `src/lib/workflowAISchema.ts`:
- `AIField` — label/type/required/options/description (9 field types).
- `AIAddForm` — `{ code, name, description?, fields[] }` referenced by `attach_form_code`.
- `AIModifyForm` — `{ f_code, add_fields?, modify_fields?, remove_field_ids? }`.
- Both validated client AND server side.

**Apply path** (`WorkflowEditPage.applyAIPatch`):
- Now async — runs form CRUD BEFORE step mutation:
  1. INSERT each `add_forms[]` into `form_templates`, build `newFormCodeToId` map (NEW_F1 → uuid).
  2. For each `modify_forms[]`: read fields jsonb → merge add/modify/remove → UPDATE.
  3. Then setSteps: `attach_form_code` resolves via `resolveFormCode(code)` which checks `newFormCodeToId` first, falls back to `currentCodes.formIdByCode`.
- Pre-validation: rejects patches with unknown S{N} / F{N} refs or duplicate `add_forms[].code` BEFORE any DB write.
- Invalidates `form-templates` queries after CRUD so the UI sees the changes.

**Modal entry points**:
- "✨ Trợ lý AI" button in `WorkflowEditPage` header → opens at the inferred initial stage (no steps → skeleton; incomplete steps → details; all-filled → review).
- Sparkles icon in `StepDetailPanel` header → opens directly at Details stage with that step pre-selected (`initialFocusSCode`).

**Setup checklist**:
1. Run migration #27 (`migration_phase_ai_conversation.sql`).
2. Re-deploy `workflow-ai` edge function with v2 code (`supabase/functions/workflow-ai/index.ts`).
3. `LLM_API_KEY` already set (gotcha #13). No new grants — function uses `SUPABASE_SERVICE_ROLE_KEY` to write conversation rows.

**Edge function input schema extensions** (full request shape):
```ts
{
  user_prompt: string,
  stage: 'skeleton' | 'details' | 'review',
  focus_step_s_code?: string,
  template_id?: string,                    // for conversation persistence
  current_template?: { ... },
  current_steps_with_codes?: [...],         // includes description + duration_hours + attached_form_code
  current_forms_with_codes_full?: [...],    // FULL field listing — drives reuse decisions
  conversation_history?: [...]              // last 10 turns
}
```

**Response shape**:
```ts
{
  patch?: AIWorkflowPatch,                  // for skeleton + details
  summary?: { rationale, suggestions[] },   // for review
  next_suggestion?: string,                 // hint for the modal's auto-advance
  raw_response: string
}
```

### 78. AI workflow assistant — ARCHIVED (round-9 follow-up)

The round-7 conversational AI assistant for the workflow editor (`WorkflowAIAssistantModal`) was archived behind a feature flag in late round-9. User feedback: hard to use + output not reliable enough for production. The whole feature is **kept on disk** — modal, edge function (`supabase/functions/workflow-ai/index.ts`), conversation history (`workflow_ai_conversations` table from migration #27), apply helpers (`applyAIPatchToDraft.ts`), schema/validator (`src/lib/workflowAISchema.ts`). It just isn't reachable from the UI.

Flag location: **`src/lib/featureFlags.ts`**

```ts
export const AI_WORKFLOW_ASSISTANT_ENABLED = false
```

Three UI gates touch this flag — flip to `true` and the feature is fully back:

1. `WorkflowEditPage` header "✨ Trợ lý AI" button (line ~643).
2. `WorkflowEditPage` props passed to StepDetailPanel — `onOpenAIForStep` is `undefined` when the flag is off, which hides the per-step Sparkles AI shortcut entirely.
3. `WorkflowEditPage` mount of `<WorkflowAIAssistantModal>` itself — wrapped in `{AI_WORKFLOW_ASSISTANT_ENABLED && (...)}` so the component never mounts when off (no event listeners, no localStorage autosave, no edge-function calls — totally inert).

The edge function deployment + the `workflow_ai_conversations` migration #27 are NOT rolled back. Existing conversation rows persist; new rows simply stop accumulating. If reactivating later: just flip the flag — no migration, no redeploy. If we decide to delete-permanently instead: drop the modal file, the helpers, the edge function, and migration #27's table. For now: archived, not deleted.

This is the **first archived feature** in the codebase. The pattern (single-file `featureFlags.ts` with named constants + named imports at every gate) is the convention to follow if anything else gets archived later — one boolean, one module, no scattered env vars or context wrapping.

### 77. Quick Tasks + chat threading + @group mentions + message search (round-9)

The chat side of the app gained five things in one round:

1. **DM display name** — DM channels now render the partner's `full_name` + avatar
   initials in the sidebar instead of the literal `"DM"` (which was just the
   value of `chat_channels.name`). Lookup uses the existing `allMembers` query
   in `ChatPage.tsx`; render is a circular `bg-primary-100` avatar chip with
   1-2 initials (Vietnamese name convention: last 1-2 words).

2. **Message search** — `src/lib/searchMessages.ts` is a thin ilike on
   `chat_messages.content`. Two consumers:
   - `GlobalSearchBox` at top of `/chat` sidebar — searches across all
     visible channels/projects/DMs (RLS gates).
   - `ChannelSearchBox` (magnifier icon next to "Làm mới" in MessageFeed
     header) — same backend, scoped via `contextId`.
   - Click any hit → reuses the existing scroll-to-message infra (gotcha
     #45). Global hits navigate first via `setActive(...)` + set
     `pendingScrollMsgId`; channel hits set a local `localScrollMsgId` in
     MessageFeed to scroll-in-place.
   - Note: `chat_messages.context_id` is **polymorphic** (channel id OR
     project id, no FK declared). PostgREST nested joins via `!context_id`
     do NOT work. Helper does a 2-pass fetch: messages first, then batch
     `chat_channels` + `projects` lookups by id type.

3. **Threaded replies UI** — schema's `parent_id` already existed; just had
   no UI. Hover any non-bot message → "Trả lời" icon next to the reactions
   row. Click → `ChatPage` sets `replyingToMsg` state → `MessageInput`
   renders a chip "↩ Trả lời X: <preview>" + posts with `parent_id` set on
   send. MessageFeed shows a "X câu trả lời" badge below the parent that
   opens a `ThreadPanel` side-panel (new `PanelKind = 'thread'`).
   ThreadPanel queries `parent_id = parentId` and offers its own input that
   always posts with that `parent_id`.

4. **@all + @group mentions** — typing `@` in MessageInput now surfaces:
   - `@all` (channel context only — not DMs / personal) — fan-out to all
     channel members. For private channels (gotcha #70), restricted to
     `chat_channel_members`; otherwise all profiles.
   - `@<groupname>` for each `user_groups` row — fan-out to all members of
     that group via `user_group_members`.
   - Resolution happens **client-side at send time** (not in the trigger).
     `expandGroupMarkersToUserIds()` walks the pending markers, resolves
     each to user UUIDs, merges with explicit user mentions, dedupes,
     removes the sender. The existing `fan_out_mentions` trigger then
     fires once per uuid in the `mentions[]` array — no backend change.
   - Group names with spaces are slugified to hyphens for the `@token`
     (e.g. "Cửa hàng Quận 1" → `@Cửa-hàng-Quận-1`). Render in
     MessageFeed: any hyphenated `@\S+` token (or literal `@all`) gets a
     purple pill style to distinguish from individual mentions.

5. **Quick Task center** (`/tasks` route) — lightweight TODOs separate from
   workflows. New `quick_tasks` table (migration #31). UI:
   - `TasksPage` with sub-tabs (Của tôi / Tôi giao / Cả nhóm for
     admin+editor) + filters (Đang làm / Đã xong / Quá hạn) + search.
   - `QuickTaskModal` — title + optional rich-text description (`T` toggle)
     + assignee (radio: user OR group) + optional due date.
   - Hover action on any chat message: "Tạo việc" → opens modal with
     title pre-filled (first 80 chars) + `source_message_id` set.
   - `TaskView` side panel (new `PanelKind = 'task_view'`) — view
     details + Đánh dấu xong / Hoàn tác / Huỷ / Xoá / Mở tin nhắn gốc
     (which navigates back to chat with scroll-to-message ring).
   - Notification: when assigned to a USER (not group), a `task_assigned`
     notification fires via the new `fan_out_task_assignment` trigger.
     Group assignments stay quiet to avoid notifying 7+ people on every
     trivial task.
   - Permission model: only the creator + assignee (user OR group member)
     + admin/editor can SELECT/UPDATE; only creator + admin/editor can
     DELETE. Status flip uses the same RLS as UPDATE.

**Setup**: run migration #31 (`migration_phase_quick_tasks.sql`).

### 76. Silent-RLS-filter UPDATEs — `form_submissions` + `workflow_runs` (round-8)

PostgreSQL RLS without an UPDATE policy doesn't throw — it silently affects 0 rows. The `{ data, error }` return is `{ data: null, error: null }`. App-level success toasts fire even though nothing changed. This bit us TWICE:

1. **`form_submissions` had no UPDATE policy.** `StepFormModal.submit()`'s progressive-fill UPSERT path (lines 182–191) called `.update({ data: mergedData, last_updated_by_step_id })` on the existing submission row. RLS silently filtered the UPDATE → user saw "Đã cập nhật" toast → reloaded → only the first step's data was there. Gotcha #54 was effectively broken in production.

2. **`workflow_runs` UPDATE was `for all using (run_by = auth.uid())`** — only the run starter could update. Admin/editor pressing "Hoàn thành" on a run they didn't start (the common workflow-approval flow where the runner is editor and admin closes it after final approval) silently failed.

**Detection trick**: re-read the row after UPDATE. If `error` is null but the value didn't change, RLS swallowed it. The round-8 test suites Suite C (progressive form fill) + Suite E (sequential 4-user) catch both.

**Fix**: migration #30 (`migration_phase_rls_update_policies_fix.sql`) adds:
- `form_submissions` UPDATE policy → submitter OR admin/editor
- `workflow_runs` split into INSERT/UPDATE/DELETE; UPDATE → run_by OR admin/editor

If a feature "saves successfully" in the UI but the value reverts on refresh, this is the first thing to check. The pattern: every CRUD-style table needs all four operations covered by RLS policies (often `for all` is fine; just don't leave UPDATE/DELETE undefined).

### 75. AIModifyStep validator allowlist must match the schema (round 7i)

The hand-rolled validator in `src/lib/workflowAISchema.ts` builds the validated `patch` object by COPYING individual keys from the AI response. If you add a new key to `AIModifyStep['patch']` (or `AIAddStep`), you MUST also extend the validator's `if (p.<key> !== undefined) ...` chain.

**Real-world bite (round 7i)**: AI started emitting `modify_steps[].patch.attach_form_code = 'F1'` to attach a form. The type didn't include `attach_form_code` and the validator silently dropped it. Validated patch became `{}`. `applyPatchToDraft` saw nothing to apply. Step's `form_template_id` stayed null. User saw "Đã áp dụng" + a `↻ Sửa S1 ()` line in the chat (note the empty `()`) and the form attachment "disappeared" on stage navigation.

The empty parentheses in `PatchDetail` (`Object.keys(m.patch).join(', ')`) is now a useful diagnostic — if you ever see `()` after Accept, the AI emitted a key the validator dropped.

The same trap applies to `AIAddForm` / `AIModifyForm` field-shape additions. Always update both the type AND the validator copy chain together.

### 74. supabase-js doesn't throw — every UPDATE/DELETE/INSERT needs `.error` check (round 7h)

`@supabase/supabase-js` returns errors as `{ data, error }`, NEVER as a thrown exception. The pattern:

```ts
const { data, error } = await supabase.from('x').update({...}).eq('id', y)
if (error) throw new Error(`Update x failed: ${error.message}`)
```

Without the `if (error) throw`, RLS denials, FK violations, and any other DB error are silently swallowed and the function continues as if nothing happened.

**Real-world bite (round 7h)**: `persistWorkflow` originally did:
```ts
await supabase.from('workflow_templates').update({...}).eq('id', templateId)
await supabase.from('workflow_steps').delete().eq('template_id', templateId)
```
The DELETE silently failed (FK from `workflow_step_results.step_id` blocked it) but execution proceeded to INSERT new steps. End state: old steps remained, new INSERTs collided. User saw "save succeeded" but the workflow reverted on reload.

Audit pattern when reviewing save code: for every supabase call, the result MUST be destructured and `error` must be checked or thrown. If you skip the destructure (`await supabase.from(...).update(...)`) you've introduced a silent-failure path.

### 73. workflow_steps DELETE blocked by FK refs — migration #29 + null-out fallback

`workflow_step_results.step_id` and `workflow_run_steps.source_step_id` reference `workflow_steps(id)`. The original schema declared no `ON DELETE` clause, so the FK defaults to `NO ACTION` (RESTRICT). Any workflow that has been RUN can't have its steps wiped-and-replaced by the editor's save flow → save fails (silently, see gotcha #74).

**Permanent fix — migration #29** (`migration_phase_workflow_steps_fk_fix.sql`):
- `workflow_steps.parent_step_id`   → `ON DELETE CASCADE` (self-ref auto-clean)
- `workflow_step_results.step_id`   → `ON DELETE SET NULL` (preserve run history)
- `workflow_run_steps.source_step_id` → `ON DELETE SET NULL` (preserve snapshot)

**Runtime fallback** in `WorkflowEditPage.persistWorkflow`: BEFORE issuing `DELETE FROM workflow_steps WHERE template_id = X`, the code first selects those step ids and runs `UPDATE workflow_step_results SET step_id = NULL WHERE step_id IN (...)` plus the same on `workflow_run_steps.source_step_id`. With migration #29 applied this is a no-op (FK auto-handles); without it, the manual null-out unblocks the DELETE.

If you see `Xoá steps cũ lỗi: ...` in the AI chat error bubble, run migration #29.

### 72. AI assistant — Accept / Reject / Undo per chat bubble (round 7c)

Round 7 auto-applied AI patches to the sandbox draft as soon as the AI responded. Two problems surfaced in testing:
1. AI sometimes returns a rationale-only response with empty `add_steps` / `modify_steps` arrays. Auto-apply does nothing visible → user thinks the assistant is broken.
2. No agency — user couldn't decline a patch they didn't like; only `Undo` after the fact.

Fix: every assistant patch lives in a state machine (`pending` → `accepted` / `rejected`; `accepted` → `undone`). The bubble renders status-aware UI:

- **`pending`** — primary-tinted bubble + `Accept` and `Bỏ qua` buttons. Patch is NOT applied yet.
- **`accepted`** — green-tinted + `Undo` button (active only on the 3 most-recent accepted bubbles).
- **`rejected`** / **`undone`** — muted, no buttons.
- **`advice`** — amber-tinted; rationale only, no Accept (nothing to apply). For when AI returns a patch with zero operations.
- **`info`** — blue-tinted; review-stage summary.
- **`error`** — red-tinted; AI/network/validation error.

Each accepted turn stashes its `preApplyDraft` + `preApplyFormOps` snapshot. Undo restores the snapshot. Snapshots stay alive until the user `Lưu`s the stage (then chat clears + the next stage starts fresh).

PatchDetail panel inside each bubble lists every operation (add/modify/remove step + add/modify form) with code chips so the user can see exactly what Accept will do BEFORE clicking — solves the "I clicked but nothing happened" confusion.

The right-panel global Undo button was removed (replaced by per-turn Undo). The right panel still shows the live draft + diff vs. entryDraft.

### 71. Sticker pack via memegen.link (round-7b/3)

Chat now has a sticker picker (😊 icon next to Paperclip in MessageInput desktop bar; in the More menu on mobile). Click → grid of meme stickers → click → posts a chat message with `payload.kind = 'sticker'`.

Stickers are sourced from **memegen.link** (free, public, no auth). Manifest lives in `src/lib/stickers.ts`. Each sticker has a constructed URL like:
```
https://api.memegen.link/images/cheems/_/oki~doki.png?width=240
```

Categories shipped in v1: Cheems, Doge, Khác (this is fine, surprised pikachu, drake, success kid, oprah, etc.). ~18 stickers total.

**To replace with own assets later**: swap the manifest entries' `url` field with Supabase Storage public URLs (e.g. `https://<project>.supabase.co/storage/v1/object/public/chat-attachments/stickers/<file>.png`). UI doesn't care about source.

**Render path**: `RichCard.tsx` → when `payload.kind === 'sticker'` returns a borderless `<img>` (max 180×180, object-contain). Sticker messages are still standard `chat_messages` rows with `message_type = 'rich_card'` and the new payload kind — no migration needed (gotcha #20: payload jsonb is the extension point).

### 70. Per-channel members + privacy ACL (round-7b/2)

Until round 7b every team channel was visible to every authenticated user (gotcha #47). Round-7b/2 introduces opt-in per-channel privacy:

- `chat_channels.is_private boolean` (default `false`).
- New `chat_channel_members (channel_id, user_id, role, added_at)` table with PK `(channel_id, user_id)`. Role ∈ `owner | member`.
- RLS rewrite on `chat_channels` SELECT: row visible if `is_private = false` OR caller is `owner_id` OR caller is `dm_partner_id` OR caller is in `chat_channel_members` for that channel OR caller is admin/editor.
- RLS rewrite on `chat_messages` SELECT: when `context_type = 'channel'`, must pass the same channel-visibility check. project + portal contexts unchanged.
- Helper RPC `add_channel_member(p_channel_id, p_user_id)` (security definer) — only the channel owner / creator OR an admin/editor can call.

UI:
- New channel via "+" button creates with `is_private = true` + `owner_id = creator` + auto-inserts owner-row in `chat_channel_members`. Members modal opens immediately so the creator can invite teammates.
- `ChannelMembersModal` (per-channel, hover-action `Users` icon next to each team-channel item in the sidebar) — lists members + add-via-search picker + remove button. Owner / admin / editor can manage; non-managers see read-only list.
- Legacy public channels (`is_private = false` from before migration #28) stay open — no breakage.

Setup:
- Run `migration_phase_chat_channel_members.sql` (#28). PostgREST auto-reloads via `notify pgrst, 'reload schema'` at the bottom.
- No edge function or grants change beyond the SQL itself.

DM channels (`channel_type = 'dm'`) and personal channels (`channel_type = 'personal'`) are NOT governed by `chat_channel_members` — they're gated by their own `owner_id` / `dm_partner_id` columns (gotcha #29).

## Theme & font system

The app uses **XT-Design v1.1 — Hybrid Carbon × Fluent, Warm Retro Edition**, light-only. The full guideline lives in `XT-Design-Guideline-v1.1.md` at the project root. Three body fonts are user-configurable.

Per-user preferences in `profiles.preferences` jsonb (**no separate migration — uses existing column**):
```json
{
  "font":      "inter" | "plex" | "serif",
  "theme":     "carbon",
  "sidebar":   { "pinned": true|false },
  "notifications": { "muted_kinds": [...] }
}
```

Applied via `data-font` and `data-theme` attributes on `<html>` by `<ThemeApplier />` mounted in `App.tsx`. Legacy values (e.g. `theme: 'warm'`) are read-coerced silently to `'carbon'` — no migration needed.

### Anchor invariants (don't break these)

- **Primary anchor is #4A6AAB** (XT warm blue). All `primary-*` tokens derive from it. Hover = `#3D5994`.
- **Paper bg `#FDFDFC`, text-primary `#3B3B3B`, border `#E0E0E0`, border-strong `#BCBCBC`.** Warm grey palette — never Carbon cool grey.
- **Two new accents**: `--color-accent-retro` (`#C1695B`) for signature decorative use (top-bar 2px border, today-cell border, etc. — **never** for action buttons or alerts) and `--color-accent-orange` (`#CC6947`) for emotional CTA.
- **Semantic colors**: `--color-success #5A8C5A`, `--color-warning #C8954A`, `--color-danger #C9534B`. Don't reach for `bg-red-500` directly — use `var(--color-danger)` so retheming stays single-source.
- **Default radius is 4px** on buttons, inputs, cards, panels. Modals get 6px. Mobile bottom sheets get 8px on the top corners.
  - `rounded`, `rounded-md`, `rounded-lg` → 4px
  - `rounded-xl` → 6px
  - `rounded-2xl` / `rounded-t-2xl` → 8px (mobile sheet)
  - `rounded-3xl` → 0px (killed)
  - `rounded-full` → preserved for pills/avatars/chips
  - `.section-tab-bookmark` opt-in class → 0px (module-level navigation tabs only)
- **Hierarchy uses light shadows + hairline borders.**
  - `shadow-sm`, `shadow`, `shadow-md` → light: `0 2px 6px rgba(0,0,0,0.06)` (XT softened)
  - `shadow-lg`, `shadow-xl`, `shadow-2xl` → deep: `0 8px 24px rgba(0,0,0,0.12)`
  - `shadow-none` opts out (sidebar/header/tables/section tabs stay flat).
- **Section tabs (module nav) use bookmark style**: 2px top border in primary on active, 0px radius. Apply via the `section-tab-bookmark` class. See `WorkflowsPage` for examples.
- **AppShell has an optional 2px `--color-accent-retro` top-border** as XT signature.
- **Font tokens**: `--font-serif` (legacy name) resolves to Inter by default, IBM Plex Sans when `data-font="plex"`, Source Serif 4 when `data-font="serif"`. Don't rename `font-serif` callsites — the token swap handles it transparently.
- **Light only**: dark theme scaffold removed in XT v1.1. The token block in `src/index.css` for `html[data-theme="dark"]` is gone — do not re-add it without product direction.

### Adding a new font

1. Add the font's Google Fonts URL to `index.html`'s `<link>`.
2. Add `html[data-font="newname"] { --font-serif: "NewFont", ...; }` in `src/index.css`.
3. Widen `FontChoice` in `src/types/index.ts` and add a coercion case in `ThemeApplier.tsx`.
4. Add a `FontOption` button in `PersonalTab.tsx`.

### Re-introducing dark theme (deferred)

A dark theme is out of scope for XT v1.1. If reintroduced: paste the `html[data-theme="dark"]` block from XT-Design-Guideline-v1.1.md §1.5 back into `src/index.css` and add a UI toggle in `PersonalTab.tsx`.

## Project structure quick map

```
src/
  App.tsx                    — router, lazy routes, providers; mounts <SidePanel /> + <ExitGuard />
  contexts/AuthContext.tsx   — session + profile + groupIds + preferences + selfChatId
  lib/
    supabase.ts              — single client instance
    permissions.ts           — can(action, resource, acl) — mirrors SQL fn
    routine.ts               — workflow schedule routine helpers
    fileKind.ts              — file type detection + format helpers
    sanitizeHtml.ts          — DOMPurify wrapper
    slug.ts                  — Vietnamese-safe slug generator
    uploadAttachment.ts      — Supabase Storage upload helper
    useMediaQuery.ts         — responsive hook
    sidePanelStore.ts        — useSyncExternalStore singleton for side-panel state
    useChatUnread.ts         — unread badge hooks (useChatUnread, useChatTotalUnread, useMarkChatRead)
    usePendingApprovals.ts   — usePendingApprovalCount() — counts pending approval_status rows (30s poll)
    buildCardSummary.ts      — (template, submissionData) → summary { label, value }[] for rich cards
  components/
    ui/                      — Button, Modal, Badge, Toast, ChipInput, RichTextEditor, RichTextDisplay, Skeleton
    layout/                  — AppShell (mobile bell in top bar), NavTabs (unread dot), Sidebar (icon prop on SidebarItem), NotificationBell, ThemeApplier
    chat/                    — MessageFeed (own-msg sky-blue bubble, @mention highlight, reply-to-bot, 15s polling),
                               MessageInput (no form UI; bot picker via @; reply chip when botReplyContext set),
                               AttachmentPreview (images: max 200px preview + hover "Xem" lightbox modal),
                               StartWorkflowFromChatModal,
                               RichCard (submission/workflow/approval_request/bot_response cards)
    forms/                   — TemplateEditor (summary_field_ids UI + Phase-D fill-rules UX when in workflow context),
                               FormFillModal (emits rich_card),
                               FormFields (FieldBlock + FormRunContext + computeFieldMode for fill-rule gating),
                               SubmissionsViewer
    panel/                   — SidePanel (shell, global), SubmissionView (read-only),
                               WorkflowRunPanel (fully interactive workflow executor + approval gate via gateApproveOnApproverFields)
    projects/                — KanbanBoard (with Activity column), ProjectTable, CreateProjectModal, ProjectFilesTab,
                               FilePreviewModal, FormSubmissionDetailModal,
                               ProjectActivityFeed (feed list — kanban + project detail),
                               CustomerPortalCard (extracted credentials editor),
                               CustomerPortalTab (Cổng KH tab content: card + workflows + info cards)
    workflow/                — StepFormModal (UPSERT mode when runId is set; runContext field gating),
                               RunProgressBar (status-coloured segments), ScheduleEditor
    workflow-edit/           — Round-3 redesign — meta/access/guidance left, visual+detail split right:
                               types, stepTree (dfsOrdered), WorkflowMetaPanel, WorkflowAccessSection,
                               WorkflowGuidanceEditor, WorkflowFlowPanel (React Flow), StepNode,
                               ResizableVerticalSplit, StepDetailPanel, StepApprovalSection,
                               StepFormSection, InheritFormModal
    settings/                — LabTab (ai/faq/docs/forms sub-tabs; AI sub-tab has Config/Log toggle + AiUsageLogView),
                               FormPane (forms management), GroupsSection, PersonalTab (3 fonts incl Source Serif 4), DocumentPane, HelperPanelView
  pages/                     — one file per route (no /forms route — forms are in Settings→Lab)
  types/index.ts             — central TS interfaces (RichCardPayload, ChatMessage.payload, ContextType,
                               WorkflowStep/RunStep approval fields, ChatChannel DM fields)

supabase/
  schema.sql                 — initial schema
  migration_phase_*.sql      — additive migrations (run in order, see gotcha #4)
  seed_demo_grants.sql       — ONE-TIME grants for service_role on 13 tables; run before npm run seed:demo
  cleanup_test_data.sql      — deletes all [TEST] rows + old dev channels; handles FK chain (see gotcha #51)
  functions/chat-helper/     — Edge Function for AI Assistant runtime
  maintenance_*.sql          — admin scripts (run on demand)

scripts/
  seed-demo.mjs              — seeds full Minh Phúc demo dataset (25 users, groups, channels, projects,
                               form/workflow templates, runs, messages); uses service_role only; idempotent
                               per channel (skips message seed if channel already has messages)
```

## What ships per phase (current state)

All 9 phases of the [original architecture plan](C:\Users\HP\.claude\plans\ok-hi-n-gi-t-scalable-pearl.md) are complete.

**Chat-centric Hybrid ERP — all phases complete:**

- **Phase 1**: Flexible chat payload — `message_type` CHECK dropped, `payload jsonb` added, `form_templates.summary_field_ids`, rich card renderer, `RichCard.tsx`, `buildCardSummary.ts`
- **Phase 2**: `form_drafts` table — owner-only RLS, `useDrafts` hooks, draft CRUD
- **Phase 3**: Self-chat — `chat_channels.owner_id`, `get_or_create_self_chat()` RPC, personal channel pinned in sidebar, `selfChatId` in AuthContext
- **Phase 4**: Side panel shell — `sidePanelStore`, `SidePanel`, `SubmissionView`, `FormFields` extract, `WorkflowRunPanel` fully interactive
- **Phase 5 (this session)**: Forms → Lab Settings + Workflow Approval + DM channels (see session log below)

## Open known issues / sorry-decisions

- 🔴 **C1**: Permission model fragmented — `permissions.ts` + SQL `can()` exists but isn't used everywhere yet. Refactor target.
- 🟡 **C5**: AI runtime needs admin to deploy Edge Functions manually. `personal-bot` (personal channel bot picker) and `chat-helper` (Lab AI Assistants) are both deployed but must be re-deployed manually after code changes via the Supabase Dashboard editor.
- ✅ **I1** *(resolved)*: `chat_messages.message_type` CHECK enum was rigid. Migration #11 dropped the CHECK and added `payload jsonb`. New card kinds are TS discriminated union variants on `RichCardPayload` — no more SQL migrations for new chat content types. Legacy `message_type='form_submission'` rows still render via the old renderer.
- 🟡 **I3**: `__OTHER__` marker is string-encoded, hard to query.
- 🟡 **I5**: Document library + chat_attachments duality — files exist in two places, no unified "all files" view.
- 🟡 **I7**: No soft-delete. Deletes are permanent.
- 🟡 **I8**: Approval `approver_role` ('admin'|'editor') resolves to a specific user only when `approver_user_id` is set. True role-based resolution (fan out to all admins/editors) is a TODO in `fan_out_approvals`.
- 🟢 **N1**: Many `as any` casts in supabase relation queries. Run `supabase gen types typescript` someday.

## Locked-in features

### ✅ L1 — Workflow approval steps *(shipped)*

Implemented in `migration_phase_workflow_approval.sql` + WorkflowEditPage + WorkflowRunPanel. Steps can require approval from a designated user; the DB trigger auto-posts an `approval_request` card to the approver's personal channel. See gotcha #28 for the full flow.

### ✅ L2 — Personal channel bot picker *(shipped)*

`@` in the personal "Cá nhân" channel shows a bot picker dropdown listing all `helper_panels WHERE type='chatbot'` plus "Trợ lý chung" (general AI). Selecting a bot sends `panel_id` to the `personal-bot` Edge Function, which loads that panel's `system_prompt`/`knowledge_base`/`model` config. Bot replies appear as `bot_response` rich cards. See gotcha #32 for setup checklist.

## Workflow when adding a feature

1. **Read this file** at the start of every session
2. Follow the migration → types → context → component → page → build sequence
3. **Always end with:** SQL files to run, verification steps, and what's deployed where
4. Commit message: short title, no co-author signature unless asked
5. Force-push only with explicit user OK (Vercel author verification — see #15)

## When in doubt, defer to the user

The user (xichtho996) is the product owner and primary tester. They'll tell you when something doesn't fit. Don't over-engineer; ship small commits and iterate.

---

## Recent session log (newest first — keep last 5)

### Round 9 — chat polish: DM names, search, threading, @group mentions, Quick Tasks (latest)

Big chat-side upgrade in one round, all six items shipped + 147/147 tests still
green. Driven by user feedback that the chat UX felt generic vs. a real chat
app, and that 20–100-person SMEs need search + lightweight task coordination
that workflows are too heavy for.

**Six features shipped**:

1. **DM display name + avatar** (`ChatPage.tsx`) — DMs now show the partner's
   `full_name` + circular initials avatar instead of literal "DM".

2. **Global message search** (`GlobalSearchBox` mounted in chat sidebar) —
   ilike on `chat_messages.content`, results grouped by channel/project,
   click → navigate + scroll-to-message ring (existing gotcha #45 infra).

3. **Per-channel message search** (`ChannelSearchBox` magnifier icon next to
   "Làm mới" in MessageFeed header) — same helper, scoped by `contextId`,
   in-place scroll-and-highlight.

4. **Threaded replies UI** — schema's `parent_id` already existed but had no
   UI. Hover-icon "Trả lời" on each non-bot message → MessageInput shows a
   reply chip "↩ Trả lời X: <preview>" → next send writes `parent_id`.
   MessageFeed shows "+ N câu trả lời" badge that opens a side-panel
   `ThreadPanel` (new `PanelKind = 'thread'`).

5. **@all + @groupname mentions** — `@` picker now includes "Cả nhóm"
   section (`@all` only in channels) + "Nhóm thành viên" section listing
   `user_groups`. Resolution happens at send time client-side (expand to
   user UUIDs, merge with explicit user mentions, dedupe, remove sender).
   The existing `fan_out_mentions` trigger fires per uuid — zero backend
   changes. Group names with spaces are hyphen-slugified for the @token
   (e.g. `@Cửa-hàng-Quận-1`). Purple pill render in MessageFeed.

6. **Quick TODO center** (`/tasks`) — new top-level nav, lightweight tasks
   separate from full workflows. Migration #31 adds `quick_tasks` table:
   - title (required), description_html (optional rich), single assignee
     (user OR group, mutually exclusive via CHECK), optional
     `source_message_id` link to a chat message, status open/done/cancelled,
     optional due date.
   - RLS: visibility = creator + assignee user + group members +
     admin/editor. INSERT requires `created_by = auth.uid()`.
   - `fan_out_task_assignment` trigger fires `task_assigned` notification
     to the assigned user (group assignments stay quiet on purpose).
   - UI: TasksPage sub-tabs (Của tôi / Tôi giao / Cả nhóm) + filters
     (Đang làm / Đã xong / Quá hạn) + search. QuickTaskModal for
     create/edit. TaskView (new PanelKind `'task_view'`) for the drawer.
   - Chat integration: hover action on any message → "Tạo việc" → opens
     modal pre-filled (first 80 chars) + sets `source_message_id`. TaskView
     has "Mở tin nhắn gốc" to navigate back with scroll-ring highlight.
   - Notification kind extended: `task_assigned`, `task_completed`. Click
     bell row → navigates to `/tasks?id=<task_id>` which auto-opens the
     drawer.

**Migrations to run**: #31 (`migration_phase_quick_tasks.sql`). All previous
migrations through #30 still required.

**Bundle**: WorkflowEditPage chunk unchanged; ChatPage chunk grew slightly to
host 4 new components. Total dist: 41 → 42 entries (1.29 MB → 1.33 MB).

New gotcha #77 covers all 6 features in one entry.

### Round 8 — sequential test bot + edit-flow coverage + RLS update-policy fixes

After round-7's silent-failure bugs (gotchas #73–#75), it became clear the test suite couldn't catch "later step doesn't see what earlier step did" scenarios. Round-8 adds 6 deep test suites + 1 new test user + fixes 2 production RLS gaps surfaced by the new tests.

**Test infrastructure**:
- Added 4th test user `test-runner@bos-test.local` (role `member`) so 4-user sequential handoff scenarios have all distinct identities.
- 6 new suites in `scripts/test-runner.mjs` (≈40 new tests; total grew from 101 → 147):
  - **Suite A — `testWorkflowEditFlow`**: rename / reorder / delete steps after a run exists; verifies migration #29's FK SET NULL preserves history (gotcha #73).
  - **Suite B — `testTemplateAccessACL`**: documents that `workflow_template_access` is currently NOT enforced at RLS — only client-side filtering. Marked as known gap I-WTA.
  - **Suite C — `testProgressiveFormFill`**: 1 form, 3 fields owned by 3 different steps via `fill_at_step_id` + `fill_by_role`; one submission row per (run × template) per migration #22's unique partial index.
  - **Suite D — `testRejectionAndRerun`**: the rejection path nobody tested — reject → editor re-edits → re-submits → admin approves second attempt; verifies fan_out_approvals trigger fires both cycles.
  - **Suite E — `testSequentialMultiUserWorkflow`**: 4 distinct users (admin/editor/viewer/runner), 4 steps, runner-as-approver pattern; documents that the schema lacks per-step runner ACL (only run_by can update step results — known gap I-VIEWER).
  - **Suite F — `testWorkflowChatBot`**: stateful smoke that mimics the AI assistant's commit path at DB level — empty draft → skeleton patch → form attachment → modify → run → mid-history step removal (FK SET NULL kicks in) → workflow_run_link rich card. The "test bot" the user asked for, no LLM dependency.

**Bug fixes — migration #30** (`migration_phase_rls_update_policies_fix.sql`): two silent-RLS-filter UPDATEs surfaced by the new tests:
- `form_submissions` had NO UPDATE policy. `StepFormModal.submit()`'s progressive-fill UPSERT silently affected 0 rows → users saw "Đã cập nhật" toasts but data reverted on refresh. Migration adds UPDATE for submitter + admin/editor.
- `workflow_runs` UPDATE was `for all using (run_by = auth.uid())`. Admin/editor pressing "Hoàn thành" on a run started by someone else silently failed. Migration splits the monolithic policy into INSERT/UPDATE/DELETE; UPDATE/DELETE allow run_by OR admin/editor.

Both bugs were in production but never reported because the toast says "saved" — only re-reading the row showed the value didn't change. New gotcha #76 (silent-RLS-filter UPDATEs).

**Test results pre-migration**: 144/147 pass; 3 fail with explicit "Run migration #30" diagnostic in the failure message. Post-migration: all 147 pass.

**Migrations to run**: #30 (one new). All previous migrations through #29 still required.

### Round 7 — conversational AI sandbox, Accept/Reject/Undo, save-flow audit

A long iteration cycle on the AI workflow assistant. Turned the one-shot patch flow into a chat-style sandbox with explicit consent + a deep audit of the save path that surfaced multiple silent-failure bugs.

**Round 7a (commit `749fc3c`)** — Modal split into chat (left) + draft preview (right). Sandbox draft model: AI patches mutate ONLY a local `StepDraft[]` until the user clicks "Lưu". `applyAIPatchToDraft.ts` extracted as a pure function. Form ops (`add_forms`, `modify_forms`) queued in `pendingFormOps` until commit. `commitDraftToEditor` runs the form CRUD batch.

**Round 7b (commits `4875427` → `1bed786`)** — Three side-quests that came up during testing:
- Activity feed simplified to RSS-style flat log (gotcha — was rendering raw HTML payloads from chat-message summaries)
- Chat sidebar: always-visible "Tin nhắn riêng" section + new DM button (`NewDMModal`); 8-item collapse per section
- Per-channel members ACL — migration #28 (`chat_channel_members` + `is_private` flag + RLS); `ChannelMembersModal` for invite/remove
- Sticker pack via memegen.link CDN — `StickerPicker` popover next to Paperclip

**Round 7c (commit `cfb86ca`, fixed in `8119907`)** — AI assistant Accept / Reject / Undo per turn. Each AI response becomes a `pending` chat bubble; user clicks Accept → applies + becomes `accepted` with Undo button (only latest 3 are undoable); Reject → `rejected`; advice (empty patch) → muted bubble with explanation. Sandbox snapshots stored on each turn. Round 7c follow-up fixes: chat_channel_members 42P17 RLS recursion (gotcha #70 fix migration); sticker click-outside race; modal full-screen `2xl` size; AI conversational details prompt.

**Round 7d–7e (commits `51316b8`, `b5671b0`)** — UX polish:
- Modal size `2xl` → `full` (95vw); inner panels min-h 72vh
- localStorage autosave per templateId (debounced 500ms) + restore-banner on next open within 7 days
- Stage breadcrumb chips made clickable via `jumpToStage`
- Stage transition toasts (so user sees "Tiếp theo: chi tiết S1" after Lưu khung)
- Pinned action bars — modal body is now a flex column with explicit height calc, panels use flex-1 + overflow-hidden so input/Lưu button stay visible

**Round 7f (commit `752f44c`)** — Field type schema mismatch: `AIFieldType` had `text | long_text | select | … | file | checkbox` but the codebase's actual `FieldType` is `text | textarea | number | date | select | multi_select | radio | checkbox`. Added `coerceFieldType()` to map common synonyms (`long_text`/`paragraph` → `textarea`; `email`/`phone` → `text`; `file`/`image` → `text`; etc.). Edge function DETAILS_PROMPT got an explicit "INHERIT EXISTING WORK — DO NOT OVERWRITE" section plus correct field type list. Detail-stage chat empty-state shows "✓ Đã có sẵn" + "○ Còn thiếu" boxes.

**Round 7g–7h (commits `a0c55a9`, `b1c6f7d`)** — Save flow audit. Two layered bugs:
- AI modal's `onCommitDraft` callback only updated page state, never persisted `workflow_steps` to DB. Form CRUD persisted but step→form attachment lived only in React state. Extracted page's `save()` into `persistWorkflow(stepsToSave)`; new `persistFromAI` callback runs full persist on every AI stage commit.
- `workflow_steps` DELETE silently failed (FK from `workflow_step_results.step_id` and `workflow_run_steps.source_step_id` is `NO ACTION` by default; supabase-js doesn't throw → error swallowed). Two-prong fix: migration #29 (`migration_phase_workflow_steps_fk_fix.sql`) sets `ON DELETE SET NULL` for run-step refs + `CASCADE` for parent self-ref; runtime fallback in `persistWorkflow` proactively nulls those refs before DELETE; explicit `.error` checks on every supabase call. New gotchas #73 (FK fix), #74 (always check `.error`).

**Round 7i (commit `bae6622`)** — One more silent-drop bug. AI emitted `modify_steps[].patch.attach_form_code = 'F1'`; the validator's allowlist for `AIModifyStep['patch']` had only 6 keys and silently dropped `attach_form_code`. Validated patch came back as `{}` → form attachment was a no-op. Added attach_form_code to type + validator. Detail-stage right panel redesigned: focused step renders as a large card with inline form preview (collapsible chevron showing every field's label/type/required/options); minimap of other steps below. AI history banner collapsed from a full row into a small History icon in StageBreadcrumb (popover at top-right z-30 on click). New gotcha #75 (validator allowlist parity).

**Migrations to run in order**: #28, #28b (RLS recursion fix), #29 (FK fix). All three are required for the AI flow to persist correctly.

### Round 4 + Round 5 — interactive flow builder, branch diamond, S/F codes, full-form preview, AI assistant (previous session)

A multi-day push that turned the workflow editor from a passive-tree viewer into a genuine visual builder, then layered on the form-fill responsibility map and an LLM-driven design assistant.

**Round 4 ramp-up (commits b0cd0a3 ← 57f7e94 ← c4dfbc4 ← ab8e2ae ← 8c4ebc2)** — round-4d shipped: hover-edit pattern on workflow name + description (faded pencil → click to edit, Enter/blur commits, Esc cancels); Hướng dẫn defaults to plain textarea with `T`-toggle for rich; duration `(?)` tooltip; `applyInitialLayout` materialises positions on hydrate so child spawn is reliable; sơ đồ has Sửa/Xem mode toggle persisted to `localStorage`.

**Round 5 — Phases A through D** (commits b0cd0a3 → 96f6282 → fe458a0):

- **Phase A — edge right-click context menu** (gotcha #64): `EdgeContextMenu` floating popover with "Xoá kết nối", anchored at `clientX/clientY`. `WorkflowFlowPanel.onEdgeContextMenu` opens it (edit-mode only). Backspace/Delete still works as power-user shortcut.

- **Phase B — branch diamond + S/F codes + 1-outgoing rule** (gotcha #64):
  - New `BranchNode` (diamond via outer rotated 45° div + un-rotated content layer + per-option source handles distributed along the bottom edges).
  - `StepNode` reduced to simple-step pill with `S{N}` chip top-left + `F{N} · {form_name}` subtitle when a form is attached.
  - New `codes.ts → deriveCodes(steps)` returns `{ stepCode, formCode, stepIdByCode, formIdByCode }` derived in DFS order each render. Codes appear on canvas, in detail panel header, in form picker labels, in AI input/output.
  - `connectSteps()` rejects extra outgoing edges from simple steps with toast: *"Bước đơn giản chỉ được nối tới 1 đích — xoá kết nối hiện tại trước."* Branches still fan out per option.

- **Phase C — form-fill responsibility map** (gotcha #65): new `StepFormFullPreview` lists every field of the attached form with status chips from the **current step's perspective**: green check `Đã điền tại S{N}`, primary `S{N} — bước này điền`, amber `Sẽ điền tại S{N}`, grey `Chưa gán bước`. Inline picker reassigns `fill_at_step_id` (UPDATE `form_templates.fields` jsonb + invalidate query). Hovering a row outlines the responsible canvas node via `bos-flow-highlighted` className + dashed amber CSS rule. Detail-panel header now shows `S{N} · {title}`. "Hiện khi" gets a HelpCircle tooltip explaining its conditional-show semantics.

- **Phase D — AI workflow assistant** (gotcha #66): natural-language workflow builder. New `src/lib/workflowAISchema.ts` defines `AIWorkflowPatch` (mode, rationale, template_meta, add_steps with `parent: { kind: 'root' | 'code' | 's_code' }`, modify_steps, remove_step_codes). Hand-rolled validator on both client AND server. New edge function `supabase/functions/workflow-ai/index.ts` (Deno + Anthropic). Modal `WorkflowAIAssistantModal` has 4 stages (prompt / loading / preview-with-diff / error). Apply path topologically resolves `code` and `s_code` parent refs, runs `applyInitialLayout` so the canvas reads cleanly, toasts *"Đã áp dụng. Bấm Lưu nghiệp vụ để ghi vào DB."* AI patches address steps + forms by S/F codes — never raw uuids.

**Self-QC pass** — walked the 26-item plan checklist (`for-the-project-1-temporal-tiger.md` Phase E). One gap caught: `attach_form_code` was being parsed but ignored in the apply path. Fixed: now resolves via `currentCodes.formIdByCode[a.attach_form_code]`. Build passes. WorkflowEditPage chunk: 246 KB / 75 KB gzip — under the 250 KB target including ReactFlow + Anthropic-style modal.

**Setup for Phase D**:
1. Deploy `workflow-ai` via Supabase Dashboard (paste `supabase/functions/workflow-ai/index.ts`).
2. `LLM_API_KEY` already set in Edge Function secrets (shared with `chat-helper` / `personal-bot`).
3. No DB migration. No grants change.

**Migrations to run**: none.

- New gotchas: #64 (interactive flow builder + branch diamond + S/F codes), #65 (form-fill responsibility map + cross-step inheritance visualization), #66 (AI workflow assistant — schema + edge function + apply path).

### Round 3 — workflow editor redesign + project code/activity feed + customer portal tab + rename sweep + connector fix (previous session)

Six commits across four user-facing phases plus follow-up bug fixes. Three migrations.

**Phase 1 — Workflow editor redesign** (gotcha #57): React Flow visual moved out of the left panel into a top-of-right-column preview (`ResizableVerticalSplit` with drag handle, `localStorage` persistence). Left column now: Meta → `WorkflowAccessSection` collapsible Quyền chạy → `WorkflowGuidanceEditor` (rich-text long-form notes saved to new `workflow_templates.guidance_html` column, migration #23). Mobile: left column becomes a slide-over.

**Phase 2 — Project code + activity log feed** (gotcha #58): migration #24 adds `projects.code` (auto-`D{YYMMDD}` with collision suffix), `project_status_history` audit table + trigger, and `get_project_activity_feed` RPC unioning 7 event sources (workflow start/done/cancel, chat messages, file uploads, form submissions, status changes). New `useProjectActivityFeed` hook + `ProjectActivityFeed` component used in the Kanban (prepended column before "Mở") and on `ProjectDetailPage` (replaces customer portal in the right info pane). Project code chip displayed in cards/table/info pane. Bonus: relaxes `form_submissions.context_type` CHECK to allow `'workflow_run'` (latent bug from migration #22).

**Phase 3 — Customer portal tab + info cards** (gotcha #59): migration #25 adds `project_info_cards` table (staff-internal annotations, RLS: author OR admin/editor). New `'portal'` tab (Cổng KH) on `ProjectDetailPage` (admin/editor only). Tab content (`CustomerPortalTab`) shows: extracted `CustomerPortalCard` (credentials), related workflows high-level status (no internal details to avoid leaks), and internal info cards (chronological rich-text notes with add/delete). Customer portal removed from the right info pane.

**Phase 4 — Rename sweep** (gotcha #60): UI strings "Workflow"→"Nghiệp vụ" (noun) and "Run"→"Chạy" (verb) across remaining files. Routes/code identifiers unchanged. Tab `Workflows`→`Nghiệp vụ` in project detail.

**Follow-ups discovered during testing:**
- **Visual map collapse button** (gotcha #63): chevron toggle in `WorkflowFlowPanel` toolbar. When collapsed, only the header strip renders; detail panel takes full height. Persists to `localStorage` under `bos_workflow_edit_flow_collapsed`.
- **Connector lines invisible** (gotcha #62): inline `style={{opacity: 0}}` and even `width:6px` on `<Handle>` interfered with React Flow's edge endpoint resolution. Fixed by switching to bare `<Handle>` defaults + global CSS in `index.css` overriding `.react-flow__handle` and `.react-flow__edge-path` with `!important`. Hard-refresh required to bust PWA cache after deploy.
- **SQL #24 column-name fixes**: `coalesce(p.full_name, p.email)` failed (no `email` on `profiles` — gotcha #61); `a.created_at` failed (column is `uploaded_at` on `chat_attachments` — gotcha #37 corrected). Fixed both — RPC now uses `p.full_name` directly and `m.created_at` from joined messages.

Files created (all phases): `WorkflowGuidanceEditor`, `WorkflowAccessSection`, `ResizableVerticalSplit`, `CustomerPortalCard`, `CustomerPortalTab`, `ProjectActivityFeed`, `useProjectActivityFeed`, three SQL migrations (#23/#24/#25).

**Migrations to run** (in order): #23, #24, #25.

- New gotchas: #57 (editor layout), #58 (project code + activity feed), #59 (customer portal tab + info cards), #60 (rename rules), #61 (profiles has no email), #62 (React Flow CSS pattern), #63 (visual map collapse).
- Corrections: #37 (chat_attachments uses `uploaded_at`, not `created_at`).

