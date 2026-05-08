/**
 * WorkflowAccessSection — collapsible "Quyền chạy" (template access) block.
 * Lists user-group chips toggleable to allow/deny that group from running
 * this workflow. When no group is selected, the workflow is open to all
 * authenticated members.
 *
 * Lives in the left panel of WorkflowEditPage (between Meta and Guidance).
 * Folded by default. Hidden entirely when isNew=true (template not saved yet).
 */
import { memo } from 'react'
import { ChevronDown, UserCheck } from 'lucide-react'
import type { UserGroup } from '../../types'

interface Props {
  isNew: boolean
  userGroups: UserGroup[]
  templateAccessGroups: string[]
  onToggleGroupAccess: (groupId: string, currentlyOn: boolean) => void
}

export default memo(function WorkflowAccessSection({
  isNew, userGroups, templateAccessGroups, onToggleGroupAccess,
}: Props) {
  if (isNew || userGroups.length === 0) return null

  const summary =
    templateAccessGroups.length === 0
      ? 'Mở cho mọi thành viên'
      : `${templateAccessGroups.length}/${userGroups.length} nhóm`

  return (
    <details className="group border-b border-neutral-100 bg-neutral-25">
      <summary className="cursor-pointer select-none px-3 py-2 flex items-center gap-2 text-xs">
        <ChevronDown size={12} className="transition-transform -rotate-90 group-open:rotate-0 text-neutral-400" />
        <UserCheck size={12} className="text-neutral-500" />
        <span className="font-semibold uppercase tracking-wider text-neutral-600">Quyền chạy</span>
        <span className="ml-auto text-[10px] text-neutral-400">{summary}</span>
      </summary>
      <div className="px-3 pb-3 pt-1">
        <div className="flex flex-wrap gap-1">
          {userGroups.map(g => {
            const on = templateAccessGroups.includes(g.id)
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => onToggleGroupAccess(g.id, on)}
                className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                  on
                    ? 'border-primary-400 bg-primary-50 text-primary-700 font-medium'
                    : 'border-neutral-200 text-neutral-500 hover:border-neutral-300'
                }`}
                style={on && g.color ? { borderColor: g.color + '80', backgroundColor: g.color + '18', color: g.color } : undefined}
              >
                {g.name}
              </button>
            )
          })}
        </div>
        <p className="text-[10px] text-neutral-400 mt-1.5">
          {templateAccessGroups.length === 0 ? 'Mọi thành viên có thể chạy.' : 'Chỉ các nhóm được chọn.'}
        </p>
      </div>
    </details>
  )
})
