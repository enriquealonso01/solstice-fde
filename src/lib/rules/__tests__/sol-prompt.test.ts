/**
 * agent/sol.md is the one source of Sol's prompt and tool list.
 *
 * solPrompt.ts is generated from it at build time (scripts/gen-sol-prompt.mjs, run as `prebuild`)
 * and committed so a fresh clone typechecks. These cases fail when the committed copy is stale, when
 * the tool table stops matching what the runtimes register, and when chat.ts would run without a prompt.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@netlify/functions'
import { describe, expect, it, vi } from 'vitest'
import { CONCIERGE_TOOLS, GROUP_TOOLS, ROUTING_TOOLS } from '../../../../shared/toolContracts'
import { toolDefinitions } from '../../../../netlify/functions/tools/registry'
import { SOL_SYSTEM_PROMPT } from '../../../../netlify/functions/tools/solPrompt'

const repoRoot = join(__dirname, '../../../..')
const solMd = readFileSync(join(repoRoot, 'agent/sol.md'), 'utf8').replace(/\r\n?/g, '\n')

/** Records the system prompt chat.ts sends, and answers with one line of text. */
const sent = vi.hoisted(() => ({ system: [] as Array<{ text: string }> }))
vi.mock('@anthropic-ai/sdk', () => {
  class Anthropic {
    static APIError = class extends Error {}
    messages = {
      stream: (params: { system: Array<{ text: string }> }) => {
        sent.system = params.system
        const content = [{ type: 'text', text: 'Breakfast runs from 6:30.' }]
        return {
          async *[Symbol.asyncIterator]() {},
          finalMessage: async () => ({ content, stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 } }),
        }
      },
    }
  }
  return { default: Anthropic }
})

describe('the generated prompt', () => {
  it('is exactly the SOL:SYSTEM block of agent/sol.md (run `node scripts/gen-sol-prompt.mjs` if not)', () => {
    const block = solMd.split('<!-- SOL:SYSTEM:BEGIN -->')[1]?.split('<!-- SOL:SYSTEM:END -->')[0]?.trim()
    expect(block?.length).toBeGreaterThan(1000)
    expect(SOL_SYSTEM_PROMPT).toBe(block)
  })

  it('is what chat.ts sends, followed only by its chat-channel notes', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    const { default: chat } = await import('../../../../netlify/functions/chat')
    const req = new Request('http://localhost/api/chat', { method: 'POST', body: JSON.stringify({ message: 'What time is breakfast?' }) })
    await (await chat(req, {} as Context)).text()
    delete process.env.ANTHROPIC_API_KEY

    const system = sent.system[0]?.text ?? ''
    expect(system.startsWith(`${SOL_SYSTEM_PROMPT}\n`)).toBe(true)
    expect(system.slice(SOL_SYSTEM_PROMPT.length)).toMatch(/^\s*ON THIS CHANNEL[\s\S]*\n\nCHANNEL\nThis conversation is in the chat channel/)
  })

  it('stops chat.ts from loading when it is empty, rather than letting Sol answer without rules', async () => {
    vi.resetModules()
    vi.doMock('../../../../netlify/functions/tools/solPrompt', () => ({ SOL_SYSTEM_PROMPT: ' \n' }))
    await expect(import('../../../../netlify/functions/chat')).rejects.toThrow(/SOL_SYSTEM_PROMPT is empty/)
    vi.doUnmock('../../../../netlify/functions/tools/solPrompt')
  })
})

describe('the tool table in agent/sol.md', () => {
  const rows = [...solMd.matchAll(/^\| `([a-z_]+)` \| ([a-z, ]+) \|/gm)].map((m) => ({ name: m[1], runsOn: m[2] }))
  const listed = (channel: string) => rows.filter((r) => r.runsOn.includes(channel)).map((r) => r.name).sort()

  it('lists exactly the tools the chat runtime registers', () => {
    expect(listed('chat')).toEqual(toolDefinitions().map((d) => d.name).sort())
  })

  it('lists exactly the tools provision.mjs registers on the phone assistant', () => {
    // Every name in shared/toolContracts.ts (transfer_to_human becomes Telnyx's native transfer), plus hangup.
    const voice = [...ROUTING_TOOLS, ...CONCIERGE_TOOLS, ...GROUP_TOOLS, 'hangup'].sort()
    expect(listed('voice')).toEqual(voice)

    const exported = JSON.parse(readFileSync(join(repoRoot, 'exports/telnyx-assistant.json'), 'utf8')) as {
      tools: Array<{ type: string; webhook?: { name: string } }>
    }
    const live = exported.tools.map((t) => (t.type === 'transfer' ? 'transfer_to_human' : (t.webhook?.name ?? t.type)))
    expect(live.sort()).toEqual(voice)
  })
})
