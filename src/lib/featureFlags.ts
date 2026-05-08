/**
 * featureFlags — small central place to gate UI features without ripping
 * the underlying code out. Lets us archive/revive features by flipping a
 * single boolean.
 *
 * Usage:
 *   import { AI_WORKFLOW_ASSISTANT_ENABLED } from '../lib/featureFlags'
 *   {AI_WORKFLOW_ASSISTANT_ENABLED && <button>AI</button>}
 */

/**
 * Round-7 conversational AI assistant for the workflow editor.
 *
 * Status: ARCHIVED (round-9, 2026-05).
 * Reason: hard to use, output not reliable enough for production. Keeping
 * the modal, edge function, schema (workflow_ai_conversations), and apply
 * helpers in place so the feature can be revived with prompt + UX work.
 *
 * Flip to `true` to reactivate the:
 *   - "✨ Trợ lý AI" button in WorkflowEditPage header
 *   - per-step Sparkles AI shortcut in StepDetailPanel header
 */
export const AI_WORKFLOW_ASSISTANT_ENABLED = false
