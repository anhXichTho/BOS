/**
 * Pure functions to apply an AIWorkflowPatch to an in-memory `StepDraft[]`
 * (and queued form ops) WITHOUT touching the DB. Used by the conversational
 * AI modal's local sandbox.
 *
 * The original `applyAIPatch` in `WorkflowEditPage.tsx` did everything in one
 * pass: validate, run form CRUD, mutate steps. Round-7 splits this so the
 * modal can apply many incremental patches to its draft (still all
 * in-memory, no DB writes), accumulate pending form ops, and only flush to
 * the DB on the user's "Lưu" action.
 *
 *   applyPatchToDraft(draft, codes, patch)  → { draft, formOps, errors[] }
 *   mergeFormOps(...)                        → combined pending form ops
 *   commitDraftToEditor(draft, formOps, supabase, qc)
 *                                            → async; runs DB writes,
 *                                              returns the final StepDraft[]
 *                                              with NEW_F codes resolved.
 */
import { deriveCodes } from './codes'
import type { DerivedCodes } from './codes'
import type { StepDraft } from './types'
import type {
  AIWorkflowPatch, AIAddForm, AIModifyForm, AIField,
} from '../../lib/workflowAISchema'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { QueryClient } from '@tanstack/react-query'

export interface PendingFormOps {
  /** New forms to insert when committing. */
  add: AIAddForm[]
  /** Edits to existing forms to apply when committing. */
  modify: AIModifyForm[]
}

export const emptyFormOps: PendingFormOps = { add: [], modify: [] }

export interface ApplyResult {
  /** New draft with the patch applied. */
  draft: StepDraft[]
  /** Form ops accumulated by THIS patch (merge with prior queue). */
  formOps: PendingFormOps
  /** Soft errors (invalid refs etc.) — patch still applied where possible. */
  warnings: string[]
}

/**
 * Apply a patch to a draft. Pure — does NOT touch the DB.
 *
 * `currentCodes` is derived from the draft passed in. Pre-validate
 * referenced S{N} / F{N} codes exist against this code map.
 */
