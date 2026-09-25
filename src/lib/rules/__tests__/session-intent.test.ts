// The supervisor console labels a conversation from `sessions.intent`. Something has to write it.
//
// The defect this guards: `sessions.intent` was NEVER written — 0 of 115 rows in production, at
// every status, including the 23 already ended. `intentLabel(null)` returns the literal string
// 'classifying…', so every session ever recorded showed that badge permanently, on the headline
// admin screen. Four surfaces read the column (SupervisorDashboard.tsx:129 and :172,
// AdminHome.tsx:117, SessionDetail.tsx:97) and nothing wrote it. `mockData.ts` fills it for its
// fixtures, which is exactly why the screen looked right in mock mode and wrong on real data.
//
// `classify_intent` always had the answer — it returns data.intent, e.g. "group_booking". The value
// was only ever kept in the tool trace and never put where the UI reads it.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { intentLabel } from '../../../components/admin/mockData'
import { classifyIntent } from '../../../../netlify/functions/tools/routing'
import type { ToolArgs, ToolContext } from '../../../../netlify/functions/tools/helpers'

const chatCtx = { channel: 'chat', session_id: 'sess-1' } as ToolContext

describe('classify_intent produces the label the console needs', () => {
  it('returns a non-empty intent string for a group request', async () => {
    const result = await classifyIntent({ message: 'I need 20 rooms for a conference' } as ToolArgs, chatCtx)
    const intent = (result.data as { intent?: unknown } | undefined)?.intent
    expect(typeof intent).toBe('string')
    expect(intent).toBeTruthy()
  })

  it('and that value renders as a label rather than the placeholder', async () => {
    const result = await classifyIntent({ message: 'I need 20 rooms for a conference' } as ToolArgs, chatCtx)
    const intent = String((result.data as { intent?: unknown }).intent)
    // This is the whole point: persisted, the badge stops saying "classifying…".
    expect(intentLabel(intent)).not.toBe('classifying…')
    expect(intentLabel(intent)).not.toContain('_')
  })
})

describe('intentLabel', () => {
  it('returns the placeholder for null, which is what every row showed', () => {
    expect(intentLabel(null)).toBe('classifying…')
  })

  it('humanises a real intent', () => {
    expect(intentLabel('group_booking')).toBe('group booking')
  })
})

describe('both runtimes persist it', () => {
  // A source guard. The behavioural path needs Supabase, which vitest.setup.ts strips by design,
  // so asserting on a session row here would pass while checking nothing — that mistake is already
  // recorded in agents/tested.log.md. This pins the wiring instead, and says so.
  //
  // The writer moved from `chat.ts` into the tool layer, because BOTH channels call
  // `classify_intent` and both need the same row updated: chat through `chat.ts`, telephony
  // through the `/api/tools` webhook. Chat-only would have left every phoned-in session labelled
  // "classifying…" — which is the beat the demo runbook opens the supervisor screen on.
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')
  const registry = read('netlify/functions/tools/registry.ts')
  const chat = read('netlify/functions/chat.ts')
  const toolWebhook = read('netlify/functions/tools/index.ts')

  it('writes sessions.intent somewhere', () => {
    expect(registry).toMatch(/from\('sessions'\)\.update\(\{\s*intent:\s*classified\s*\}\)/)
  })

  it('does it off the back of a successful classify_intent, not on every tool', () => {
    expect(registry).toMatch(/name !== 'classify_intent' \|\| !result\.ok/)
  })

  it('is fire-and-forget, so a label can never fail a guest turn', () => {
    const writer = registry.slice(registry.indexOf('export async function recordClassifiedIntent'))
    expect(writer.slice(0, 700)).toMatch(/try\s*\{[\s\S]*catch/)
  })

  it('is wired into the chat runtime', () => {
    // chat.ts keeps its own writer, shipped in PR #41. Left as-is deliberately: rewriting a
    // freshly-merged critical path to remove eight lines of duplication is the worse trade this
    // close in. Both writers are asserted, so neither can quietly stop writing.
    expect(chat).toMatch(/use\.name === 'classify_intent' && result\.ok/)
    expect(chat).toMatch(/void bindSessionIntent/)
  })

  it('is wired into the telephony tool webhook, which had no write at all', () => {
    expect(toolWebhook).toMatch(/recordClassifiedIntent\(ctx, name, result\)/)
  })

  it('has a writer per channel and no more, so neither can be dropped unnoticed', () => {
    const writes = [registry, chat, toolWebhook]
      .join(' ')
      .match(/from\('sessions'\)\.update\(\{\s*intent/g)
    // One in chat.ts (PR #41), one in the tool layer for telephony. If a third appears, or either
    // disappears, this fails and somebody looks.
    expect(writes).toHaveLength(2)
  })
})
