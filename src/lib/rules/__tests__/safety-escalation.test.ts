/**
 * Safety, medical and legal turns reach a human whatever the model does.
 *
 * Drives POST /api/chat end to end with the Anthropic client replaced by a scripted model and
 * Supabase replaced by an in-memory table store, then reads the SSE stream and the stored rows.
 * The last block calls classify_intent directly, because every urgent phrase it matches files a
 * real escalation.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@netlify/functions'
import { classifyIntent } from '../../../../netlify/functions/tools/routing'
import type { ToolContext } from '../../../../netlify/functions/tools/helpers'

type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
type Row = Record<string, unknown>

const model = vi.hoisted(() => ({
  /** One entry per model round: the content blocks it returns, or 'fail' to throw. */
  rounds: [] as Array<Block[] | 'fail'>,
}))

const db = vi.hoisted(() => {
  const tables: Record<string, Row[]> = {}
  /** Just enough of the supabase-js query builder for chat.ts and create_escalation. */
  const from = (table: string) => {
    const rows = (tables[table] ??= [])
    const filters: Array<[string, unknown]> = []
    let inserted: Row | null = null
    const builder = {
      insert(row: Row) {
        inserted = { id: `${table}-${rows.length + 1}`, ...row }
        rows.push(inserted)
        return builder
      },
      update: () => builder,
      select: () => builder,
      eq(column: string, value: unknown) {
        filters.push([column, value])
        return builder
      },
      in: () => builder,
      gte: () => builder,
      order: () => builder,
      limit: () => builder,
      single: () => builder,
      maybeSingle: () => builder,
      then(resolve: (result: { data: unknown; error: null }) => void) {
        resolve({ data: inserted ?? rows.filter((r) => filters.every(([c, v]) => r[c] === v)), error: null })
      },
    }
    return builder
  }
  return { tables, client: { from } }
})

vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {
    status = 500
  }
  function stream(content: Block[]) {
    const events = content.map((block, index) =>
      block.type === 'tool_use'
        ? { type: 'content_block_start', index, content_block: { ...block, input: {} } }
        : { type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } },
    )
    return {
      async *[Symbol.asyncIterator]() {
        yield* events
      },
      finalMessage: async () => ({
        content,
        stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
    }
  }
  class Anthropic {
    static APIError = APIError
    messages = {
      stream: () => {
        const next = model.rounds.shift() ?? [{ type: 'text', text: 'Anything else?' }]
        if (next === 'fail') throw new Error('upstream unavailable')
        return stream(next)
      },
    }
  }
  return { default: Anthropic }
})

vi.mock('../../../../netlify/functions/_lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../netlify/functions/_lib/db')>()),
  tryGetDb: () => db.client,
}))

const { default: chat } = await import('../../../../netlify/functions/chat')

interface SseEvent {
  event: string
  data: Record<string, unknown>
}

async function send(message: string, sessionId?: string): Promise<SseEvent[]> {
  const req = new Request('http://localhost/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message, session_id: sessionId }),
  })
  const text = await (await chat(req, {} as Context)).text()
  return text
    .split('\n\n')
    .filter(Boolean)
    .map((chunk) => {
      const [eventLine, dataLine] = chunk.split('\n')
      return { event: eventLine.replace('event: ', ''), data: JSON.parse(dataLine.replace('data: ', '')) as Record<string, unknown> }
    })
}

const escalations = () => db.tables.escalations ?? []
const packetOf = (row: Row) => row.packet as Record<string, unknown>
const escalationChips = (events: SseEvent[]) =>
  events.filter((e) => e.event === 'tool' && e.data.name === 'create_escalation' && e.data.status === 'done')
const reply = (events: SseEvent[]) => events.filter((e) => e.event === 'delta').map((e) => e.data.text).join('')
const classify = (utterance: string): Block => ({ type: 'tool_use', id: 'tu-classify', name: 'classify_intent', input: { utterance } })

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key'
  model.rounds = []
  for (const table of Object.keys(db.tables)) delete db.tables[table]
})

afterAll(() => {
  delete process.env.ANTHROPIC_API_KEY
})

