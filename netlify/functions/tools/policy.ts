/**
 * get_policy and get_property_info.
 *
 * get_property_info carries two of the sharpest guardrails in the build:
 *  - POLICY 12: there is no chain-wide parking rate, so this tool can never
 *    return one. The refusal is the grounded answer, not a failure.
 *  - DATA QUARANTINE: SOL-PVD's suite base rate is -395 in the export. A negative
 *    nightly rate is impossible, so it is reported as unavailable. It is never
 *    "corrected" to 395 and never priced off.
 */
import type { Citation, ToolResult } from '../../../shared/types'
import { getPropertyRate, loadPolicies, toolFail, toolOk } from './_deps'
import { normalizeText, optString, policyCitation, propertyCitation, type ToolArgs, type ToolContext } from './helpers'
import { resolveProperty } from './lookups'
import { PARKING_RULES, POLICY_INDEX, type PolicyIndexEntry } from './rules'
import { describeNoteRules } from '../../../src/lib/rules/seasonal'

// ------------------------------------------------------------------ get_policy

function scoreEntry(entry: PolicyIndexEntry, query: string): number {
  const q = normalizeText(query)
  if (!q) return 0
  let score = 0
  for (const keyword of entry.keywords) {
    if (q.includes(normalizeText(keyword))) score += 3
  }
  for (const word of q.split(' ')) {
    if (word.length < 4) continue
    if (normalizeText(entry.title).includes(word)) score += 2
    if (normalizeText(entry.summary).includes(word)) score += 1
  }
  return score
}

async function bodyFor(sectionId: string): Promise<string | null> {
  try {
    const sections = await loadPolicies()
    const hit = sections.find((s) => String(s.section_id) === sectionId)
    return hit?.body ?? null
  } catch {
    // The policies table may not be seeded yet. The structured index below is
    // still a grounded answer, so degrade rather than fail the guest's question.
    return null
  }
}

