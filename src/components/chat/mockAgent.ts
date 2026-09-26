/**
 * Scripted stand-in for `/api/chat`.
 *
 * It emits the exact same wire events as the real server, so the panel is fully
 * demonstrable before the server exists and nothing in the UI knows the
 * difference. `streamChat` falls back to this only when the endpoint is
 * unreachable, so the moment the real function ships this stops being used.
 *
 * Every scripted answer is grounded in `data/` (the front desk policy reference
 * and the properties export). Where the real agent would have to guess, the
 * script escalates instead. That is deliberate: the mock must not model
 * behaviour we would refuse to ship.
 */
import type { ChatRequest, ChatWireEvent } from '@/lib/chatClient'
import type { Citation } from './types'

interface ToolStep {
  kind: 'tool'
  name: string
  summary: string
  /** The chip once the tool is done, when it differs from the running one. */
  result?: string
  runMs: number
  citations?: Citation[]
}
interface SayStep {
  kind: 'say'
  text: string
}
type Step = ToolStep | SayStep

interface Script {
  id: string
  match: RegExp
  steps: Step[]
  /** Reads a booking, so it runs only when the message carries two factors. */
  needsIdentity?: boolean
}

/** A confirmation number together with the last name on the booking, e.g. "R55012, last name Kalinski". */
const TWO_FACTORS = /\bR(ES-)?\d{4,}\b[\s\S]*\blast name\b|\blast name\b[\s\S]*\bR(ES-)?\d{4,}\b/i

const VERIFY_FIRST: Step[] = [
  { kind: 'tool', name: 'identify_guest', summary: 'checking who I am speaking with', result: 'Not verified', runMs: 480 },
  {
    kind: 'say',
    text:
      'Happy to help with that. So that I only ever discuss a booking with the person who made it, I need two things first: your confirmation number and the last name on the booking.',
  },
]

const POLICY = (n: number, label: string): Citation => ({
  source: 'policy',
  ref: 'policy:' + String(n),
  label,
})