export function applyPatchToDraft(
  draft: StepDraft[],
  patch: AIWorkflowPatch,
): ApplyResult {
  const warnings: string[] = []
  const codes = deriveCodes(draft)

  // ── Pre-validate references (collect warnings; skip operations on bad refs)
  const sCodesUsed: string[] = []
  if (patch.add_steps) {
    for (const a of patch.add_steps) if (a.parent.kind === 's_code') sCodesUsed.push(a.parent.value)
  }
  if (patch.modify_steps) for (const m of patch.modify_steps) sCodesUsed.push(m.s_code)
  if (patch.remove_step_codes) sCodesUsed.push(...patch.remove_step_codes)
  for (const c of sCodesUsed) {
    if (!codes.stepIdByCode[c]) warnings.push(`Patch tham chiếu bước không tồn tại: ${c}`)
  }
  if (patch.modify_forms) {
    for (const m of patch.modify_forms) {
      if (!codes.formIdByCode[m.f_code]) warnings.push(`Patch tham chiếu form không tồn tại: ${m.f_code}`)
    }
  }

  let next: StepDraft[] = [...draft]

  // ── 1. Removes (with descendants)
  if (patch.remove_step_codes?.length) {
    const toRemove = new Set<string>()
    for (const c of patch.remove_step_codes) {
      const stepId = codes.stepIdByCode[c]
      if (!stepId) continue
      const stack = [stepId]
      while (stack.length) {
        const cur = stack.pop()!
        toRemove.add(cur)
        next.filter(s => s.parent_step_id === cur).forEach(s => stack.push(s.id))
      }
    }
    next = next.filter(s => !toRemove.has(s.id))
  }

  // ── 2. replace_all wipes BEFORE adds.
  if (patch.mode === 'replace_all') {
    next = []
  }

  // ── 3. Modifies. attach_form_code resolves later in commit phase, so we
  //       store it as a *string* sidecar on form_template_id (it'll be
  //       replaced with the real uuid on commit). For NEW_F codes the
  //       sidecar matches a `formOps.add[].code` and gets resolved then.
  if (patch.modify_steps) {
    for (const m of patch.modify_steps) {
      const stepId = codes.stepIdByCode[m.s_code]
      if (!stepId) continue
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawPatch = m.patch as Record<string, any>
      const cleanPatch: Partial<StepDraft> = {}
      for (const [k, v] of Object.entries(rawPatch)) {
        if (k === 'attach_form_code') {
          // Resolve existing F{N} immediately. NEW_F{N} stays as string and
          // gets resolved in commitDraftToEditor (we mark it via a leading
          // sentinel that we recognise later).
          if (typeof v === 'string') {
            const existingId = codes.formIdByCode[v]
            if (existingId) {
              cleanPatch.form_template_id = existingId
            } else if (v.startsWith('NEW_F')) {
              // Defer until commit. Stash the code into form_template_id —
              // commitDraftToEditor will translate.
              cleanPatch.form_template_id = `__NEW_F_CODE__${v}` as unknown as string
            } else {
              warnings.push(`Form code không tồn tại: ${v}`)
            }
          }
        } else {
          (cleanPatch as Record<string, unknown>)[k] = v
        }
      }
      next = next.map(s => s.id === stepId ? { ...s, ...cleanPatch } : s)
    }
  }

  // ── 4. Adds — topological pass for new-code refs.
  if (patch.add_steps?.length) {
    const newCodeToId: Record<string, string> = {}
    const remaining = [...patch.add_steps]
    let safety = remaining.length * 2
    while (remaining.length > 0 && safety-- > 0) {
      const before = remaining.length
      for (let i = remaining.length - 1; i >= 0; i--) {
        const a = remaining[i]
        let parentId: string | null = null
        if (a.parent.kind === 'root') {
          parentId = null
        } else if (a.parent.kind === 'code') {
          // Forward ref to another add_step — try newCodeToId first, then
          // (fallback) accept it as an existing S{N} in case the AI confused
          // the kind tag.
          parentId = newCodeToId[a.parent.value]
                  ?? codes.stepIdByCode[a.parent.value]
                  ?? null
          if (!parentId) continue
        } else if (a.parent.kind === 's_code') {
          // Existing-step ref — try existing first, then newCodeToId fallback
          // so the AI emitting `kind: 's_code'` for a NEW_S code still works.
          parentId = codes.stepIdByCode[a.parent.value]
                  ?? newCodeToId[a.parent.value]
                  ?? null
          if (!parentId) continue
        }
        const id = crypto.randomUUID()
        newCodeToId[a.code] = id

        // Form attach: existing F{N} → real id. NEW_F{N} → defer.
        let formId: string | null = null
        if (a.attach_form_code) {
          const existing = codes.formIdByCode[a.attach_form_code]
          if (existing) {
            formId = existing
          } else if (a.attach_form_code.startsWith('NEW_F')) {
            formId = `__NEW_F_CODE__${a.attach_form_code}`
          } else {
            warnings.push(`Form code không tồn tại trên add_step ${a.code}: ${a.attach_form_code}`)
          }
        }

        const newStep: StepDraft = {
          id,
          parent_step_id: parentId,
          branch_condition: a.branch_condition ?? null,
          title: a.title,
          description: a.description ?? '',
          step_type: a.step_type,
          branch_options: a.branch_options ?? (a.step_type === 'branch' ? ['Đồng ý', 'Từ chối'] : []),
          order_index: next.filter(s => s.parent_step_id === parentId).length,
          helper_panel_id: null,
          form_template_id: formId,
          requires_approval: a.requires_approval ?? false,
          approver_user_id: null,
          approver_role: a.approver_role ?? null,
          duration_hours: a.duration_hours ?? 3,
          condition_step_id: null,
          condition_value: null,
          isNew: true,
        }
        next = [...next, newStep]
        remaining.splice(i, 1)
      }
      if (remaining.length === before) break
    }
    if (remaining.length > 0) {
      warnings.push(`Không resolve được parent của: ${remaining.map(r => r.code).join(', ')}`)
    }
  }

  // ── 5. Form ops are queued, not applied here.
  const formOps: PendingFormOps = {
    add: patch.add_forms ?? [],
    modify: patch.modify_forms ?? [],
  }

  return { draft: next, formOps, warnings }
}