export async function getPolicy(args: ToolArgs, _ctx: ToolContext): Promise<ToolResult> {
  const sectionId = optString(args, 'section_id')
  const query = optString(args, 'query') ?? optString(args, 'topic') ?? ''

  if (sectionId) {
    const entry = POLICY_INDEX.find((p) => p.section_id === String(sectionId).replace(/\D/g, ''))
    if (!entry) return toolFail(`No policy section ${sectionId} exists. The reference has sections 1 through 15.`)
    return toolOk(
      {
        sections: [
          {
            section_id: entry.section_id,
            title: entry.title,
            rule: entry.summary,
            facts: entry.facts ?? null,
            body: await bodyFor(entry.section_id),
          },
        ],
        match_quality: 'exact_section',
      },
      { citations: [policyCitation(entry.section_id)] },
    )
  }

  if (!query) {
    return toolFail('Supply either a section_id or a query describing what the guest asked about.')
  }

  const ranked = POLICY_INDEX.map((entry) => ({ entry, score: scoreEntry(entry, query) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)

  if (ranked.length === 0) {
    // No grounding. This is the whole point of the envelope: the agent must say
    // it cannot confirm and escalate, never reason its way to an answer.
    return toolFail(
      `No policy section covers "${query}". Tell the guest you cannot confirm that from the policy reference, and hand it to the property team.`,
    )
  }

  const sections = []
  for (const { entry } of ranked) {
    sections.push({
      section_id: entry.section_id,
      title: entry.title,
      rule: entry.summary,
      facts: entry.facts ?? null,
      body: await bodyFor(entry.section_id),
    })
  }

  return toolOk(
    { sections, match_quality: ranked[0].score >= 3 ? 'keyword_match' : 'weak_match' },
    { citations: ranked.map((r) => policyCitation(r.entry.section_id)) },
  )
}

// ----------------------------------------------------------- get_property_info

const PARKING_WORDS = ['parking', 'park', 'valet', 'garage', 'car', 'vehicle']

/**
 * Rates come from `getPropertyRate` and nowhere else. It is the function that quarantines
 * SOL-PVD's `base_rate_suite = -395`: reading `property.base_rate_suite` directly here would
 * quietly reintroduce the exact bug the data was planted to catch.
 */
function referenceRate(propertyCode: string, roomClass: string): { value: number | null; unavailable_reason: string | null } {
  const lookup = getPropertyRate(propertyCode, roomClass)
  if (lookup.ok) return { value: lookup.nightly_rate, unavailable_reason: null }
  return { value: null, unavailable_reason: lookup.reason }
}

export async function getPropertyInfo(args: ToolArgs, _ctx: ToolContext): Promise<ToolResult> {
  const code = optString(args, 'property_code') ?? optString(args, 'property') ?? optString(args, 'city')
  const topic = optString(args, 'topic') ?? optString(args, 'query') ?? ''

  if (!code) return toolFail('Need a property: a code such as SOL-CHI, or the city or hotel name the guest used.')

  const resolved = await resolveProperty(code)
  if (resolved.status === 'ambiguous') {
    return toolFail(
      `"${code}" matches more than one Solstice property (${resolved.candidates
        .map((c) => `${c.property_name} in ${c.city}`)
        .join('; ')}). Ask the guest which one they mean rather than choosing.`,
    )
  }
  if (resolved.status === 'not_found') {
    return toolFail(
      `"${code}" is not a Solstice property in our directory. Do not describe a property we do not hold a record for.`,
    )
  }
  const property = resolved.property

  const askedAboutParking = PARKING_WORDS.some((w) => normalizeText(topic).includes(w))

  const standard = referenceRate(property.property_code, 'Standard King')
  const deluxe = referenceRate(property.property_code, 'Deluxe King')
  const suite = referenceRate(property.property_code, 'Suite')

  const citations: Citation[] = [propertyCitation(property.property_code, property.property_name)]
  if (askedAboutParking) citations.push(policyCitation(12))

  const data = {
    property: {
      property_code: property.property_code,
      property_name: property.property_name,
      city: property.city,
      state: property.state,
      market_type: property.market_type,
      total_rooms: property.total_rooms,
      meeting_space_sqft: property.meeting_space_sqft,
      max_meeting_capacity: property.max_meeting_capacity,
      general_manager: property.general_manager,
      blackout_dates: property.blackout_dates,
    },
    // POLICY 12. There is no chain-wide parking rate, and no property record in
    // the provided data carries one. This block is always present so no runtime
    // can conclude we simply failed to look it up.
    parking: {
      rate_available: false,
      chain_wide_rate_exists: PARKING_RULES.chain_wide_rate_exists,
      varies_by_property: PARKING_RULES.varies_by_property,
      known_arrangements: PARKING_RULES.known_arrangements,
      guidance: PARKING_RULES.guidance,
      instruction_to_agent:
        'Do not quote a parking price, an estimate, a range, or a number you recall from anywhere. Say the rate varies by property, that we do not carry a chain-wide rate, and point the guest to the on-site front desk team.',
    },
    reference_rates: {
      // Published starting rates from the property export, not live pricing.
      standard: standard.value,
      deluxe: deluxe.value,
      suite: suite.value,
      currency: 'USD',
      basis: 'published base rate per night from the property record',
      live_pricing_available: false,
      withheld: [standard, deluxe, suite]
        .map((r, i) => ({ field: ['standard', 'deluxe', 'suite'][i], reason: r.unavailable_reason }))
        .filter((r) => r.reason !== null),
    },
    data_quality_flags: property.data_quality_flags ?? [],
    // The rules in raw_note, from the same constants the group engine enforces.
    structured_notes: describeNoteRules(property.property_code),
    raw_note: property.notes ?? null,
    ...(askedAboutParking ? { answering: 'parking', refusal: 'no chain-wide parking rate exists' } : {}),
  }

  return toolOk(data, { citations })
}
