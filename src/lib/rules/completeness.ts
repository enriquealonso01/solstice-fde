// Completeness: what we must know before a proposal is even arithmetic.
//
// An incomplete inquiry is not a cheap proposal, it is a wrong one. The engine refuses to price
// until the required fields are present and instead hands the rep (or the agent) a short list of
// questions written the way a salesperson would actually ask them.

import type { GroupInquiry } from '../../../shared/types'
import { parseDate } from './dates'

export type RequiredField =
  | 'arrival_date'
  | 'departure_date'
  | 'rooms_requested'
  | 'room_type_preference'
  | 'meeting_capacity_needed'
  | 'contact_channel'

/** The requirement table. Adding a required field is a one-line edit here. */
interface FieldSpec {
  field: RequiredField
  /** Blocks pricing entirely when missing. */
  blocking: boolean
  question: string
  /** Only required when this predicate says so. */
  requiredWhen?: (inquiry: GroupInquiry) => boolean
}

const FIELD_SPECS: FieldSpec[] = [
  {
    field: 'arrival_date',
    blocking: true,
    question: 'What is the arrival date for the block?',
  },
  {
    field: 'departure_date',
    blocking: true,
    question: 'What is the departure date, so we know how many nights to hold?',
  },
  {
    field: 'rooms_requested',
    blocking: true,
    question: 'How many rooms do you need? We need an exact number to hold inventory.',
  },
  {
    field: 'room_type_preference',
    blocking: false,
    question:
      'Which room type would you like the block in, standard king, standard double, or deluxe king?',
  },
  {
    field: 'meeting_capacity_needed',
    blocking: false,
    question: 'How many people need to fit in the meeting space at one time?',
    // Only asked when the customer actually wants meeting space. The parser records that by
    // listing the field in `missing_fields`; a group that ticked "no meeting space" never
    // gets asked, which is why a room-block-only inquiry stays clean.
    requiredWhen: (inquiry) =>
      inquiry.missing_fields.includes('meeting_capacity_needed') ||
      (inquiry.meeting_capacity_needed ?? 0) > 0,
  },
  {
    field: 'contact_channel',
    blocking: true,
    question: 'What is the best email address or mobile number to send the proposal to?',
  },
]

/** Facts the engine cannot read off a `GroupInquiry` because the record it is handed has been
 *  redacted. The inquiry inbox nulls the real email and phone so nothing downstream can leak
 *  them; "is there a way to reach this customer" therefore has to be told to us. */
export interface CompletenessContext {
  contact_present?: boolean
}

function isPresent(inquiry: GroupInquiry, field: RequiredField, context: CompletenessContext): boolean {
  switch (field) {
    case 'arrival_date':
      return parseDate(inquiry.arrival_date) !== null
    case 'departure_date':
      return parseDate(inquiry.departure_date) !== null
    case 'rooms_requested':
      return typeof inquiry.rooms_requested === 'number' && Number.isFinite(inquiry.rooms_requested) && inquiry.rooms_requested > 0
    case 'room_type_preference':
      return Boolean(inquiry.room_type_preference && inquiry.room_type_preference.trim())
    case 'meeting_capacity_needed':
      return typeof inquiry.meeting_capacity_needed === 'number' && inquiry.meeting_capacity_needed > 0
    case 'contact_channel':
      if (typeof context.contact_present === 'boolean') return context.contact_present
      return Boolean(inquiry.contact_email?.trim() || inquiry.contact_phone?.trim())
    default:
      return true
  }
}

export interface CompletenessResult {
  complete: boolean
  /** Missing and blocking: no proposal can be produced. */
  blocking_missing: RequiredField[]
  /** Missing but not blocking: we can price, we just ask alongside. */
  advisory_missing: RequiredField[]
  /** Ready to read aloud or paste into an email, in asking order. */
  questions: string[]
}

/** `rawValues` lets a question quote back what the customer actually wrote, e.g. the
 *  "around 25" in INQ-2004, instead of pretending they said nothing at all. */
export function assessCompleteness(
  inquiry: GroupInquiry,
  rawValues: Partial<Record<RequiredField, string>> = {},
  context: CompletenessContext = {},
): CompletenessResult {
  const blocking: RequiredField[] = []
  const advisory: RequiredField[] = []
  const questions: string[] = []

  for (const spec of FIELD_SPECS) {
    if (spec.requiredWhen && !spec.requiredWhen(inquiry)) continue
    if (isPresent(inquiry, spec.field, context)) continue

    const raw = rawValues[spec.field]?.trim()
    const question =
      raw && spec.field === 'rooms_requested'
        ? `You mentioned "${raw}" rooms. Can you confirm the exact room count? We need a firm number to hold inventory.`
        : spec.question

    questions.push(question)
    if (spec.blocking) blocking.push(spec.field)
    else advisory.push(spec.field)
  }

  return {
    complete: blocking.length === 0 && advisory.length === 0,
    blocking_missing: blocking,
    advisory_missing: advisory,
    questions,
  }
}

const FIELD_LABELS: Record<RequiredField, string> = {
  arrival_date: 'arrival date',
  departure_date: 'departure date',
  rooms_requested: 'exact room count',
  room_type_preference: 'room type',
  meeting_capacity_needed: 'meeting headcount',
  contact_channel: 'email address or mobile number',
}

export function describeMissing(fields: RequiredField[]): string {
  const labels = fields.map((field) => FIELD_LABELS[field])
  if (labels.length === 0) return ''
  if (labels.length === 1) return labels[0]
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}
