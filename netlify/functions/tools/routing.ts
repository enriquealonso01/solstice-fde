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
import { normalizeText, optString, policyCitation, type ToolArgs, type ToolContext } from './helpers'
import { GROUP_BLOCK_RULES } from './rules'
import { inferCategory } from './escalation'

export type Intent = 'safety_escalation' | 'group_booking' | 'guest_concierge' | 'mixed' | 'unclear'

const SAFETY_SIGNALS = ['threat', 'weapon', 'assault', 'police', 'law enforcement', 'unsafe', 'intruder', 'harass', 'ambulance', 'injured', 'chest pain', 'unconscious', 'emergency']

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

  const q = normalizeText(utterance)
  const signals: string[] = []

  const safetyHits = SAFETY_SIGNALS.filter((s) => q.includes(normalizeText(s)))
  const groupHits = GROUP_SIGNALS.filter((s) => q.includes(normalizeText(s)))
  const conciergeHits = CONCIERGE_SIGNALS.filter((s) => q.includes(normalizeText(s)))
  const roomCount = extractRoomCount(utterance)

  signals.push(...safetyHits.map((s) => `safety:${s}`))
  signals.push(...groupHits.map((s) => `group:${s}`))
  signals.push(...conciergeHits.map((s) => `concierge:${s}`))
  if (roomCount !== null) signals.push(`rooms:${roomCount}`)

  // Rule 1. Safety outranks everything, including a perfectly ordinary booking
  // question in the same sentence.
  if (safetyHits.length > 0) {
    return toolOk(
      {
        intent: 'safety_escalation' as Intent,
        confidence: 'high',
        signals,
        escalation_category: inferCategory(utterance),
        route: 'Escalate now under Policy 15 before answering anything else in the message.',
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
