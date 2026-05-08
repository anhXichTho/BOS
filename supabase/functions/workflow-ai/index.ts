// Supabase Edge Function: workflow-ai (v2 — round-6)
//
// Multi-stage workflow assistant. Input includes a `stage`:
//   - 'skeleton'  → produce AIWorkflowPatch (replace_all on empty templates)
//   - 'details'   → produce AIWorkflowPatch with modify_steps + form patches,
//                   scoped to focus_step_s_code (or all steps)
//   - 'review'    → produce { rationale, suggestions[] } (NOT a patch)
//
// Persists each (user, assistant) pair to workflow_ai_conversations table
// for the given template_id (one row per template; messages array grows).
//
// Setup:
//   supabase secrets set LLM_API_KEY="sk-ant-..."
//   supabase functions deploy workflow-ai
//   migration_phase_ai_conversation.sql must have run first (#27).

// @ts-expect-error Deno runtime
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
// @ts-expect-error Deno runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
}

// ─── System prompts (per stage) ─────────────────────────────────────────────

const SCHEMA_DOC = `
AIWorkflowPatch JSON shape:
{
  "mode": "replace_all" | "incremental",
  "rationale": "1-2 sentence Vietnamese summary",
  "template_meta"?: { "name"?, "description"?, "guidance_html"? },
  "add_steps"?: [
    {
      "code": "NEW_S1",
      "parent": { "kind": "root" | "code" | "s_code", "value"?: "..." },
      "branch_condition"?: string,
      "title": string,
      "description"?: string,
      "step_type": "simple" | "branch",
      "branch_options"?: ["..."],
      "duration_hours"?: number,
      "requires_approval"?: boolean,
      "approver_role"?: "admin" | "editor" | null,
      "attach_form_code"?: "F1" | "NEW_F1"
    }
  ],
  "modify_steps"?: [
    { "s_code": "S2", "patch": { "title"?, "description"?, "duration_hours"?, "branch_options"?, "requires_approval"?, "approver_role"? } }
  ],
  "remove_step_codes"?: ["S5"],
  "add_forms"?: [
    {
      "code": "NEW_F1",
      "name": string,
      "description"?: string,
      "fields": [
        { "label": string, "type": "text"|"textarea"|"number"|"date"|"select"|"multi_select"|"radio"|"checkbox",
          "required"?: boolean, "options"?: ["..."], "description"?: string }
      ]
    }
  ],
  "modify_forms"?: [
    {
      "f_code": "F1",
      "add_fields"?: [...AIField...],
      "modify_fields"?: [{ "id": "<existing-field-id>", "patch": { ... } }],
      "remove_field_ids"?: ["..."]
    }
  ]
}
`.trim()

const SKELETON_PROMPT = `You are a workflow-template designer for a Vietnamese SME operations platform (BOS).

Your job in SKELETON stage: produce ONLY the high-level structure (steps, ordering, branches). Do NOT add forms, descriptions longer than one sentence, or per-step details — those come in the next stage.

${SCHEMA_DOC}

Rules:
1. Empty template ⇒ mode="replace_all". Existing template ⇒ mode="incremental" (minimise scope).
2. Vietnamese titles. Concrete + short (≤ 60 chars).
3. For branches, always provide branch_options (≥ 2). Each child of a branch MUST set branch_condition matching one of the options.
4. duration_hours defaults to 3 if you omit it.
5. Output JSON only. No markdown fences.`