describe('a turn that must reach a human', () => {
  it('chest pains, model skips create_escalation: the runtime raises a medical escalation to the GM first', async () => {
    const message = "I'm having chest pains. You can email me at jane.doe@example.com"
    model.rounds = [[classify(message)], [{ type: 'text', text: 'Please call 911 right now.' }]]

    const events = await send(message)

    expect(reply(events)).toContain('911')
    const chips = escalationChips(events)
    expect(chips).toHaveLength(1)
    expect(chips[0].data.enforced).toBe(true)
    expect(chips[0].data.summary).toMatch(/to gm$/)
    // Raised before the model was asked: its chip precedes every word of the reply.
    expect(events.indexOf(chips[0])).toBeLessThan(events.findIndex((e) => e.event === 'delta'))

    expect(escalations()).toHaveLength(1)
    const row = escalations()[0]
    expect(row).toMatchObject({ category: 'medical', severity: 'high', status: 'open' })
    expect(packetOf(row).authority_required).toBe('gm')
    expect(String(row.summary)).toMatch(/chest pains/)
    expect(String(packetOf(row).transcript_excerpt)).toMatch(/^Guest: I'm having chest pains/)
    expect(JSON.stringify(row)).not.toContain('jane.doe@example.com')
  })

  it('chest pains, model only calls transfer_to_human: the medical escalation still exists', async () => {
    model.rounds = [
      [{ type: 'tool_use', id: 'tu-transfer', name: 'transfer_to_human', input: { reason: 'Guest has chest pains' } }],
      [{ type: 'text', text: 'Please call 911 now.' }],
    ]

    await send("I'm having chest pains")

    expect(escalations()).toHaveLength(1)
    expect(escalations()[0]).toMatchObject({ category: 'medical' })
    expect(packetOf(escalations()[0]).authority_required).toBe('gm')
  })

  it('a legal threat, with the model calling no tool at all, still becomes a legal escalation', async () => {
    model.rounds = [[{ type: 'text', text: 'I understand you are upset about the charge.' }]]

    const events = await send("This is unacceptable. I'm calling my lawyer about the damage charge.")

    expect(escalationChips(events).map((c) => c.data.enforced)).toEqual([true])
    expect(escalations()).toHaveLength(1)
    expect(escalations()[0]).toMatchObject({ category: 'legal', severity: 'high' })
    expect(packetOf(escalations()[0]).authority_required).toBe('gm')
  })

  it('a legal threat the model files under another category still gets a legal escalation to the GM', async () => {
    model.rounds = [
      [{ type: 'tool_use', id: 'tu-esc', name: 'create_escalation', input: { summary: 'Guest disputes a damage charge', category: 'other' } }],
      [{ type: 'text', text: 'A manager has this.' }],
    ]

    await send("I'm calling my lawyer about the damage charge")

    const legal = escalations().filter((r) => r.category === 'legal')
    expect(legal).toHaveLength(1)
    expect(packetOf(legal[0]).authority_required).toBe('gm')
  })

  it('an ordinary question raises nothing', async () => {
    const message = 'What time is breakfast served?'
    model.rounds = [[classify(message)], [{ type: 'text', text: 'Breakfast runs from 6:30.' }]]

    const events = await send(message)

    expect(escalationChips(events)).toEqual([])
    expect(escalations()).toEqual([])
  })

  it("merges the model's own create_escalation into the runtime's row rather than adding one", async () => {
    const message = 'Someone is threatening me in the lobby'
    model.rounds = [
      [classify(message)],
      [{ type: 'tool_use', id: 'tu-esc', name: 'create_escalation', input: { summary: 'Guest threatened in the lobby', category: 'safety' } }],
      [{ type: 'text', text: 'Call 911 if you are not safe. Our General Manager and security are being brought in now.' }],
    ]

    const events = await send(message)

    expect(escalationChips(events).map((c) => c.data.enforced)).toEqual([true, undefined])
    expect(escalations()).toHaveLength(1)
    expect(packetOf(escalations()[0]).authority_required).toBe('regional_security')
  })

  it("files what the model's classify_intent found when the guest's own words did not show it", async () => {
    model.rounds = [[classify('Guest reports her husband has chest pains')], [{ type: 'text', text: 'Call 911 now.' }]]

    const events = await send('My husband is clutching his chest and can barely talk')

    expect(escalationChips(events).map((c) => c.data.enforced)).toEqual([true])
    expect(escalations()).toHaveLength(1)
    expect(escalations()[0]).toMatchObject({ category: 'medical' })
    expect(String(packetOf(escalations()[0]).transcript_excerpt)).toMatch(/Sol: Call 911 now\./)
  })

  it('raises it once per session, however many turns repeat the signal', async () => {
    model.rounds = [[{ type: 'text', text: 'Please call 911 now.' }]]
    const first = await send('My husband is unconscious')
    const sessionId = String(first.find((e) => e.event === 'session')?.data.session_id)

    model.rounds = [[{ type: 'text', text: 'Stay with him until the paramedics arrive.' }]]
    const second = await send('He is still unconscious, the ambulance is on its way', sessionId)

    expect(escalationChips(first)).toHaveLength(1)
    expect(escalationChips(second)).toEqual([])
    expect(escalations()).toHaveLength(1)
  })

  it('still raises it when the model call itself fails', async () => {
    model.rounds = ['fail']

    const events = await send('There is an intruder in my room')

    expect(events.some((e) => e.event === 'error')).toBe(true)
    expect(escalationChips(events)).toHaveLength(1)
    expect(escalations()[0]).toMatchObject({ category: 'safety', severity: 'critical' })
  })

  it('still raises it when no Anthropic key is configured', async () => {
    delete process.env.ANTHROPIC_API_KEY

    const events = await send("I'm having chest pains")

    expect(events.some((e) => e.event === 'error')).toBe(true)
    expect(escalationChips(events)).toHaveLength(1)
    expect(escalations()[0]).toMatchObject({ category: 'medical' })
  })

  it('keeps a card number out of the escalation and the tool trace', async () => {
    model.rounds = [[{ type: 'text', text: 'A manager will review the charge.' }]]

    await send("I'm calling my lawyer. You charged my card 4111 1111 1111 1111 twice.")

    expect(escalations()).toHaveLength(1)
    const stored = JSON.stringify([escalations(), db.tables.tool_invocations ?? []])
    expect(stored).toContain('lawyer')
    expect(stored).not.toMatch(/1111/)
  })
})

describe('classify_intent: what counts as urgent', () => {
  const ctx = { channel: 'chat', session_id: 'sess-1' } as ToolContext
  const categoryOf = async (utterance: string) => {
    const data = (await classifyIntent({ utterance }, ctx)).data as { escalation_category?: string }
    return data.escalation_category ?? null
  }

  it.each([
    ["I think I'm having a heart attack", 'medical'],
    ["I can't breathe", 'medical'],
    ['My husband collapsed in the lobby', 'medical'],
    ["I'm having chest pains", 'medical'],
    ['My son is having an allergic reaction to the room service order', 'medical'],
    ['Please send an ambulance to room 412', 'medical'],
    ['This is a medical emergency', 'medical'],
    ["There's a fire in the hallway", 'safety'],
    ['Someone has a gun in the parking lot', 'safety'],
    ['A man has been following me around the hotel', 'safety'],
    ['Someone broke into my room', 'safety'],
    ['Someone is threatening me in the lobby', 'safety'],
    ['There is an intruder in my room', 'safety'],
    ["I'm going to sue", 'legal'],
    ['See you in court.', 'legal'],
    ["I'm threatening legal action", 'legal'],
    ['My attorney will be in touch about the damage charge', 'legal'],
    ['We are suing the hotel', 'legal'],
  ])('%s -> %s', async (utterance, category) => {
    expect(await categoryOf(utterance)).toBe(category)
  })

  it.each([
    'Do you offer a law enforcement or military discount?',
    'What is the emergency exit route from the 5th floor?',
    'Do you have an emergency contact number for the front desk?',
    'Where is the nearest emergency room?',
    'Is there a police station near the hotel?',
    "I'm an attorney in town for a deposition. Do you have a business center?",
    'I have an issue with my bill',
    'There is an issue the front desk never fixed',
    'Is there a medical centre near the Denver hotel?',
    'Can I smoke on the balcony?',
    'Does the suite have a fireplace?',
    'Is there a fire pit on the patio?',
    'Do you have a tennis court?',
    'My colleague Sue will check in for me',
    'Can I bring my dog?',
    'What time is breakfast?',
  ])('%s -> nothing', async (utterance) => {
    expect(await categoryOf(utterance)).toBeNull()
  })
})
