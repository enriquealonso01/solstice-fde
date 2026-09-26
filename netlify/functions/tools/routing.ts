/**
 * classify_intent: the one routing decision Sol makes before anything else.
 *
 * This is deliberately deterministic. Routing a guest to the wrong side of the
 * house is the kind of failure a demo audience notices, and Policy 13 makes it a
 * compliance question rather than a preference: the front desk may not approve,
 * modify, price or discount a group block, so a group request has to LEAVE the
 * concierge lane rather than be answered in it.
 */
import type { ToolResult } from '../../../shared/types'
import { toolFail, toolOk, toolState } from './_deps'
import { optString, policyCitation, type ToolArgs, type ToolContext } from './helpers'
import { GROUP_BLOCK_RULES, type EscalationCategory } from './rules'

export type Intent =
  | 'safety_escalation'
  | 'medical_emergency'
  | 'legal_threat'
  | 'group_booking'
  | 'guest_concierge'
  | 'mixed'
  | 'unclear'

/**
 * Messages that must reach a human in the same turn, in priority order. chat.ts escalates them in
 * code before the model answers, so every signal here files a real escalation: they are whole-word
 * phrases that mean urgency, not topics ("police station", "I'm an attorney" and "emergency exit"
 * are ordinary questions).
 */
const URGENT: Array<{ intent: Intent; category: EscalationCategory; signals: string[] }> = [
  {
    intent: 'safety_escalation',
    category: 'safety',
    signals: [
      'fire', 'smell smoke', 'full of smoke', 'gun', 'gunshot', 'shooting', 'shots fired', 'weapon', 'bomb',
      'pulled a knife', 'has a knife', 'assault', 'assaulted', 'attacked', 'violence', 'violent', 'intruder', 'broke into',
      'broken into', 'breaking into', 'following me', 'stalking', 'harassed', 'harassing', 'harassment', 'threatened me',
      'threatening me', 'threatened us', 'threatening us', 'death threat', 'feel unsafe', "don't feel safe", 'in danger',
      'call the police', 'called the police', 'calling the police', 'this is an emergency', "it's an emergency",
      'missing child', 'child is missing',
    ],
  },
  {
    intent: 'medical_emergency',
    category: 'medical',
    signals: [
      'medical emergency', 'chest pain', 'chest pains', 'heart attack', 'stroke', "can't breathe", 'cant breathe',
      'cannot breathe', 'not breathing', 'trouble breathing', 'unconscious', 'unresponsive', 'collapsed', 'fainted',
      'passed out', 'seizure', 'overdose', 'overdosed', 'choking', 'bleeding', 'allergic reaction', 'anaphylactic',
      'ambulance', 'paramedic', 'paramedics', 'injured', 'slipped and fell',
    ],
  },
  {
    intent: 'legal_threat',
    category: 'legal',
    signals: [
      'lawsuit', 'legal action', 'sue you', 'sue the', 'sue your', 'going to sue', 'will sue', "i'll sue", 'sued', 'suing',
      'see you in court', 'take you to court', 'taking you to court', 'small claims', 'my lawyer', 'my lawyers',
      'my attorney', 'our lawyer', 'our attorney', 'get a lawyer', 'getting a lawyer', 'my solicitor', 'negligence', 'negligent',
    ],
  },
]

/** Ordinary phrases that contain an urgent word, removed before URGENT is matched. */
const NOT_URGENT = ['fire pit', 'fire pits', 'fire place', 'fire exit', 'fire exits', 'fire escape', 'fire door', 'fire safety']

/** The escalation category an intent obliges this turn, or null for an ordinary one. */
export function mustEscalate(intent: unknown): EscalationCategory | null {
  return URGENT.find((u) => u.intent === intent)?.category ?? null
}

const GROUP_SIGNALS = [
  'room block',
  'block of rooms',
  'group rate',
  'group booking',
  'group block',
  'wedding block',
  'corporate retreat',
  'conference',
  'our team',
  'our group',
  'delegates',
  'attendees',
  'meeting space',
  'ballroom',
  'breakout room',
  'rooming list',
  'reunion',
  'youth group',
  'sports team',
  'offsite',
  'off-site',
]

const CONCIERGE_SIGNALS = [
  'my reservation',
  'my booking',
  'my stay',
  'confirmation number',
  'check in',
  'check out',
  'checkout',
  'late checkout',
  'upgrade',
  'cancel',
  'refund',
  'parking',
  'pet',
  'service animal',
  'wifi',
  'breakfast',
  'loyalty',
  'points',
  'amenity',
  'rollaway',
  'smoking',
  'lost',
]