const DETAILS_PROMPT = `You are filling in DETAILS for a workflow template (Vietnamese SME platform).

You are in a CONVERSATIONAL loop. Each turn must produce a CONCRETE PATCH — not just advice. The user sees changes in a right-side preview; empty patches make them think the assistant is broken.

═══ INHERIT EXISTING WORK — DO NOT OVERWRITE ═══
The request payload includes the CURRENT state of every step (description, duration_hours, requires_approval, attached_form_code). Read it carefully:
- If a field already has a meaningful value, leave it alone unless the user explicitly asks to change it.
- Build on top of existing work rather than replacing it.
- Example: if S1 already has description "Nhận đơn từ KH" and user asks "thêm form thu thập SĐT", you produce a modify_steps for S1 with attach_form_code only — do NOT rewrite the description.

═══ FORM RE-USE POLICY (priority order) ═══
1. Reuse: if an existing form (F1, F2…) covers ≥ 80% of the data needs, attach via attach_form_code.
2. Edit: if existing form covers 50-80%, use modify_forms to add missing fields, then attach.
3. Create: only when nothing relevant exists, use add_forms with NEW_F{N} code.

You receive the FULL field listing of every existing form — read before deciding.

═══ FIELD TYPES (canonical) ═══
Use ONLY: "text" | "textarea" | "number" | "date" | "select" | "multi_select" | "radio" | "checkbox"
NOT: long_text, file, email, phone, image, signature — those will be coerced or rejected.

═══ Each turn SHOULD produce at least one of ═══
- modify_steps[].patch.description (concrete, prose, ≤ 200 chars; only if not already filled or user asks to change)
- modify_steps[].patch.duration_hours (realistic: short check = 1, normal task = 3, complex = 8)
- modify_steps[].patch.requires_approval + approver_role
- modify_steps[].patch.branch_options (refining a branch)
- attach_form_code on modify_steps (existing F{N} or NEW_F{N})

${SCHEMA_DOC}

Rules:
1. Always mode="incremental".
2. PRODUCE A NON-EMPTY PATCH unless the user is asking a clarifying question.
3. Vietnamese descriptions. Concrete and concise.
4. When add_forms creates a new form, give it 2-7 fields max — focused on what THIS step actually captures.
5. Reference existing items by their S{N} / F{N} codes from the request payload.
6. For "parent" in add_steps: kind="code" for forward refs to other add_steps; kind="s_code" for existing steps; kind="root" for top-level.
7. Output JSON only.`

const REVIEW_PROMPT = `You are reviewing a Vietnamese workflow template.

You MAY produce TWO valid output shapes, depending on user intent:

(A) When the user asks for a SUMMARY/REVIEW (e.g. "tổng kết", "review", "kiểm tra", "có thiếu gì"):
{
  "rationale": "1-2 sentence overall assessment in Vietnamese",
  "suggestions": ["concrete suggestion #1", "concrete suggestion #2", ...]
}

(B) When the user asks for a CONCRETE CHANGE (e.g. "xoá bước S3", "bớt bước trùng", "thêm bước duyệt"):
${SCHEMA_DOC}

Rules:
1. Choose shape based on user intent. If they ask for a change, RETURN A PATCH (shape B). If they ask for review, return summary (shape A).
2. For shape A: 3-6 suggestions max. Most actionable first. Flag steps without duration, branches without conditions, forms without fields, branches with no children, missing approver on long-running steps.
3. For shape B: always mode="incremental". Reference existing items by S{N}/F{N}.
4. Vietnamese.
5. Output JSON only — no prose, no markdown fences.`

// ─── Request shape ──────────────────────────────────────────────────────────

interface RequestBody {
  user_prompt: string
  stage: 'skeleton' | 'details' | 'review'
  focus_step_s_code?: string
  template_id?: string
  current_template?: {
    name?: string
    description?: string | null
    guidance_html?: string | null
  }
  current_steps_with_codes?: Array<{
    s_code: string
    title: string
    step_type: 'simple' | 'branch'
    branch_options?: string[]
    parent_s_code?: string | null
    branch_condition?: string | null
    requires_approval?: boolean
    approver_role?: 'admin' | 'editor' | null
    duration_hours?: number
    description?: string | null
    attached_form_code?: string | null
  }>
  current_forms_with_codes_full?: Array<{
    f_code: string
    name: string
    description?: string
    fields: Array<{
      id: string
      label: string
      type: string
      required?: boolean
      options?: string[]
    }>
  }>
  conversation_history?: Array<{ role: 'user' | 'assistant'; stage: string; content: string }>
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = (await req.json()) as RequestBody
    if (!body?.user_prompt || typeof body.user_prompt !== 'string') {
      return json({ error: 'user_prompt is required' }, 400)
    }
    const stage = body.stage ?? 'skeleton'
    if (stage !== 'skeleton' && stage !== 'details' && stage !== 'review') {
      return json({ error: `stage must be skeleton|details|review, got: ${stage}` }, 400)
    }

