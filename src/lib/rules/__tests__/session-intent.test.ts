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

describe('the chat turn persists it', () => {
  // A source guard. The behavioural path needs Supabase, which vitest.setup.ts strips by design,
  // so asserting on a session row here would pass while checking nothing — that mistake is already
  // recorded in agents/tested.log.md. This pins the wiring instead, and says so.
  const src = readFileSync(join(process.cwd(), 'netlify/functions/chat.ts'), 'utf8')

  it('writes sessions.intent somewhere', () => {
    expect(src).toMatch(/from\('sessions'\)\.update\(\{\s*intent\s*\}\)/)
  })

  it('does it off the back of a successful classify_intent, not on every tool', () => {
    expect(src).toMatch(/use\.name === 'classify_intent' && result\.ok/)
  })

  it('is fire-and-forget, so a label can never fail a guest turn', () => {
    const idx = src.indexOf("use.name === 'classify_intent'")
    expect(idx).toBeGreaterThan(-1)
    const block = src.slice(idx, idx + 320)
    expect(block).toMatch(/void bindSessionIntent/)
    // the writer itself must swallow its own errors
    const writer = src.slice(src.indexOf('async function bindSessionIntent'))
    expect(writer.slice(0, 400)).toMatch(/try\s*\{[\s\S]*catch/)
  })
})
