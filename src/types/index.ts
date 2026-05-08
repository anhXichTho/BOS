// ─── Auth & Users ───────────────────────────────────────────────────────────

export type UserRole = 'admin' | 'editor' | 'user'

export interface Profile {
  id: string
  full_name: string
  avatar_url: string | null
  role: UserRole
  preferences?: UserPreferences
  /** Round-10 — set on first login or when the user dismisses the welcome modal. */
  onboarded_at?: string | null
  created_at: string
}

export interface LeaderMember {
  id: string
  leader_id: string
  member_id: string
}

// ─── Groups & Permissions ────────────────────────────────────────────────────

export interface UserGroup {
  id: string
  name: string
  description: string | null
  color: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  // joined
  member_count?: number
}

export interface UserGroupMember {
  group_id: string
  user_id: string
  added_at: string
}

export type ResourceType =
  | 'project'
  | 'workflow_template'
  | 'form_template'
  | 'document'
  | 'helper_panel'

export interface ResourceGroupAcl {
  resource_type: ResourceType
  resource_id: string
  group_id: string
}

// ─── User preferences (stored as profiles.preferences jsonb) ─────────────────

export type FontChoice = 'plex' | 'inter' | 'serif'
export type ThemeChoice = 'carbon'   // legacy name; XT v1.1 light-only — kept as typed field

export interface UserPreferences {
  /** Body font family — applied via [data-font] attribute on <html>. */
  font?: FontChoice
  /** Visual theme — IBM Carbon Design System (sole theme). Kept as a typed field for forward-compat. */
  theme?: ThemeChoice
  sidebar?: {
    /** When true, sidebar is permanently expanded (no hover-collapse). */
    pinned?: boolean
  }
  notifications?: {
    /** Notification kinds the user has chosen to mute. */
    muted_kinds?: string[]
  }
  /** Reserved for future light/dark mode within each theme. */
  color_mode?: 'light' | 'dark' | 'system'
  /** ISO timestamp when the user dismissed the welcome onboarding modal.
   *  Stored here (vs a dedicated column) so we don't need a migration. */
  onboarded_at?: string
}

// ─── Chat ────────────────────────────────────────────────────────────────────

export type ContextType = 'channel' | 'project'
export type MessageType = 'text' | 'form_submission' | 'workflow_run_link' | 'rich_card'

/**
 * Typed payload for `rich_card` messages.
 * Adding a new card kind is a TS-only change — no migration needed.
 */
export type RichCardPayload =
  | {
      kind: 'form_submission_link'
      submission_id: string
      template_name: string
      summary?: { label: string; value: string }[]
    }
  | {
      kind: 'workflow_run_link'
      run_id: string
      template_name: string
      status: string
    }
  | {
      kind: 'bot_action_summary'
      draft_id: string
      title: string
      icon?: string
    }
  | {
      kind: 'approval_request'
      run_id: string
      run_name: string
      step_result_id: string
      step_title: string
      requester_id: string
      requester_name: string
      requested_at: string
    }
  | {
      kind: 'bot_response'
      reply: string
      query: string
      model?: string
      panel_id?: string | null
      bot_name?: string
    }
  | {
      // Round-7b/3 — sticker payload. URL points to a public PNG/WEBP
      // (memegen.link by default, or any Supabase Storage URL the user
      // chooses). Rendered inline by MessageFeed as a borderless image.
      kind: 'sticker'
      url: string
      alt?: string
    }
  | {
      // Round-10 — Quick task card. Posted in chat when a task is created
      // from a message OR via the chat "+ Tạo việc" entry. Click → opens
      // the task drawer. Same payload shape as workflow_run_link in spirit.
      kind: 'quick_task'
      task_id: string
      title: string
      assignee_label?: string
      due_date?: string | null
      status: 'open' | 'done' | 'cancelled'
    }
  | {
      // Round-10 follow-up — Reminder fired card. Auto-posted by the
      // pg_cron `fire_due_reminders` job into the chat where the
      // reminder was created (falls back to the recipient's personal
      // channel).
      kind: 'reminder_card'
      reminder_id: string
      title: string
      fire_at: string                // ISO timestamp
      source_message_id?: string | null
    }

export interface ChatChannel {
  id: string
  name: string
  description: string | null
  owner_id: string | null
  channel_type: 'team' | 'personal' | 'dm'
  dm_partner_id: string | null
  created_by: string | null
  created_at: string
}