const SCRIPTS: Script[] = [
  {
    id: 'cancellation',
    match: /cancel|refund my booking|change my (booking|reservation)|non-?refundable/i,
    steps: [
      { kind: 'tool', name: 'classify_intent', summary: 'understanding your request', runMs: 420 },
      {
        kind: 'tool',
        name: 'get_policy',
        summary: 'reading the cancellation policy',
        runMs: 900,
        citations: [
          POLICY(2, 'Standard cancellation window'),
          POLICY(3, 'Advance Purchase rate'),
        ],
      },
      {
        kind: 'say',
        text:
          'It depends on the rate you booked, so let me give you both. On a Best Available Rate or a Corporate Negotiated rate you can cancel free of charge up to 72 hours before check-in; inside that window one night of room and tax is charged to the card on file. Advance Purchase is the stricter one: non-refundable and non-changeable from the moment it is booked, and I am not able to waive that one. If you give me your confirmation number I will tell you exactly which rate you are on.',
      },
    ],
  },
  {
    id: 'late-checkout',
    needsIdentity: true,
    match: /late check-?out|checkout time|check out late|stay later/i,
    steps: [
      { kind: 'tool', name: 'identify_guest', summary: 'finding your profile', runMs: 520 },
      {
        kind: 'tool',
        name: 'get_reservation',
        summary: 'checking your reservation',
        runMs: 760,
        citations: [
          { source: 'reservation', ref: 'reservation:RES-48213', label: 'Reservation RES-48213, Solstice Denver' },
        ],
      },
      {
        kind: 'tool',
        name: 'check_late_checkout',
        summary: 'checking your late checkout',
        runMs: 880,
        citations: [POLICY(6, 'Loyalty tier benefits at check-in'), POLICY(1, 'Check-in and check-out times')],
      },
      {
        kind: 'say',
        text:
          "You are Gold, so you're eligible for late check-out to 1:00 PM. It depends on availability on the day, and the front desk confirms it. Anything past 1:00 PM is their call, not mine.",
      },
    ],
  },
  {
    id: 'group',
    match: /group|block of rooms|conference|wedding|team|offsite|meeting space|corporate rate/i,
    steps: [
      { kind: 'tool', name: 'classify_intent', summary: 'understanding your request', runMs: 400 },
      { kind: 'tool', name: 'parse_inquiry', summary: 'reading the details you gave me', runMs: 700 },
      {
        kind: 'tool',
        name: 'check_availability',
        summary: 'checking availability in Denver',
        runMs: 1050,
        citations: [
          { source: 'property', ref: 'property:SOL-DEN', label: 'Solstice Denver Union Station' },
        ],
      },
      {
        kind: 'tool',
        name: 'evaluate_group_rules',
        summary: 'applying the group booking rules',
        runMs: 820,
        citations: [
          { source: 'property', ref: 'property:SOL-DEN#discount_ceiling', label: 'Denver ski-weekend discount ceiling, 8%' },
          POLICY(13, 'Group block approval authority'),
        ],
      },
      { kind: 'tool', name: 'create_inquiry', summary: 'logging this for group sales', runMs: 640 },
      {
        kind: 'say',
        text:
          'I can get this moving. Your dates land on a ski-season weekend, and Denver caps group discounts at 8% on those. You asked for 12%, and that is above what I am allowed to approve, so I am not going to pretend otherwise. I have logged this as inquiry INQ-3041 and routed it to group sales with everything you gave me. They can approve the 12% if they think it is right, and you will hear back the same business day.',
      },
    ],
  },
  {
    id: 'pets',
    match: /\bpet\b|\bpets\b|\bdog\b|\bcat\b|service animal/i,
    steps: [
      {
        kind: 'tool',
        name: 'get_policy',
        summary: 'reading the pet policy',
        runMs: 760,
        citations: [POLICY(8, 'Pets and service animals')],
      },
      {
        kind: 'say',
        text:
          'Straight answer: pets are not permitted at any Solstice property, and there are no pet-friendly floors or exceptions. Service animals under the ADA are a different matter entirely. They are always welcome, they stay free, and there is no pet fee of any kind. We will only ask what task the animal is trained to perform, never for paperwork.',
      },
    ],
  },
  {
    id: 'service-recovery',
    needsIdentity: true,
    match: /refund|compensat|complain|noise|dirty|broken|terrible|awful|last month|bad stay/i,
    steps: [
      { kind: 'tool', name: 'identify_guest', summary: 'finding your profile', runMs: 480 },
      {
        kind: 'tool',
        name: 'check_service_recovery_eligibility',
        summary: 'checking the service recovery window',
        runMs: 900,
        citations: [POLICY(5, 'Service recovery window'), POLICY(7, 'Comp and service recovery authority')],
      },
      {
        kind: 'tool',
        name: 'create_escalation',
        summary: 'writing this up for a manager',
        runMs: 700,
      },
      {
        kind: 'say',
        text:
          'I am sorry, that is not the stay we want you to have had. I have to be honest with you about where this sits: our service recovery window is 72 hours after checkout, and this stay is outside it, which puts a refund above what I am allowed to decide. So I am not going to guess at an answer. I have written up what happened, with the dates and your reservation, and sent it to the property manager at Solstice Denver. Someone will come back to you today, and they do have the authority to say yes.',
      },
    ],
  },
  {
    id: 'parking',
    match: /park|valet|garage/i,
    steps: [
      {
        kind: 'tool',
        name: 'get_property_info',
        summary: 'pulling up the property fact sheet',
        runMs: 780,
        citations: [POLICY(12, 'Parking and valet'), { source: 'property', ref: 'property:SOL-CHI', label: 'Solstice Chicago Riverwalk' }],
      },
      {
        kind: 'say',
        text:
          'Parking is set per property rather than chain-wide, and I would rather not quote you a number I cannot stand behind. What I can tell you is that Chicago Riverwalk does have on-site parking. For the current nightly rate, the front desk there has the live number, and I can connect you now if that is useful.',
      },
    ],
  },
  {
    id: 'reservation-lookup',
    needsIdentity: true,
    match: /confirmation|reservation|my booking|\bR(ES-)?\d{4,}\b|check in|arrival|last name/i,
    steps: [
      { kind: 'tool', name: 'identify_guest', summary: 'finding your profile', runMs: 520 },
      {
        kind: 'tool',
        name: 'get_reservation',
        summary: 'checking your reservation',
        runMs: 860,
        citations: [
          { source: 'reservation', ref: 'reservation:RES-48213', label: 'Reservation RES-48213' },
        ],
      },
      {
        kind: 'say',
        text:
          'Found you. Solstice Denver Union Station, deluxe king, arriving Thursday and out on Sunday, Best Available Rate, with the card on file. Check-in opens at 3:00 PM. Anything you want me to set up before you arrive?',
      },
    ],
  },
]

