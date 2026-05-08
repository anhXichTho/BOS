import type { UserRole, ResourceType } from '../types'

/**
 * Centralised permission helper used by the client.
 *
 * Server-side enforcement still lives in Postgres RLS + the `public.can()`
 * SQL function. This is the *UI-side* mirror — what to render or hide.
 *
 * Rules (must mirror SQL):
 *   - Role 'admin'/'editor' → can do anything.
 *   - Otherwise → action allowed if the user shares any group with the resource's ACL.
 *   - Special: project assignee can edit own project.
 *
 * Resource ACL data is passed in (the caller is responsible for fetching
 * `resource_group_acl` rows for the resource).
 */

export interface PermissionContext {
  role: UserRole | null
  groupIds: string[]
}

export interface ResourceAclEntry {
  resource_type: ResourceType
  resource_id: string
  group_id: string
}

export type Action = 'view' | 'edit' | 'manage'

/** Highest-priority short-circuit: admins/editors can do anything. */
export function isAdminOrEditor(ctx: PermissionContext): boolean {
  return ctx.role === 'admin' || ctx.role === 'editor'
}

/** Returns true if the user can perform `action` on the given resource. */
export function can(
  ctx: PermissionContext,
  _action: Action,
  resource: { type: ResourceType; id: string; assignedTo?: string | null; userId?: string | null },
  acl: ResourceAclEntry[],
): boolean {
  if (isAdminOrEditor(ctx)) return true

  // Project assignee can edit their own project.
  if (resource.type === 'project' && resource.assignedTo && resource.userId
      && resource.assignedTo === resource.userId) {
    return true
  }

  // Group ACL: any shared group grants access.
  return acl.some(
    a => a.resource_type === resource.type
      && a.resource_id   === resource.id
      && ctx.groupIds.includes(a.group_id),
  )
}

/** Sum the ACL list down to "is the resource visible to me at all". */
export function visibleViaGroup(
  ctx: PermissionContext,
  resourceType: ResourceType,
  resourceId: string,
  acl: ResourceAclEntry[],
): boolean {
  if (isAdminOrEditor(ctx)) return true
  return acl.some(
    a => a.resource_type === resourceType
      && a.resource_id   === resourceId
      && ctx.groupIds.includes(a.group_id),
  )
}