/** Merge two pending form-op queues. Adds dedupe by `code`; modifies dedupe by `f_code`. */
export function mergeFormOps(a: PendingFormOps, b: PendingFormOps): PendingFormOps {
  const addByCode = new Map<string, AIAddForm>()
  for (const f of [...a.add, ...b.add]) addByCode.set(f.code, f)
  const modByCode = new Map<string, AIModifyForm>()
  for (const f of [...a.modify, ...b.modify]) {
    const existing = modByCode.get(f.f_code)
    if (existing) {
      modByCode.set(f.f_code, {
        f_code: f.f_code,
        add_fields:        [...(existing.add_fields ?? []), ...(f.add_fields ?? [])],
        modify_fields:     [...(existing.modify_fields ?? []), ...(f.modify_fields ?? [])],
        remove_field_ids:  [...(existing.remove_field_ids ?? []), ...(f.remove_field_ids ?? [])],
      })
    } else {
      modByCode.set(f.f_code, f)
    }
  }
  return {
    add:    Array.from(addByCode.values()),
    modify: Array.from(modByCode.values()),
  }
}

/**
 * Commit the draft + queued form ops to the DB and return a step list with
 * NEW_F sentinels resolved to real uuids. Caller should then replace its
 * editor `steps[]` with the returned list.
 */
export async function commitDraftToEditor(
  draft: StepDraft[],
  formOps: PendingFormOps,
  supabase: SupabaseClient,
  qc: QueryClient,
  currentCodes: DerivedCodes,
): Promise<{ steps: StepDraft[]; createdFormCount: number; modifiedFormCount: number }> {
  const newFormCodeToId: Record<string, string> = {}

  // 1. INSERT add_forms.
  for (const f of formOps.add) {
    const fields = f.fields.map(field => ({
      id: crypto.randomUUID(),
      label: field.label,
      type: field.type,
      required: field.required ?? false,
      options: field.options,
      description: field.description,
    }))
    const { data, error } = await supabase
      .from('form_templates')
      .insert({
        name: f.name,
        description: f.description ?? null,
        fields,
        summary_field_ids: [],
        is_active: true,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`Tạo form "${f.name}" lỗi: ${error?.message ?? 'unknown'}`)
    newFormCodeToId[f.code] = data.id
  }

  // 2. UPDATE modify_forms.
  for (const m of formOps.modify) {
    const formId = currentCodes.formIdByCode[m.f_code]
    if (!formId) throw new Error(`Form ${m.f_code} không tồn tại để sửa.`)
    const { data: current, error: readErr } = await supabase
      .from('form_templates')
      .select('fields')
      .eq('id', formId)
      .single()
    if (readErr || !current) throw new Error(`Đọc form ${m.f_code} lỗi: ${readErr?.message ?? 'unknown'}`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let fields: any[] = (current.fields as any[]) ?? []
    if (m.remove_field_ids?.length) {
      fields = fields.filter(f => !m.remove_field_ids!.includes(f.id))
    }
    if (m.modify_fields?.length) {
      for (const mf of m.modify_fields) {
        fields = fields.map(f => f.id === mf.id ? { ...f, ...mf.patch } : f)
      }
    }
    if (m.add_fields?.length) {
      const added = m.add_fields.map((field: AIField) => ({
        id: crypto.randomUUID(),
        label: field.label,
        type: field.type,
        required: field.required ?? false,
        options: field.options,
        description: field.description,
      }))
      fields = [...fields, ...added]
    }
    const { error: updErr } = await supabase
      .from('form_templates')
      .update({ fields, updated_at: new Date().toISOString() })
      .eq('id', formId)
    if (updErr) throw new Error(`Sửa form ${m.f_code} lỗi: ${updErr.message}`)
  }

  // 3. Resolve NEW_F sentinels in the draft.
  const resolved = draft.map(s => {
    if (typeof s.form_template_id === 'string' && s.form_template_id.startsWith('__NEW_F_CODE__')) {
      const code = s.form_template_id.slice('__NEW_F_CODE__'.length)
      const realId = newFormCodeToId[code]
      return { ...s, form_template_id: realId ?? null }
    }
    return s
  })

  if (formOps.add.length > 0 || formOps.modify.length > 0) {
    qc.invalidateQueries({ queryKey: ['form-templates'] })
    qc.invalidateQueries({ queryKey: ['form-templates-all'] })
  }

  return {
    steps: resolved,
    createdFormCount: formOps.add.length,
    modifiedFormCount: formOps.modify.length,
  }
}
