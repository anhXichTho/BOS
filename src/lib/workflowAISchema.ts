/**
 * AIWorkflowPatch — structured-output contract for the workflow AI assistant.
 *
 * Round-5 Phase D + Round-6 form intelligence. The AI never sees raw uuids —
 * it addresses existing steps by their derived S{N} codes and existing forms
 * by F{N} codes (see components/workflow-edit/codes.ts). New steps in
 * `add_steps[]` get caller-supplied `code` strings (e.g. "NEW_S1") that other
 * entries in the same patch can reference as parents. New forms in
 * `add_forms[]` use NEW_F{N} codes that `attach_form_code` can reference.
 *
 * Both client AND edge function validate via the same hand-rolled validator
 * below — keeping zod out of the bundle.
 */

export type StepKind = 'simple' | 'branch'
export type ApproverRole = 'admin' | 'editor'

export type AddStepParent =
  | { kind: 'code';   value: string }     // refs another add_steps[].code
  | { kind: 's_code'; value: string }     // refs an existing step's S{N}
  | { kind: 'root' }

export interface AIAddStep {
  code: string                            // unique within this response (e.g. "NEW_S1")
  parent: AddStepParent
  branch_condition?: string | null        // when parent is a branch
  title: string
  description?: string
  step_type: StepKind
  branch_options?: string[]               // when step_type='branch'
  duration_hours?: number
  requires_approval?: boolean
  approver_role?: ApproverRole | null
  attach_form_code?: string               // F{N} of an existing or new form
}

export interface AIModifyStep {
  s_code: string                          // S{N} of the step to modify
  patch: Partial<{
    title: string
    description: string
    duration_hours: number
    branch_options: string[]
    requires_approval: boolean
    approver_role: ApproverRole | null
    /** Round-7i: attach_form_code inside modify_steps.patch lets AI say
     *  "attach this form to that step". Either an existing F{N} or a
     *  NEW_F{N} from add_forms in the same patch. The previous validator
     *  silently dropped this key, so AI's "đã gắn form F1" responses ran
     *  as no-ops — the form attachment never persisted. */
    attach_form_code: string
  }>
}

export interface AIWorkflowPatch {
  mode: 'replace_all' | 'incremental'
  rationale: string
  template_meta?: {
    name?: string
    description?: string
    guidance_html?: string
  }
  add_steps?: AIAddStep[]
  modify_steps?: AIModifyStep[]
  remove_step_codes?: string[]
  /** Round-6: new forms the AI wants to create (referenced by NEW_F{N} codes). */
  add_forms?: AIAddForm[]
  /** Round-6: edits to existing forms (add/modify/remove fields in fields jsonb). */
  modify_forms?: AIModifyForm[]
}

// ─── Round-6: form-related types ────────────────────────────────────────────

/**
 * Must match `FieldType` in src/types/index.ts. The AI sometimes emits
 * synonyms (long_text, paragraph, email, file, time) which we coerce in
 * the validator instead of rejecting.
 */
export type AIFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'select'
  | 'multi_select'
  | 'radio'
  | 'checkbox'

export interface AIField {
  /** Existing field id when used inside modify_fields; omitted for new fields. */
  id?: string
  label: string
  type: AIFieldType
  required?: boolean
  /** For select / multi_select / radio. */
  options?: string[]
  description?: string
}

export interface AIAddForm {
  /** Unique within this response (e.g. "NEW_F1"). Referenced by attach_form_code. */
  code: string
  name: string
  description?: string
  fields: AIField[]
}

export interface AIModifyForm {
  /** Existing F{N} code. */
  f_code: string
  add_fields?: AIField[]
  modify_fields?: Array<{ id: string; patch: Partial<AIField> }>
  remove_field_ids?: string[]
}

// ─── Validator ──────────────────────────────────────────────────────────────

type Result<T> = { ok: T } | { error: string }

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function isStringArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every(v => typeof v === 'string')
}

function validateAddStepParent(p: unknown, ctx: string): Result<AddStepParent> {
  if (!isObject(p)) return { error: `${ctx}.parent must be object` }
  const kind = p.kind
  if (kind === 'root') return { ok: { kind: 'root' } }
  if (kind === 'code' || kind === 's_code') {
    if (typeof p.value !== 'string' || !p.value.trim()) {
      return { error: `${ctx}.parent.value must be non-empty string` }
    }
    return { ok: { kind, value: p.value } }
  }
  return { error: `${ctx}.parent.kind must be 'root' | 'code' | 's_code'` }
}