    // @ts-expect-error Deno runtime
    const apiKey = Deno.env.get('LLM_API_KEY')
    if (!apiKey) {
      return json({ error: 'LLM_API_KEY not set on the edge function.' }, 500)
    }

    const sysPrompt = stage === 'skeleton' ? SKELETON_PROMPT
                    : stage === 'details'  ? DETAILS_PROMPT
                    : REVIEW_PROMPT

    const userMsg = buildUserMessage(body, stage)

    const raw = await callAnthropic(apiKey, sysPrompt, 'claude-haiku-4-5', userMsg)
    const parsed = tryParseJSON(raw)
    if (!parsed) {
      return json({ error: 'AI response was not valid JSON.', raw_response: raw.slice(0, 600) }, 400)
    }

    // Round-7c: detect response shape from the parsed object.
    //   - has 'mode' field           → patch (AIWorkflowPatch)
    //   - has 'suggestions' field    → review summary
    //   - else                        → schema error
    // This lets the Review stage return EITHER shape based on user intent.
    const response: Record<string, unknown> = { raw_response: raw }
    const looksLikePatch    = isObject(parsed) && (parsed as Record<string, unknown>).mode !== undefined
    const looksLikeSummary  = isObject(parsed) && Array.isArray((parsed as Record<string, unknown>).suggestions)

    if (looksLikePatch) {
      const r = validateAIWorkflowPatch(parsed)
      if ('error' in r) {
        return json({ error: `Patch schema invalid: ${r.error}`, raw_response: raw.slice(0, 600) }, 400)
      }
      response.patch = r.ok
      response.next_suggestion = nextSuggestionFor(stage, r.ok, body)
    } else if (looksLikeSummary) {
      const r = validateReviewSummary(parsed)
      if ('error' in r) {
        return json({ error: `Review schema invalid: ${r.error}`, raw_response: raw.slice(0, 600) }, 400)
      }
      response.summary = r.ok
      response.next_suggestion = 'Bạn đã review xong — đóng modal và bấm Lưu nghiệp vụ.'
    } else {
      return json({
        error: 'AI response did not match patch or summary schema.',
        raw_response: raw.slice(0, 600),
      }, 400)
    }

    // Persist conversation (best-effort — never fail the request if log fails).
    if (body.template_id) {
      try {
        await persistConversation(body.template_id, body, raw, stage)
      } catch (logErr) {
        console.warn('[workflow-ai] conversation persist failed:', logErr)
      }
    }

    return json(response)
  } catch (err) {
    console.error('[workflow-ai] error:', err)
    return json({ error: (err as Error).message }, 500)
  }
})

// ─── User message builder ───────────────────────────────────────────────────