/** Lower-case words, single-spaced and padded, so "I can't breathe!" becomes " i can t breathe ". */
function words(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `
}

/** "15 rooms", "a block of 40", "20 guest rooms" -> the number. */
function extractRoomCount(text: string): number | null {
  const patterns = [/(\d{1,4})\s*(?:guest\s*)?rooms?/i, /block\s*of\s*(\d{1,4})/i, /(\d{1,4})\s*(?:keys|nights? for \d+ rooms)/i]
  for (const p of patterns) {
    const m = text.match(p)
    if (m) {
      const n = Number.parseInt(m[1], 10)
      if (Number.isFinite(n)) return n
    }
  }
  return null
}

export async function classifyIntent(args: ToolArgs, _ctx: ToolContext): Promise<ToolResult> {
  const utterance = optString(args, 'utterance') ?? optString(args, 'message') ?? optString(args, 'text')
  if (!utterance) return toolFail('Need the guest message to classify.')

  const said = words(utterance)
  // Urgent signals match whole words only. Group and concierge signals match at the start of a word,
  // so "pet" matches "pets" but not "carpet".
  const urgentText = NOT_URGENT.reduce((text, phrase) => text.split(words(phrase)).join(' '), said)
  const urgentSaid = (signal: string) => urgentText.includes(words(signal))
  const startsAWord = (signal: string) => said.includes(words(signal).trimEnd())
  const signals: string[] = []

  const urgentHits = URGENT.map((u) => ({ ...u, hits: u.signals.filter(urgentSaid) }))
  const groupHits = GROUP_SIGNALS.filter(startsAWord)
  const conciergeHits = CONCIERGE_SIGNALS.filter(startsAWord)
  const roomCount = extractRoomCount(utterance)

  for (const u of urgentHits) signals.push(...u.hits.map((s) => `${u.category}:${s}`))
  signals.push(...groupHits.map((s) => `group:${s}`))
  signals.push(...conciergeHits.map((s) => `concierge:${s}`))
  if (roomCount !== null) signals.push(`rooms:${roomCount}`)

  // Rule 1. Safety, medical and legal outrank everything, including a perfectly ordinary booking
  // question in the same sentence.
  const urgent = urgentHits.find((u) => u.hits.length > 0)
  if (urgent) {
    return toolOk(
      {
        intent: urgent.intent,
        confidence: 'high',
        signals,
        escalation_category: urgent.category,
        route: `Policy 15: call create_escalation with category "${urgent.category}" in this reply, before answering anything else in the message.`,
      },
      { citations: [policyCitation(15)] },
    )
  }

  const roomsSuggestGroup = roomCount !== null && roomCount >= GROUP_BLOCK_RULES.group_intent_room_threshold
  const isGroup = groupHits.length > 0 || roomsSuggestGroup

  // Rule 2 and 3. A group request leaves the concierge lane, because Policy 13
  // puts pricing and approval with Sales and the GM.
  if (isGroup && conciergeHits.length > 0) {
    return toolOk(
      {
        intent: 'mixed' as Intent,
        confidence: 'medium',
        signals,
        rooms_requested: roomCount,
        route:
          'Answer the personal concierge part yourself, then capture the group part as an inquiry for Sales. Do not price, discount or approve any part of the block.',
        group_authority: GROUP_BLOCK_RULES.authority,
      },
      { citations: [policyCitation(13)] },
    )
  }

  if (isGroup) {
    return toolOk(
      {
        intent: 'group_booking' as Intent,
        confidence: groupHits.length > 0 ? 'high' : 'medium',
        signals,
        rooms_requested: roomCount,
        route:
          'Switch to the group capture script: company, contact name, email or phone, property, dates, room count, room type, meeting space needed, and anything special. Then create the inquiry. Never quote a group rate or a discount.',
        group_authority: GROUP_BLOCK_RULES.authority,
        front_desk_may_price: GROUP_BLOCK_RULES.front_desk_may_discount,
      },
      { citations: [policyCitation(13)] },
    )
  }

  if (conciergeHits.length > 0) {
    return toolState(
      {
        intent: 'guest_concierge' as Intent,
        confidence: 'high',
        signals,
        route: 'Handle it on the concierge tools. Identify the guest before releasing any stay detail.',
      },
      {},
    )
  }

  // Rule 5. One clarifying question beats a confident guess.
  return toolState(
    {
      intent: 'unclear' as Intent,
      confidence: 'low',
      signals,
      route: 'Ask one short clarifying question. Do not assume which side of the house this belongs to.',
    },
    {},
  )
}