function validateAddStep(s: unknown, ctx: string): Result<AIAddStep> {
  if (!isObject(s)) return { error: `${ctx} must be object` }
  if (typeof s.code !== 'string' || !s.code.trim()) return { error: `${ctx}.code missing` }
  if (typeof s.title !== 'string') return { error: `${ctx}.title must be string` }
  if (s.step_type !== 'simple' && s.step_type !== 'branch') {
    return { error: `${ctx}.step_type must be 'simple' | 'branch'` }
  }
  const parentRes = validateAddStepParent(s.parent, ctx)
  if ('error' in parentRes) return parentRes

  const out: AIAddStep = {
    code: s.code,
    parent: parentRes.ok,
    title: s.title,
    step_type: s.step_type,
  }
  if (s.description != null) {
    if (typeof s.description !== 'string') return { error: `${ctx}.description must be string` }
    out.description = s.description
  }
  if (s.branch_condition !== undefined) {
    if (s.branch_condition !== null && typeof s.branch_condition !== 'string') {
      return { error: `${ctx}.branch_condition must be string or null` }
    }
    out.branch_condition = s.branch_condition as string | null
  }
  if (s.branch_options !== undefined) {
    if (!isStringArray(s.branch_options)) return { error: `${ctx}.branch_options must be string[]` }
    out.branch_options = s.branch_options
  }
  if (s.duration_hours !== undefined) {
    if (typeof s.duration_hours !== 'number' || s.duration_hours <= 0) {
      return { error: `${ctx}.duration_hours must be positive number` }
    }
    out.duration_hours = s.duration_hours
  }
  if (s.requires_approval !== undefined) {
    if (typeof s.requires_approval !== 'boolean') return { error: `${ctx}.requires_approval must be bool` }
    out.requires_approval = s.requires_approval
  }
  if (s.approver_role !== undefined) {
    if (s.approver_role !== null && s.approver_role !== 'admin' && s.approver_role !== 'editor') {
      return { error: `${ctx}.approver_role must be 'admin' | 'editor' | null` }
    }
    out.approver_role = s.approver_role as ApproverRole | null
  }
  if (s.attach_form_code !== undefined) {
    if (typeof s.attach_form_code !== 'string') return { error: `${ctx}.attach_form_code must be string` }
    out.attach_form_code = s.attach_form_code
  }
  return { ok: out }
}

function validateModifyStep(m: unknown, ctx: string): Result<AIModifyStep> {
  if (!isObject(m)) return { error: `${ctx} must be object` }
  if (typeof m.s_code !== 'string' || !/^S\d+$/.test(m.s_code)) {
    return { error: `${ctx}.s_code must match /^S\\d+$/` }
  }
  if (!isObject(m.patch)) return { error: `${ctx}.patch must be object` }

  const patch: AIModifyStep['patch'] = {}
  const p = m.patch
  if (p.title !== undefined)              { if (typeof p.title !== 'string') return { error: `${ctx}.patch.title not string` };           patch.title = p.title }
  if (p.description !== undefined)        { if (typeof p.description !== 'string') return { error: `${ctx}.patch.description not string` }; patch.description = p.description }
  if (p.duration_hours !== undefined)     { if (typeof p.duration_hours !== 'number') return { error: `${ctx}.patch.duration_hours not num` }; patch.duration_hours = p.duration_hours }
  if (p.branch_options !== undefined)     { if (!isStringArray(p.branch_options)) return { error: `${ctx}.patch.branch_options not string[]` }; patch.branch_options = p.branch_options }
  if (p.requires_approval !== undefined)  { if (typeof p.requires_approval !== 'boolean') return { error: `${ctx}.patch.requires_approval not bool` }; patch.requires_approval = p.requires_approval }
  if (p.approver_role !== undefined) {
    if (p.approver_role !== null && p.approver_role !== 'admin' && p.approver_role !== 'editor') {
      return { error: `${ctx}.patch.approver_role bad` }
    }
    patch.approver_role = p.approver_role as ApproverRole | null
  }
  // Round-7i: previously the validator silently dropped attach_form_code
  // here because it wasn't in the allowlist — meaning AI's "gắn form F1"
  // patches were applied as no-ops. Now we accept the key and downstream
  // applyPatchToDraft handles the F-code → form_template_id resolution.
  if (p.attach_form_code !== undefined) {
    if (p.attach_form_code !== null && typeof p.attach_form_code !== 'string') {
      return { error: `${ctx}.patch.attach_form_code must be string or null` }
    }
    patch.attach_form_code = p.attach_form_code as string
  }
  return { ok: { s_code: m.s_code, patch } }
}

