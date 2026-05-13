/**
 * Module-level state bridge between ChatPage and App-level back-button handler.
 *
 * ChatPage renders AppShell as its CHILD, so it can't communicate via React
 * context to App-level code. It publishes `inThreadView` here whenever the user
 * is viewing a chat thread on mobile with the drawer closed. ExitGuard reads
 * this flag on every popstate to decide whether to:
 *   - Open the drawer (inThreadView=true → Messenger-style back)
 *   - Show the exit-app confirm (default mobile guard behavior)
 */

let inThreadView = false

export function setInThreadView(v: boolean): void {
  inThreadView = v
}

export function getInThreadView(): boolean {
  return inThreadView
}