function buildUserMessage(body: RequestBody, stage: string): string {
  const lines: string[] = []
  lines.push(`STAGE: ${stage}`)
  if (body.focus_step_s_code) {
    lines.push(`FOCUS STEP: ${body.focus_step_s_code}`)
  }
  lines.push('')
  lines.push(`User prompt: ${body.user_prompt}`)
  lines.push('')

  if (body.current_template) {
    lines.push('Template meta:')
    lines.push(`  name: ${body.current_template.name ?? '(empty)'}`)
    lines.push(`  description: ${body.current_template.description ?? '(empty)'}`)
    lines.push(`  guidance_html length: ${(body.current_template.guidance_html ?? '').length} chars`)
    lines.push('')
  }

  if (body.current_steps_with_codes?.length) {
    lines.push('Current steps (with current state):')
    for (const s of body.current_steps_with_codes) {
      const parent = s.parent_s_code ? `parent=${s.parent_s_code}${s.branch_condition ? `[${s.branch_condition}]` : ''}` : 'root'
      const form   = s.attached_form_code ? ` form=${s.attached_form_code}` : ''
      const dur    = s.duration_hours ? ` ${s.duration_hours}h` : ''
      const opts   = s.branch_options ? ` opts=[${s.branch_options.join('|')}]` : ''
      const appr   = s.requires_approval ? ` approval=${s.approver_role ?? '?'}` : ''
      const desc   = s.description ? ` "${(s.description ?? '').slice(0, 60)}"` : ''
      lines.push(`  ${s.s_code} (${s.step_type}) "${s.title}" ${parent}${dur}${appr}${opts}${form}${desc}`)
    }
    lines.push('')
  } else {
    lines.push('Current steps: (template is empty)')
    lines.push('')
  }

  if (body.current_forms_with_codes_full?.length) {
    lines.push('Current forms — FULL field listing (use this to decide reuse / edit / create):')
    for (const f of body.current_forms_with_codes_full) {
      lines.push(`  ${f.f_code} "${f.name}"${f.description ? ` — ${f.description}` : ''}`)
      for (const fld of f.fields) {
        const opts = fld.options?.length ? ` [${fld.options.join('|')}]` : ''
        lines.push(`    · field id=${fld.id} label="${fld.label}" type=${fld.type}${fld.required ? ' required' : ''}${opts}`)
      }
    }
    lines.push('')
  }

  if (body.conversation_history?.length) {
    lines.push(`Conversation so far (last ${body.conversation_history.length} turns):`)
    for (const t of body.conversation_history) {
      lines.push(`  [${t.role}|${t.stage}] ${t.content.slice(0, 200)}`)
    }
    lines.push('')
  }

  lines.push(`Output ONLY the JSON object (per the system prompt for stage "${stage}").`)
  return lines.join('\n')
}

function nextSuggestionFor(stage: string, patch: { add_steps?: unknown[] }, body: RequestBody): string {
  if (stage === 'skeleton') {
    const addedCount = (patch.add_steps as unknown[] | undefined)?.length ?? 0
    if (addedCount > 0) {
      return `Đi tiếp → fill chi tiết cho từng bước (mô tả, form, thời gian).`
    }
    return 'Đi tiếp → cấu hình chi tiết các bước hiện có.'
  }
  if (stage === 'details') {
    const filled = body.current_steps_with_codes?.filter(s => s.description && s.duration_hours).length ?? 0
    const total  = body.current_steps_with_codes?.length ?? 0
    if (filled < total) return `Còn ${total - filled} bước thiếu chi tiết — tiếp tục với bước kế tiếp.`
    return 'Đi tiếp → review tổng thể workflow.'
  }
  return 'Hoàn tất.'
}

// ─── Anthropic call ─────────────────────────────────────────────────────────

async function callAnthropic(apiKey: string, system: string, model: string, userText: string): Promise<string> {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: userText }],
    }),
  })
  if (!r.ok) {
    const detail = await r.text()
    throw new Error(`Anthropic error ${r.status}: ${detail.slice(0, 300)}`)
  }
  const data = await r.json()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data.content ?? []).map((c: any) => c.text ?? '').join('').trim()
}

function tryParseJSON(raw: string): unknown {
  try { return JSON.parse(raw) } catch { /* fall through */ }
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()) } catch { /* fall through */ }
  }
  const first = raw.indexOf('{')
  const last  = raw.lastIndexOf('}')
  if (first !== -1 && last > first) {
    try { return JSON.parse(raw.slice(first, last + 1)) } catch { /* fall through */ }
  }
  return null
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  })
}

// ─── Conversation persistence ───────────────────────────────────────────────