export function validateAIWorkflowPatch(x: unknown): Result<AIWorkflowPatch> {
  if (!isObject(x)) return { error: 'response must be object' }
  if (x.mode !== 'replace_all' && x.mode !== 'incremental') {
    return { error: "mode must be 'replace_all' | 'incremental'" }
  }
  if (typeof x.rationale !== 'string') return { error: 'rationale must be string' }

  const out: AIWorkflowPatch = { mode: x.mode, rationale: x.rationale }

  if (x.template_meta !== undefined) {
    if (!isObject(x.template_meta)) return { error: 'template_meta must be object' }
    out.template_meta = {}
    if (x.template_meta.name != null)           out.template_meta.name           = String(x.template_meta.name)
    if (x.template_meta.description != null)    out.template_meta.description    = String(x.template_meta.description)
    if (x.template_meta.guidance_html != null)  out.template_meta.guidance_html  = String(x.template_meta.guidance_html)
  }

  if (x.add_steps !== undefined) {
    if (!Array.isArray(x.add_steps)) return { error: 'add_steps must be array' }
    const arr: AIAddStep[] = []
    for (let i = 0; i < x.add_steps.length; i++) {
      const r = validateAddStep(x.add_steps[i], `add_steps[${i}]`)
      if ('error' in r) return r
      arr.push(r.ok)
    }
    out.add_steps = arr
  }

  if (x.modify_steps !== undefined) {
    if (!Array.isArray(x.modify_steps)) return { error: 'modify_steps must be array' }
    const arr: AIModifyStep[] = []
    for (let i = 0; i < x.modify_steps.length; i++) {
      const r = validateModifyStep(x.modify_steps[i], `modify_steps[${i}]`)
      if ('error' in r) return r
      arr.push(r.ok)
    }
    out.modify_steps = arr
  }

  if (x.remove_step_codes !== undefined) {
    if (!isStringArray(x.remove_step_codes)) return { error: 'remove_step_codes must be string[]' }
    if (!x.remove_step_codes.every(c => /^S\d+$/.test(c))) {
      return { error: 'remove_step_codes entries must match /^S\\d+$/' }
    }
    out.remove_step_codes = x.remove_step_codes
  }

  // Round-6: form add/modify
  if (x.add_forms !== undefined) {
    if (!Array.isArray(x.add_forms)) return { error: 'add_forms must be array' }
    const arr: AIAddForm[] = []
    for (let i = 0; i < x.add_forms.length; i++) {
      const r = validateAddForm(x.add_forms[i], `add_forms[${i}]`)
      if ('error' in r) return r
      arr.push(r.ok)
    }
    out.add_forms = arr
  }

  if (x.modify_forms !== undefined) {
    if (!Array.isArray(x.modify_forms)) return { error: 'modify_forms must be array' }
    const arr: AIModifyForm[] = []
    for (let i = 0; i < x.modify_forms.length; i++) {
      const r = validateModifyForm(x.modify_forms[i], `modify_forms[${i}]`)
      if ('error' in r) return r
      arr.push(r.ok)
    }
    out.modify_forms = arr
  }

  return { ok: out }
}

// ─── Round-6 form validators ────────────────────────────────────────────────

const VALID_FIELD_TYPES: AIFieldType[] = [
  'text', 'textarea', 'number', 'date',
  'select', 'multi_select', 'radio', 'checkbox',
]

/**
 * AI sometimes emits synonyms — coerce to the closest valid type.
 * Returns null if the type is too foreign to be useful (e.g. 'signature').
 */
function coerceFieldType(raw: string): AIFieldType | null {
  const t = raw.toLowerCase().trim()
  if ((VALID_FIELD_TYPES as string[]).includes(t)) return t as AIFieldType
  // Common synonyms
  switch (t) {
    case 'long_text':
    case 'longtext':
    case 'paragraph':
    case 'multiline':
    case 'long':
      return 'textarea'
    case 'email':
    case 'phone':
    case 'tel':
    case 'url':
    case 'string':
    case 'short_text':
    case 'shorttext':
      return 'text'
    case 'integer':
    case 'int':
    case 'float':
    case 'decimal':
    case 'currency':
    case 'money':
      return 'number'
    case 'datetime':
    case 'date_time':
    case 'time':
      return 'date'
    case 'dropdown':
    case 'singleselect':
    case 'single_select':
      return 'select'
    case 'multiselect':
    case 'tags':
    case 'multi':
      return 'multi_select'
    case 'bool':
    case 'boolean':
    case 'yesno':
    case 'yes_no':
      return 'checkbox'
    case 'file':
    case 'upload':
    case 'attachment':
    case 'image':
    case 'photo':
    case 'signature':
      // Forms don't have a file field — fall back to text with a note.
      return 'text'
    default:
      return null
  }
}