export interface ChatMessage {
  id: string
  context_type: ContextType
  context_id: string
  parent_id: string | null
  author_id: string | null
  message_type: MessageType
  content: string | null
  form_submission_id: string | null
  workflow_run_id: string | null
  /** Rich-card payload — present when message_type='rich_card'; null/undefined for legacy types. */
  payload?: RichCardPayload | null
  mentions: string[]
  edited_at: string | null
  /** Round-10 — non-null = currently pinned in this context. */
  pinned_at?: string | null
  created_at: string
  // joined
  author?: Profile
  attachments?: ChatAttachment[]
  form_submission?: FormSubmission
  workflow_run?: WorkflowRun
  reactions?: MessageReaction[]
  /** Round-10 follow-up — joined parent message used to render the
   *  Zalo-style quote-snap above a reply bubble. Only the bare fields
   *  needed for the snap are joined. */
  parent?: {
    id: string
    content: string | null
    author_id: string | null
    author?: { full_name: string | null } | null
  } | null
}

// ─── Reminders (Round-10 follow-up) ──────────────────────────────────────────

export interface Reminder {
  id:                  string
  recipient_id:        string
  created_by:          string | null
  title:               string
  fire_at:             string
  source_message_id:   string | null
  source_context_type: 'channel' | 'project' | null
  source_context_id:   string | null
  fired_at:            string | null
  created_at:          string
}

export interface MessageReaction {
  id: string
  message_id: string
  user_id: string
  emoji: string
  created_at: string
}

export interface ChatAttachment {
  id: string
  message_id: string
  file_name: string
  file_url: string
  file_type: string | null
  file_size: number | null
  extracted_text: string | null
  uploaded_at: string
}

// ─── Forms ───────────────────────────────────────────────────────────────────

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'select'        // single-select dropdown
  | 'multi_select'  // multi-select (checkbox group)
  | 'radio'         // single-select (radio group)
  | 'checkbox'      // single boolean

export type ConditionOperator = 'eq' | 'neq' | 'gt' | 'lt'

export interface FieldCondition {
  field_id: string
  operator: ConditionOperator
  value: string
}

export interface FormField {
  id: string
  label: string
  /** Markdown-style helper text shown under the label. Can be paired with attachments. */
  description?: string
  /** URLs for inline images / files attached to the description (paste-image friendly). */
  description_attachments?: string[]
  type: FieldType
  required: boolean
  placeholder?: string
  options?: string[]                 // for select / multi_select / radio
  /** When true, option-based fields show an "Khác (ghi rõ)" free-text field. */
  allow_other?: boolean
  /** When true, the response side renders a comment + attachment box for this field. */
  comment_box?: boolean
  validation?: {
    min?: number
    max?: number
    minLength?: number
  }
  condition?: FieldCondition | null

  // ─── Workflow form fill rules (Phase D, optional) ───────────────────────
  // These only apply when the form is attached to a workflow step. They are
  // ignored entirely for standalone forms (Settings → Lab → Forms).
  /** Which workflow_step.id (template) is responsible for filling this field.
   *  null/undefined ⇒ filled at the step where the form is attached. */
  fill_at_step_id?: string | null
  /** Who within that step fills this field. 'runner' is the default. */
  fill_by_role?: 'runner' | 'approver' | 'specific_user' | null
  /** When fill_by_role='specific_user', the profile.id of that user. */
  fill_by_user_id?: string | null
  /** Lineage marker — when this field was cloned via "Inherit form", points
   *  back to the source field id. Advisory only (no enforcement). */
  inherited_from_field_id?: string | null
}