async function persistConversation(
  templateId: string,
  body: RequestBody,
  rawAssistantResponse: string,
  stage: string,
) {
  // @ts-expect-error Deno runtime
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  // @ts-expect-error Deno runtime
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const db = createClient(supabaseUrl, serviceKey)

  // Read existing row (if any).
  const { data: existing } = await db
    .from('workflow_ai_conversations')
    .select('id, messages')
    .eq('template_id', templateId)
    .maybeSingle()

  const userTurn = {
    role: 'user',
    stage,
    content: body.user_prompt,
    focus_s_code: body.focus_step_s_code ?? null,
    created_at: new Date().toISOString(),
  }
  const assistantTurn = {
    role: 'assistant',
    stage,
    content: rawAssistantResponse.slice(0, 4000), // trim long payloads
    created_at: new Date().toISOString(),
  }

  if (existing) {
    const messages = Array.isArray(existing.messages) ? existing.messages : []
    const next = [...messages, userTurn, assistantTurn].slice(-50)  // keep last 50 turns
    await db
      .from('workflow_ai_conversations')
      .update({ messages: next, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
  } else {
    await db
      .from('workflow_ai_conversations')
      .insert({
        template_id: templateId,
        messages: [userTurn, assistantTurn],
      })
  }
}

// ─── Schema validators ──────────────────────────────────────────────────────

type Result<T> = { ok: T } | { error: string }

interface AIWorkflowPatch {
  mode: 'replace_all' | 'incremental'
  rationale: string
  template_meta?: { name?: string; description?: string; guidance_html?: string }
  add_steps?: Array<Record<string, unknown>>
  modify_steps?: Array<Record<string, unknown>>
  remove_step_codes?: string[]
  add_forms?: Array<Record<string, unknown>>
  modify_forms?: Array<Record<string, unknown>>
}

interface ReviewSummary {
  rationale: string
  suggestions: string[]
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}
function isStringArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every(v => typeof v === 'string')
}

function validateAIWorkflowPatch(x: unknown): Result<AIWorkflowPatch> {
  if (!isObject(x)) return { error: 'response must be object' }
  if (x.mode !== 'replace_all' && x.mode !== 'incremental') return { error: 'mode invalid' }
  if (typeof x.rationale !== 'string') return { error: 'rationale must be string' }

  if (x.add_steps !== undefined) {
    if (!Array.isArray(x.add_steps)) return { error: 'add_steps must be array' }
    for (let i = 0; i < x.add_steps.length; i++) {
      const s = x.add_steps[i]
      if (!isObject(s)) return { error: `add_steps[${i}] must be object` }
      if (typeof s.code !== 'string' || !s.code) return { error: `add_steps[${i}].code missing` }
      if (typeof s.title !== 'string') return { error: `add_steps[${i}].title not string` }
      if (s.step_type !== 'simple' && s.step_type !== 'branch') return { error: `add_steps[${i}].step_type bad` }
      if (!isObject(s.parent)) return { error: `add_steps[${i}].parent missing` }
      const k = (s.parent as Record<string, unknown>).kind
      if (k !== 'root' && k !== 'code' && k !== 's_code') return { error: `add_steps[${i}].parent.kind bad` }
      if ((k === 'code' || k === 's_code') && typeof (s.parent as Record<string, unknown>).value !== 'string') {
        return { error: `add_steps[${i}].parent.value missing` }
      }
    }
  }

  if (x.modify_steps !== undefined) {
    if (!Array.isArray(x.modify_steps)) return { error: 'modify_steps must be array' }
    for (let i = 0; i < x.modify_steps.length; i++) {
      const m = x.modify_steps[i]
      if (!isObject(m)) return { error: `modify_steps[${i}] must be object` }
      if (typeof m.s_code !== 'string' || !/^S\d+$/.test(m.s_code)) return { error: `modify_steps[${i}].s_code bad` }
      if (!isObject(m.patch)) return { error: `modify_steps[${i}].patch must be object` }
    }
  }

  if (x.remove_step_codes !== undefined) {
    if (!isStringArray(x.remove_step_codes)) return { error: 'remove_step_codes must be string[]' }
    if (!x.remove_step_codes.every(c => /^S\d+$/.test(c))) return { error: 'remove_step_codes entries bad' }
  }

  if (x.add_forms !== undefined) {
    if (!Array.isArray(x.add_forms)) return { error: 'add_forms must be array' }
    for (let i = 0; i < x.add_forms.length; i++) {
      const f = x.add_forms[i]
      if (!isObject(f)) return { error: `add_forms[${i}] must be object` }
      if (typeof f.code !== 'string' || !f.code) return { error: `add_forms[${i}].code missing` }
      if (typeof f.name !== 'string') return { error: `add_forms[${i}].name not string` }
      if (!Array.isArray(f.fields)) return { error: `add_forms[${i}].fields must be array` }
      // Coerce field type synonyms server-side too so older clients with
      // a stricter validator don't reject the patch.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(f.fields as any[]).forEach((fld) => {
        if (fld && typeof fld.type === 'string') {
          fld.type = coerceFieldType(fld.type) ?? fld.type
        }
      })
    }
  }

  if (x.modify_forms !== undefined) {
    if (!Array.isArray(x.modify_forms)) return { error: 'modify_forms must be array' }
    for (let i = 0; i < x.modify_forms.length; i++) {
      const f = x.modify_forms[i]
      if (!isObject(f)) return { error: `modify_forms[${i}] must be object` }
      if (typeof f.f_code !== 'string' || !/^F\d+$/.test(f.f_code)) return { error: `modify_forms[${i}].f_code bad` }
      // Coerce field type synonyms inside add_fields / modify_fields.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ff = f as any
      if (Array.isArray(ff.add_fields)) {
        ff.add_fields.forEach((fld: { type?: string }) => {
          if (fld && typeof fld.type === 'string') fld.type = coerceFieldType(fld.type) ?? fld.type
        })
      }
      if (Array.isArray(ff.modify_fields)) {
        ff.modify_fields.forEach((m: { patch?: { type?: string } }) => {
          if (m?.patch && typeof m.patch.type === 'string') m.patch.type = coerceFieldType(m.patch.type) ?? m.patch.type
        })
      }
    }
  }

  return { ok: x as AIWorkflowPatch }
}

