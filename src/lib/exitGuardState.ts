/**
 * Module-level flag shared between ExitGuard (App.tsx) and ChatPage's mobile
 * back-button handler. When true, ExitGuard skips its "exit app?" confirm so
 * ChatPage can intercept the popstate and open the drawer instead.
 *
 * Set true ONLY while the user is viewing a chat thread on mobile with the
 * drawer closed; cleared on every other condition.
 */

let suspended = false

export function suspendExitGuard(v: boolean): void {
  suspended = v
}

export function isExitGuardSuspended(): boolean {
  return suspended
}