const FALLBACK: Step[] = [
  { kind: 'tool', name: 'classify_intent', summary: 'understanding your request', runMs: 520 },
  {
    kind: 'say',
    text:
      'I can help with reservations, check-in and check-out, our policies, amenities, and group or event bookings across all 140 Solstice properties. Tell me a little more, or give me your confirmation number and I will start there. If it turns out to be something only a person should decide, I will say so and hand you to the right one rather than improvise.',
  },
]

export interface MockAgentOptions {
  /** Scale every delay. 0 makes the whole turn instant, which tests use. */
  speed?: number
  signal?: AbortSignal
}

/**
 * Yields the same `ChatWireEvent` sequence the real server would, at a pace
 * that looks like real work rather than a canned reply.
 */
export async function* mockAgentStream(
  request: ChatRequest,
  options: MockAgentOptions = {},
): AsyncGenerator<ChatWireEvent> {
  const { speed = 1, signal } = options
  const scale = (ms: number) => Math.round(ms * speed)

  const sessionId = request.session_id ?? 'mock-' + Math.random().toString(36).slice(2, 10)
  yield { type: 'session', session_id: sessionId }

  const script = SCRIPTS.find((candidate) => candidate.match.test(request.message))
  const steps = !script ? FALLBACK : script.needsIdentity && !TWO_FACTORS.test(request.message) ? VERIFY_FIRST : script.steps

  await sleep(scale(280), signal)

  for (const step of steps) {
    if (signal?.aborted) return

    if (step.kind === 'tool') {
      yield { type: 'tool', name: step.name, status: 'running', summary: step.summary, citations: [] }
      await sleep(scale(step.runMs), signal)
      if (signal?.aborted) return
      yield {
        type: 'tool',
        name: step.name,
        status: 'done',
        summary: step.result ?? step.summary,
        citations: step.citations ?? [],
      }
      await sleep(scale(120), signal)
      continue
    }

    for (const chunk of chunkForStreaming(step.text)) {
      if (signal?.aborted) return
      yield { type: 'delta', text: chunk }
      await sleep(scale(28 + Math.random() * 34), signal)
    }
  }

  yield { type: 'done', message_id: 'mock-msg-' + Math.random().toString(36).slice(2, 10) }
}

/** Splits into one-to-three-word chunks so deltas look like real token output. */
function chunkForStreaming(text: string): string[] {
  const words = text.split(/(\s+)/).filter((part) => part.length > 0)
  const chunks: string[] = []
  let buffer = ''
  let wordsInBuffer = 0
  const target = () => 1 + Math.floor(Math.random() * 3)
  let limit = target()

  for (const part of words) {
    buffer += part
    if (part.trim().length > 0) wordsInBuffer += 1
    if (wordsInBuffer >= limit) {
      chunks.push(buffer)
      buffer = ''
      wordsInBuffer = 0
      limit = target()
    }
  }
  if (buffer) chunks.push(buffer)
  return chunks
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (ms <= 0 || signal?.aborted) {
      resolve()
      return
    }
    let timer: ReturnType<typeof setTimeout>
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