/** Coerce common AI synonyms to the canonical FieldType enum. */
function coerceFieldType(raw: string): string | null {
  const valid = ['text', 'textarea', 'number', 'date', 'select', 'multi_select', 'radio', 'checkbox']
  const t = raw.toLowerCase().trim()
  if (valid.includes(t)) return t
  switch (t) {
    case 'long_text': case 'longtext': case 'paragraph': case 'multiline': case 'long':
      return 'textarea'
    case 'email': case 'phone': case 'tel': case 'url': case 'string': case 'short_text': case 'shorttext':
      return 'text'
    case 'integer': case 'int': case 'float': case 'decimal': case 'currency': case 'money':
      return 'number'
    case 'datetime': case 'date_time': case 'time':
      return 'date'
    case 'dropdown': case 'singleselect': case 'single_select':
      return 'select'
    case 'multiselect': case 'tags': case 'multi':
      return 'multi_select'
    case 'bool': case 'boolean': case 'yesno': case 'yes_no':
      return 'checkbox'
    case 'file': case 'upload': case 'attachment': case 'image': case 'photo': case 'signature':
      return 'text'
    default:
      return null
  }
}

function validateReviewSummary(x: unknown): Result<ReviewSummary> {
  if (!isObject(x)) return { error: 'response must be object' }
  if (typeof x.rationale !== 'string') return { error: 'rationale must be string' }
  if (!isStringArray(x.suggestions)) return { error: 'suggestions must be string[]' }
  return { ok: { rationale: x.rationale, suggestions: x.suggestions } }
}