function validateAIField(f: unknown, ctx: string): Result<AIField> {
  if (!isObject(f)) return { error: `${ctx} must be object` }
  if (typeof f.label !== 'string') return { error: `${ctx}.label must be string` }
  if (typeof f.type !== 'string') return { error: `${ctx}.type must be string` }
  const coerced = coerceFieldType(f.type)
  if (!coerced) {
    return { error: `${ctx}.type "${f.type}" is not supported. Use one of: ${VALID_FIELD_TYPES.join('|')}` }
  }
  const out: AIField = { label: f.label, type: coerced }
  if (f.id !== undefined && typeof f.id === 'string') out.id = f.id
  if (f.required !== undefined) {
    if (typeof f.required !== 'boolean') return { error: `${ctx}.required not bool` }
    out.required = f.required
  }
  if (f.options !== undefined) {
    if (!isStringArray(f.options)) return { error: `${ctx}.options must be string[]` }
    out.options = f.options
  }
  if (f.description !== undefined) {
    if (typeof f.description !== 'string') return { error: `${ctx}.description not string` }
    out.description = f.description
  }
  return { ok: out }
}

function validateAddForm(x: unknown, ctx: string): Result<AIAddForm> {
  if (!isObject(x)) return { error: `${ctx} must be object` }
  if (typeof x.code !== 'string' || !x.code) return { error: `${ctx}.code missing` }
  if (typeof x.name !== 'string') return { error: `${ctx}.name must be string` }
  if (!Array.isArray(x.fields)) return { error: `${ctx}.fields must be array` }
  const fields: AIField[] = []
  for (let i = 0; i < x.fields.length; i++) {
    const r = validateAIField(x.fields[i], `${ctx}.fields[${i}]`)
    if ('error' in r) return r
    fields.push(r.ok)
  }
  const out: AIAddForm = { code: x.code, name: x.name, fields }
  if (x.description !== undefined) {
    if (typeof x.description !== 'string') return { error: `${ctx}.description not string` }
    out.description = x.description
  }
  return { ok: out }
}

function validateModifyForm(x: unknown, ctx: string): Result<AIModifyForm> {
  if (!isObject(x)) return { error: `${ctx} must be object` }
  if (typeof x.f_code !== 'string' || !/^F\d+$/.test(x.f_code)) {
    return { error: `${ctx}.f_code must match /^F\\d+$/` }
  }
  const out: AIModifyForm = { f_code: x.f_code }
  if (x.add_fields !== undefined) {
    if (!Array.isArray(x.add_fields)) return { error: `${ctx}.add_fields must be array` }
    const arr: AIField[] = []
    for (let i = 0; i < x.add_fields.length; i++) {
      const r = validateAIField(x.add_fields[i], `${ctx}.add_fields[${i}]`)
      if ('error' in r) return r
      arr.push(r.ok)
    }
    out.add_fields = arr
  }
  if (x.modify_fields !== undefined) {
    if (!Array.isArray(x.modify_fields)) return { error: `${ctx}.modify_fields must be array` }
    const arr: Array<{ id: string; patch: Partial<AIField> }> = []
    for (let i = 0; i < x.modify_fields.length; i++) {
      const m = x.modify_fields[i]
      if (!isObject(m)) return { error: `${ctx}.modify_fields[${i}] must be object` }
      if (typeof m.id !== 'string' || !m.id) return { error: `${ctx}.modify_fields[${i}].id missing` }
      if (!isObject(m.patch)) return { error: `${ctx}.modify_fields[${i}].patch must be object` }
      // Coerce synonyms in the patch's `type` field if present.
      const patchOut = { ...(m.patch as Record<string, unknown>) }
      if (typeof patchOut.type === 'string') {
        const coerced = coerceFieldType(patchOut.type)
        if (!coerced) return { error: `${ctx}.modify_fields[${i}].patch.type "${patchOut.type}" not supported` }
        patchOut.type = coerced
      }
      arr.push({ id: m.id, patch: patchOut as Partial<AIField> })
    }
    out.modify_fields = arr
  }
  if (x.remove_field_ids !== undefined) {
    if (!isStringArray(x.remove_field_ids)) return { error: `${ctx}.remove_field_ids must be string[]` }
    out.remove_field_ids = x.remove_field_ids
  }
  return { ok: out }
}
