// Supabase Edge Function: chat-helper
//
// Calls an LLM (Anthropic Claude or OpenAI) using configuration stored in the
// helper_panels table. The browser sends `{ panel_id, messages, context }`;
// this function looks up the panel config, prepends system_prompt + knowledge_base,
// and returns the assistant's reply.
//
// Setup (one-time):
//   1. Install Supabase CLI: https://supabase.com/docs/guides/cli
//   2. Login: `supabase login`
//   3. Link project: `supabase link --project-ref <your-ref>`
//   4. Set the LLM API key as a secret:
//        supabase secrets set LLM_API_KEY="sk-ant-..."
//      (Or use a custom env var name and set helper_panels.config.api_key_env)
//   5. Deploy:
//        supabase functions deploy chat-helper
//   6. The browser calls supabase.functions.invoke('chat-helper', { body: {...} })

// @ts-expect-error Deno runtime — types not present in this React project.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
// @ts-expect-error Deno runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface RequestBody {
  panel_id: string
  messages: Message[]
  /** Optional caller-supplied context (e.g. workflow step description) prepended to system prompt. */
  context?: string
}

interface PanelConfig {
  system_prompt?: string
  knowledge_base?: string
  context_template?: string
  model?: string
  allow_external?: boolean
  api_endpoint?: string
  api_key_env?: string
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

  try {
    const body = (await req.json()) as RequestBody
    if (!body?.panel_id || !Array.isArray(body.messages) || body.messages.length === 0) {
      return jsonResponse({ error: 'panel_id and messages are required' }, 400)
    }

    // @ts-expect-error Deno runtime
    const supabaseUrl     = Deno.env.get('SUPABASE_URL')!
    // @ts-expect-error Deno runtime
    const serviceRoleKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, serviceRoleKey)

    const { data: panel, error: panelErr } = await supabase
      .from('helper_panels')
      .select('id, type, config')
      .eq('id', body.panel_id)
      .maybeSingle()

    if (panelErr || !panel) return jsonResponse({ error: 'Panel not found' }, 404)
    if (panel.type !== 'chatbot') return jsonResponse({ error: 'Panel is not a chatbot' }, 400)

    const config = (panel.config ?? {}) as PanelConfig
    const model  = config.model ?? 'claude-haiku-4-5'

    // Build composite system prompt: prompt + context + KB.
    const systemParts: string[] = []
    if (config.system_prompt) systemParts.push(config.system_prompt)
    if (body.context)         systemParts.push(`\n\nContext:\n${body.context}`)
    if (config.knowledge_base) systemParts.push(`\n\nKnowledge base:\n${config.knowledge_base}`)
    if (!config.allow_external) {
      systemParts.push(
        '\n\nIf the user question cannot be answered from the system prompt, ' +
        'context, or knowledge base above, reply with: "Mình chưa có dữ liệu nội ' +
        'bộ về câu này — vui lòng hỏi câu khác hoặc liên hệ admin." Do not invent.',
      )
    }
    const system = systemParts.join('')

    // @ts-expect-error Deno runtime
    const apiKey = Deno.env.get(config.api_key_env ?? 'LLM_API_KEY')
    if (!apiKey) {
      return jsonResponse({
        error: `LLM API key not configured. Run: supabase secrets set ${config.api_key_env ?? 'LLM_API_KEY'}=...`,
      }, 500)
    }

    const reply = model.startsWith('gpt-')
      ? await callOpenAI(apiKey, model, system, body.messages, config.api_endpoint)
      : await callAnthropic(apiKey, model, system, body.messages, config.api_endpoint)

    return jsonResponse({ reply, model })
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unknown error' }, 500)
  }
})

// ─── Provider adapters ──────────────────────────────────────────────────────

async function callAnthropic(
  apiKey: string,
  model: string,
  system: string,
  messages: Message[],
  endpointOverride?: string,
): Promise<string> {
  const endpoint = endpointOverride || 'https://api.anthropic.com/v1/messages'
  const r = await fetch(endpoint, {
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
    throw new Error(`Anthropic API error: ${r.status} — ${detail.slice(0, 200)}`)
  }
  const data = await r.json()
  // Claude v1/messages returns { content: [{ type: 'text', text: '...' }, …] }
  const text = (data.content ?? []).map((c: any) => c.text ?? '').join('').trim()
  return text || '(LLM trả lời rỗng.)'
}

async function callOpenAI(
  apiKey: string,
  model: string,
  system: string,
  messages: Message[],
  endpointOverride?: string,
): Promise<string> {
  const endpoint = endpointOverride || 'https://api.openai.com/v1/chat/completions'
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, ...messages],
      max_tokens: 1024,
    }),
  })
  if (!r.ok) {
    const detail = await r.text()
    throw new Error(`OpenAI API error: ${r.status} — ${detail.slice(0, 200)}`)
  }
  const data = await r.json()
  return (data.choices?.[0]?.message?.content ?? '').trim() || '(LLM trả lời rỗng.)'
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  })
}
