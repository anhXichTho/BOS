// Supabase Edge Function: personal-bot
//
// Called from the Cá nhân (personal) channel when the user selects a bot via @BotName.
// Receives message history + optional panel_id, calls the LLM, then writes the bot reply
// directly to chat_messages using the service-role key (bypasses author_id RLS).
//
// Setup:
//   supabase secrets set LLM_API_KEY="sk-ant-..."
//   supabase functions deploy personal-bot

// @ts-expect-error Deno runtime
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
// @ts-expect-error Deno runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface RequestBody {
  context_type: string
  context_id: string
  messages: Message[]   // full conversation history; last entry is current user query
  panel_id?: string | null  // optional: specific helper_panel (chatbot type) to use
  user_id?: string | null   // caller's user id — used for usage logging
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
}

const DEFAULT_SYSTEM_PROMPT = `You are an AI assistant embedded in BOS — a Vietnamese operations management platform for SME teams (projects, workflows, forms, team chat). Help users with their questions concisely and accurately. Respond in the same language the user writes in (Vietnamese or English). If you don't know something specific to this platform, say so honestly.`

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = (await req.json()) as RequestBody
    console.log('[personal-bot] request — context_id:', body?.context_id, 'panel_id:', body?.panel_id, 'msg count:', body?.messages?.length)

    if (!body?.context_id || !Array.isArray(body.messages) || body.messages.length === 0) {
      return json({ error: 'context_id and messages are required' }, 400)
    }

    // @ts-expect-error Deno runtime
    const apiKey = Deno.env.get('LLM_API_KEY')
    if (!apiKey) {
      return json({ error: 'LLM_API_KEY not set. Run: supabase secrets set LLM_API_KEY=sk-ant-...' }, 500)
    }

    // @ts-expect-error Deno runtime
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    // @ts-expect-error Deno runtime
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const db = createClient(supabaseUrl, serviceKey)

    // Resolve system prompt + bot name: use panel config if panel_id provided
    let systemPrompt = DEFAULT_SYSTEM_PROMPT
    let modelName = 'claude-haiku-4-5'
    let botName = 'Trợ lý chung'
    let panelCfg: Record<string, unknown> = {}

    if (body.panel_id) {
      const { data: panel, error: panelErr } = await db
        .from('helper_panels')
        .select('config, name')
        .eq('id', body.panel_id)
        .single()
      if (panelErr) {
        console.warn('[personal-bot] failed to load panel:', panelErr.message)
      } else if (panel) {
        botName = panel.name
        panelCfg = (panel.config ?? {}) as Record<string, unknown>
        if (typeof panelCfg.system_prompt === 'string' && panelCfg.system_prompt.trim()) {
          systemPrompt = panelCfg.system_prompt.trim()
        }
        if (typeof panelCfg.knowledge_base === 'string' && panelCfg.knowledge_base.trim()) {
          systemPrompt += '\n\n## Knowledge Base\n' + panelCfg.knowledge_base.trim()
        }
        if (typeof panelCfg.model === 'string' && panelCfg.model.trim()) {
          modelName = panelCfg.model.trim()
        }
        console.log('[personal-bot] using panel:', panel.name, 'model:', modelName)
      }
    }

    // Trim messages based on conversation_history settings
    let effectiveMessages = body.messages
    if (body.panel_id && Object.keys(panelCfg).length > 0) {
      const historyEnabled = panelCfg.conversation_history_enabled === true
      const maxPairs = typeof panelCfg.conversation_history_pairs === 'number'
        ? Math.max(1, Math.min(5, panelCfg.conversation_history_pairs))
        : 5
      if (!historyEnabled) {
        // Only use the last message (current query)
        effectiveMessages = [body.messages[body.messages.length - 1]]
      } else {
        // Include up to maxPairs Q&A pairs + the current user message
        effectiveMessages = body.messages.slice(-(maxPairs * 2 + 1))
      }
    } else if (!body.panel_id) {
      // General bot: no history by default, just the current query
      effectiveMessages = [body.messages[body.messages.length - 1]]
    }

    const query = effectiveMessages[effectiveMessages.length - 1].content

    // Call LLM
    const reply = await callAnthropic(apiKey, systemPrompt, modelName, effectiveMessages)
    console.log('[personal-bot] reply length:', reply.length)

    // Insert bot reply directly via service role (author_id = null bypasses RLS)
    const { error: insertErr } = await db.from('chat_messages').insert({
      context_type: body.context_type ?? 'channel',
      context_id:   body.context_id,
      author_id:    null,
      message_type: 'rich_card',
      content:      null,
      payload:      {
        kind:     'bot_response',
        reply,
        model:    modelName,
        query,
        panel_id: body.panel_id ?? null,
        bot_name: botName,
      },
    })
    if (insertErr) {
      console.error('[personal-bot] insert error:', insertErr.message)
      return json({ error: `Failed to save reply: ${insertErr.message}` }, 500)
    }

    // Log usage (best-effort — never fail the request if log insert fails)
    const { error: logErr } = await db.from('ai_usage_logs').insert({
      panel_id:     body.panel_id ?? null,
      bot_name:     botName,
      user_id:      body.user_id ?? null,
      context_type: body.context_type ?? 'channel',
      context_id:   body.context_id,
      query,
      reply,
      model:        modelName,
    })
    if (logErr) console.warn('[personal-bot] usage log error:', logErr.message)

    return json({ reply, model: modelName })
  } catch (err) {
    console.error('[personal-bot] unhandled error:', err)
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500)
  }
})

async function callAnthropic(
  apiKey: string,
  system: string,
  model: string,
  messages: Message[],
): Promise<string> {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    }),
  })
  if (!r.ok) {
    const detail = await r.text()
    throw new Error(`Anthropic error ${r.status}: ${detail.slice(0, 300)}`)
  }
  const data = await r.json()
  return (data.content ?? []).map((c: any) => c.text ?? '').join('').trim() || '(Không có phản hồi.)'
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  })
}
