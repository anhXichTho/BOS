/**
 * Approval sub-section of the step detail editor.
 * Toggle "yêu cầu duyệt" + role/user picker when enabled.
 */
import { memo } from 'react'
import { ShieldCheck } from 'lucide-react'
import type { StepDraft } from './types'
import type { Profile } from '../../types'

interface Props {
  step: StepDraft
  profiles: Profile[]
  onUpdate: (id: string, patch: Partial<StepDraft>) => void
}

export default memo(function StepApprovalSection({ step, profiles, onUpdate }: Props) {
  return (
    <section className="border border-neutral-100 rounded-lg p-3 bg-white">
      <div className="flex items-center gap-2 mb-2">
        <ShieldCheck size={13} className="text-amber-600" />
        <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-700">
          Yêu cầu duyệt
        </h4>
        <label className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-neutral-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={step.requires_approval}
            onChange={e => onUpdate(step.id, {
              requires_approval: e.target.checked,
              approver_role: e.target.checked ? (step.approver_role ?? 'specific_user') : null,
              approver_user_id: e.target.checked ? step.approver_user_id : null,
            })}
            className="accent-amber-600"
          />
          Bật
        </label>
      </div>

      {step.requires_approval ? (
        <div className="flex gap-1.5 flex-wrap">
          <select
            value={step.approver_role ?? 'specific_user'}
            onChange={e => onUpdate(step.id, {
              approver_role: e.target.value as StepDraft['approver_role'],
              approver_user_id: e.target.value !== 'specific_user' ? null : step.approver_user_id,
            })}
            className="border border-amber-200 rounded-lg px-2 py-1 text-xs bg-white"
          >
            <option value="specific_user">Người cụ thể</option>
            <option value="admin">Tất cả Admin</option>
            <option value="editor">Tất cả Editor</option>
          </select>
          {step.approver_role === 'specific_user' && (
            <select
              value={step.approver_user_id ?? ''}
              onChange={e => onUpdate(step.id, { approver_user_id: e.target.value || null })}
              className="border border-amber-200 rounded-lg px-2 py-1 text-xs bg-white flex-1 min-w-0"
            >
              <option value="">— Chọn người duyệt —</option>
              {profiles.map(p => (
                <option key={p.id} value={p.id}>{p.full_name} ({p.role})</option>
              ))}
            </select>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-neutral-400 italic">Bước này tự hoàn tất khi runner check ✓.</p>
      )}
    </section>
  )
})