export interface FormTemplate {
  id: string
  name: string
  description: string | null
  fields: FormField[]
  /** Field IDs to show in the chat-card summary preview (max 3). Added in Phase 1. */
  summary_field_ids: string[]
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface FormSubmission {
  id: string
  template_id: string | null
  template_name: string
  template_snapshot: FormField[]
  submitted_by: string | null
  context_type: ContextType | 'standalone' | null
  context_id: string | null
  data: Record<string, unknown>
  submitted_at: string
  // joined
  submitter?: Profile
}

// ─── Form Drafts ─────────────────────────────────────────────────────────────

/** Per-user work-in-progress form fill — strictly owner-only (RLS). Added Phase 2. */
export interface FormDraft {
  id: string
  user_id: string
  template_id: string | null
  template_name: string
  template_snapshot: FormField[]
  partial_data: Record<string, unknown>
  bot_messages: { role: 'user' | 'assistant'; content: string; created_at: string }[]
  initial_template_id: string | null
  context_type: ContextType | 'standalone' | 'personal' | null
  context_id: string | null
  updated_at: string
  created_at: string
}

// ─── Projects ────────────────────────────────────────────────────────────────

export type ProjectStatus = 'open' | 'in_progress' | 'review' | 'completed' | 'cancelled'

export interface Project {
  id: string
  /** Auto-generated short code, e.g. "D240726". Editable, unique, max 10 chars. */
  code: string | null
  title: string
  slug: string
  description: string | null
  status: ProjectStatus
  assigned_to: string | null
  due_date: string | null
  public_token: string
  portal_username: string | null
  portal_password_hash: string | null
  portal_enabled: boolean
  created_by: string | null
  created_at: string
  updated_at: string
  // joined
  assignee?: Profile
  creator?: { full_name: string | null }
}

/**
 * Activity-feed entry returned by `get_project_activity_feed` RPC. Uses a
 * discriminated `kind` so each event type carries its specific payload.
 */
export type ProjectActivityKind =
  | 'workflow_started' | 'workflow_completed' | 'workflow_cancelled' | 'approval_pending'
  | 'chat_message' | 'file_upload' | 'form_submission'
  | 'project_status_changed' | 'project_created'

export interface ProjectActivityEntry {
  kind: ProjectActivityKind
  created_at: string
  user_id: string | null
  user_name: string | null
  project_id: string
  project_code: string | null
  project_title: string
  /** Human-readable summary line shown in the feed. */
  summary: string
  /** Optional click target — discriminated by what makes sense per kind. */
  target_workflow_run_id?: string | null
  target_chat_message_id?: string | null
  target_chat_channel_id?: string | null
  target_form_submission_id?: string | null
}

/**
 * Internal note / commentary card attached to a project's customer-portal area.
 * Staff-only — never exposed to the customer portal itself.
 */
export interface ProjectInfoCard {
  id: string
  project_id: string
  author_id: string | null
  body_html: string
  created_at: string
  updated_at: string
  // joined
  author?: { full_name: string | null }
}

// ─── Workflow Scheduling ─────────────────────────────────────────────────────

export type RoutineKind = 'daily' | 'weekly' | 'monthly' | 'once'

export type Routine =
  | { kind: 'daily';   at: string; tz?: string }
  | { kind: 'weekly';  at: string; day_of_week: number; tz?: string }
  | { kind: 'monthly'; at: string; day_of_month: number; tz?: string }
  | { kind: 'once';    at: string }

export interface WorkflowSchedule {
  id: string
  template_id: string
  project_id: string | null
  run_by: string | null
  name: string | null
  routine: Routine
  next_run_at: string
  last_run_at: string | null
  enabled: boolean
  created_at: string
  updated_at: string
  // joined
  template?: Pick<WorkflowTemplate, 'id' | 'name'>
  runner?: Profile
  project?: Pick<Project, 'id' | 'title' | 'slug'>
}

export interface ScheduleRunHistoryEntry {
  id: string
  schedule_id: string
  fired_at: string
  run_id: string | null
  status: 'success' | 'error' | 'skipped'
  error_message: string | null
}

// ─── Notifications ───────────────────────────────────────────────────────────

export type NotificationKind =
  | 'mention'
  | 'project_assigned'
  | 'workflow_assigned'
  | 'workflow_completed'
  | 'approval_requested'
  | 'schedule_fired'
  | 'form_submitted'
  | 'doc_shared'
  | 'generic'
  | 'task_assigned'
  | 'task_completed'
  | 'reminder'
  | 'dm_message'

export interface Notification {
  id: string
  user_id: string
  kind: NotificationKind
  title: string
  body: string | null
  link: string | null
  payload: Record<string, unknown> | null
  read_at: string | null
  created_at: string
}

// ─── Documents ───────────────────────────────────────────────────────────────

export interface Document {
  id: string
  name: string
  description: string | null
  file_url: string
  file_name: string
  file_type: string | null
  file_size: number | null
  folder_path: string
  tags: string[]
  project_id: string | null
  uploaded_by: string | null
  created_at: string
  updated_at: string
  // joined
  uploader?: Profile
  project?: Pick<Project, 'id' | 'title' | 'slug'>
}

// ─── Workflow ────────────────────────────────────────────────────────────────

export type StepType = 'simple' | 'branch'
export type RunStatus = 'in_progress' | 'completed' | 'cancelled'

export interface WorkflowTemplate {
  id: string
  name: string
  description: string | null
  /** Rich-text guidance / how-to / common-mistakes notes (HTML). Long-form, shown
   *  in the WorkflowEditPage left panel under meta + Quyền chạy. Optional. */
  guidance_html?: string | null
  is_active: boolean
  helper_panel_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

// ─── Helpers (FAQ / Chatbot) ─────────────────────────────────────────────────

export type HelperType = 'faq' | 'chatbot'

export interface ChatbotConfig {
  system_prompt?: string
  model?: string
  allow_external?: boolean
  /** Free-text knowledge base (markdown). Concatenated into the system prompt at runtime. */
  knowledge_base?: string
  /** Optional context template (Handlebars-like) applied per question. Reserved. */
  context_template?: string
  /** Override API endpoint. Empty = use built-in default (Anthropic). */
  api_endpoint?: string
  /** Name of the env var holding the API key (defaults to LLM_API_KEY). */
  api_key_env?: string
  /** Reserved: workflow / project / ad-hoc scopes. */
  scopes?: string[]
  /** When true, replying to a bot message sends conversation history. Default false. */
  conversation_history_enabled?: boolean
  /** Max Q&A pairs to include in conversation history (1-5). Default 5. */
  conversation_history_pairs?: number
}

export interface AiUsageLog {
  id: string
  created_at: string
  panel_id: string | null
  bot_name: string
  user_id: string | null
  context_type: string | null
  context_id: string | null
  query: string
  reply: string
  model: string | null
}

export interface HelperPanel {
  id: string
  type: HelperType
  name: string
  description: string | null
  config: ChatbotConfig
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface HelperFaqItem {
  id: string
  panel_id: string
  question: string
  answer: string
  order_index: number
  created_at: string
}

export interface WorkflowStep {
  id: string
  template_id: string
  parent_step_id: string | null
  branch_condition: string | null
  title: string
  description: string | null
  step_type: StepType
  branch_options: string[] | null
  order_index: number
  helper_panel_id: string | null
  form_template_id: string | null
  requires_approval: boolean
  approver_user_id: string | null
  approver_role: 'admin' | 'editor' | 'specific_user' | null
  duration_hours: number
  /** Round-5b: conditional show config. Evaluated at runtime by WorkflowRunPanel. */
  show_when?: Record<string, unknown> | null
  created_at: string
  // tree
  children?: WorkflowStep[]
}

export interface WorkflowRunStep {
  id: string
  run_id: string
  source_step_id: string | null
  parent_snapshot_id: string | null
  branch_condition: string | null
  title: string
  description: string | null
  step_type: StepType
  branch_options: string[] | null
  order_index: number
  helper_panel_id: string | null
  form_template_id: string | null
  requires_approval: boolean
  approver_user_id: string | null
  approver_role: 'admin' | 'editor' | 'specific_user' | null
  duration_hours: number
  created_at: string
}

export interface WorkflowRun {
  id: string
  template_id: string | null
  template_name: string
  project_id: string | null
  run_by: string | null
  status: RunStatus
  started_at: string
  completed_at: string | null
  // joined
  runner?: Profile
  project?: Project
  step_results?: WorkflowStepResult[]
}

export interface WorkflowStepResult {
  id: string
  run_id: string
  /** Legacy: FK to workflow_steps.id. Used for runs created before the C2 snapshot migration. */
  step_id: string | null
  /** New: FK to workflow_run_steps.id. Used for runs created after the snapshot migration. */
  snapshot_id: string | null
  is_done: boolean
  branch_selected: string | null
  note: string | null
  form_submission_id: string | null
  done_at: string | null
  approval_status: 'pending' | 'approved' | 'rejected' | null
  approved_by: string | null
  approval_comment: string | null
  approval_at: string | null
}

// ─── Round-9: Quick Tasks (centralized lightweight TODOs) ────────────────────

export type QuickTaskStatus = 'open' | 'done' | 'cancelled'

// Round-10 — Documents tab (folders + notes tree)
export type DocumentNodeType  = 'folder' | 'note'
export type DocumentVisibility = 'private' | 'shared' | 'public'

export interface DocumentNode {
  id:           string
  parent_id:    string | null
  type:         DocumentNodeType
  name:         string
  slug:         string
  content_html: string | null
  created_by:   string
  visibility:   DocumentVisibility
  created_at:   string
  updated_at:   string
}

export interface DocumentShare {
  document_id: string
  user_id:     string
  role:        'viewer' | 'editor'
  granted_at:  string
}

export interface QuickTask {
  id:                 string
  title:              string
  description_html:   string | null
  created_by:         string
  assignee_user_id:   string | null
  assignee_group_id:  string | null
  source_message_id:  string | null
  /** Round-10 — set when the task was created from a project chat or via
   *  the project workspace panel. Filters the project task list. */
  project_id?:        string | null
  status:             QuickTaskStatus
  due_date:           string | null    // ISO date string yyyy-mm-dd
  completed_at:       string | null
  created_at:         string
  updated_at:         string
  // Joined fields (when query selects them)
  creator?:           { full_name: string | null } | null
  assignee_user?:     { full_name: string | null } | null
  assignee_group?:    { name: string | null } | null
}
