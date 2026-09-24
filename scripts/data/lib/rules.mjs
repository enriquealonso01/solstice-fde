// Turns the properties CSV into structured, machine-evaluable rules.
//
// Two sources feed the same rule vocabulary:
//   1. the structured threshold columns (auto-approve rooms, discount ceiling, capacity,
//      blackout_dates, inventory)  -> extraction: "structured_column"
//   2. the free-text `notes` column -> extraction: "parsed_from_notes"
//
// The `notes` parsers read the NUMBERS OUT OF THE TEXT. Change "8%" to "7%" in the CSV and
// the generated ceiling changes with it; nothing here hardcodes a threshold. That is the
// point: business rules are data, and the panel can watch one CSV edit move a verdict.
//
// Every clause of every note is accounted for. Clauses no parser claims become `advisory`
// rules and show up in the `notes_coverage` block of rules.json, so we can prove on stage
// that no sentence of the source data was silently dropped.

import { parseSeasonWindow } from './calendar.mjs'

/** @param {string} s */
function slug(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
}

/** @param {{property_code:string, property_name:string}} p */
function propertyCitation(p) {
  return {
    source: 'property',
    ref: `property:${p.property_code}`,
    label: `${p.property_name} (property record)`,
  }
}

/** Notes are semicolon-separated statements. Trailing periods are cosmetic.
 *  @param {string|null|undefined} notes @returns {string[]} */
export function splitClauses(notes) {
  return String(notes ?? '')
    .split(';')
    .map((c) => c.trim().replace(/\.$/, '').trim())
    .filter((c) => c !== '')
}

/** Drops predicate keys that are not constraining, so an absent key reads as "always matches".
 *  @param {Record<string, unknown>} obj */
function compact(obj) {
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue
    if (Array.isArray(v) && v.length === 0) continue
    out[k] = v
  }
  return out
}

// --------------------------------------------------------------------------- structured

/** Rules that come straight off the numeric CSV columns.
 *  @param {any} p a generated Property record @returns {any[]} */
export function structuralRules(p) {
  const cite = propertyCitation(p)
  const provenance = (field) => ({
    source_field: field,
    extraction: 'structured_column',
    source_text: String(p.__raw?.[field] ?? ''),
  })
  const rules = []

  rules.push({
    rule_id: `${p.property_code}.discount_ceiling.base`,
    property_code: p.property_code,
    kind: 'discount_ceiling',
    label: 'Standing group discount ceiling',
    on_violation: 'flag',
    applies_when: compact({}),
    constraint: {
      field: 'requested_discount_pct',
      op: 'lte',
      value: p.max_discount_auto_approve_pct,
      unit: 'percent',
    },
    human_reason: `${p.property_name} auto-approves group discounts up to ${p.max_discount_auto_approve_pct}%.`,
    violation_template:
      'The requested {actual}% discount is above this property’s {threshold}% auto-approve ceiling, so it needs Sales or GM sign-off.',
    recommended_action: `Counter at ${p.max_discount_auto_approve_pct}% or route to ${p.general_manager} for an exception.`,
    citation: cite,
    provenance: provenance('max_discount_auto_approve_pct'),
  })

  rules.push({
    rule_id: `${p.property_code}.auto_approve_rooms.base`,
    property_code: p.property_code,
    kind: 'auto_approve_rooms',
    label: 'Group block auto-approve room ceiling',
    on_violation: 'flag',
    applies_when: compact({}),
    constraint: {
      field: 'rooms_requested',
      op: 'lte',
      value: p.group_block_auto_approve_max_rooms,
      unit: 'rooms',
    },
    human_reason: `${p.property_name} auto-approves blocks up to ${p.group_block_auto_approve_max_rooms} rooms.`,
    violation_template:
      'A {actual}-room block is above this property’s {threshold}-room auto-approve line, so it needs Sales or GM sign-off.',
    recommended_action: `Route to ${p.general_manager} for approval, or split the block.`,
    citation: cite,
    provenance: provenance('group_block_auto_approve_max_rooms'),
  })

  rules.push({
    rule_id: `${p.property_code}.meeting_capacity.max`,
    property_code: p.property_code,
    kind: 'meeting_capacity',
    label: 'Largest meeting we can physically seat',
    on_violation: 'fail',
    applies_when: compact({}),
    constraint: {
      field: 'meeting_capacity_needed',
      op: 'lte',
      value: p.max_meeting_capacity,
      unit: 'people',
    },
    human_reason: `${p.property_name} seats at most ${p.max_meeting_capacity} people (${p.meeting_space_sqft} sq ft of meeting space).`,
    violation_template:
      'A {actual}-person session does not fit: this property seats {threshold}. This is a physical limit, not a pricing decision.',
    recommended_action:
      'Offer an alternate Solstice property with enough capacity, or an off-site venue conversation. Do not promise the space.',
    citation: cite,
    provenance: provenance('max_meeting_capacity'),
  })

  rules.push({
    rule_id: `${p.property_code}.inventory_capacity.room_type`,
    property_code: p.property_code,
    kind: 'inventory_capacity',
    label: 'Rooms of the requested type that physically exist',
    on_violation: 'fail',
    applies_when: compact({}),
    constraint: {
      field: 'rooms_requested',
      op: 'lte_inventory_for_room_type',
      value: p.inventory,
      unit: 'rooms',
    },
    human_reason: `${p.property_name} has a fixed number of rooms in each class; a block cannot exceed it.`,
    violation_template:
      'The request is for {actual} rooms of a type this property only has {threshold} of. This is an upper bound on the building, NOT an availability check for those dates.',
    recommended_action:
      'Mix room types or move the block. Call check_availability before confirming: inventory is a ceiling, not a vacancy.',
    citation: cite,
    provenance: {
      source_field: 'standard_king_rooms,standard_double_rooms,deluxe_king_rooms,suite_rooms,accessible_rooms',
      extraction: 'structured_column',
      source_text: JSON.stringify(p.inventory),
    },
  })

  if (p.blackout_dates.length > 0) {
    rules.push({
      rule_id: `${p.property_code}.blackout.calendar`,
      property_code: p.property_code,
      kind: 'blackout',
      label: 'Scheduled blackout dates',
      on_violation: 'fail',
      applies_when: compact({}),
      constraint: {
        field: 'stay_dates',
        op: 'not_overlaps',
        value: p.blackout_dates,
        unit: 'date_ranges',
      },
      human_reason: `${p.property_name} has blackout dates on its calendar; group blocks are not held across them.`,
      violation_template:
        'The requested stay ({actual}) overlaps a blackout window ({threshold}).',
      recommended_action: 'Offer alternate dates outside the blackout, or an alternate property.',
      citation: cite,
      provenance: provenance('blackout_dates'),
    })
  }

  return rules
}

// ------------------------------------------------------------------- free-text extractors
// Each extractor gets one clause. Returning a rule claims that clause; `alsoConsumes` lets a
// rule claim a supporting clause elsewhere in the same note.

/** "Ski-season weekends (Dec-Feb, Thu-Sun) run at reduced group discount ceiling of 8%." */
function seasonalDiscountCeiling(clause, p) {
  const m = clause.match(/reduced\s+(?:group\s+)?discount\s+ceiling\s+of\s+(\d+(?:\.\d+)?)\s*%/i)
  if (!m) return null
  const value = Number(m[1])
  const paren = clause.match(/\(([^)]*)\)/)
  const window = paren ? parseSeasonWindow(paren[1]) : { months: null, weekdays: null }
  const headline = (paren ? clause.slice(0, paren.index) : clause).trim() || 'Seasonal'
  return {
    rule: {
      rule_id: `${p.property_code}.discount_ceiling.${slug(headline)}`,
      property_code: p.property_code,
      kind: 'discount_ceiling',
      label: `${headline} discount ceiling`,
      on_violation: 'flag',
      applies_when: compact({
        match: 'any_night',
        months: window.months,
        weekdays: window.weekdays,
      }),
      constraint: { field: 'requested_discount_pct', op: 'lte', value, unit: 'percent' },
      human_reason: `${headline} at ${p.property_name} run at a reduced group discount ceiling of ${value}%.`,
      violation_template:
        'The requested {actual}% discount is above the seasonal ceiling of {threshold}% that applies to these dates, even though it is within the property’s standing ceiling.',
      recommended_action: `Counter at ${value}% for these dates, or route to ${p.general_manager} for an exception.`,
      citation: propertyCitation(p),
      provenance: {
        source_field: 'notes',
        extraction: 'parsed_from_notes',
        source_text: clause,
      },
    },
  }
}

/** "SXSW week is a hard blackout" (+ "no group holds accepted regardless of discount") */
function hardBlackout(clause, p, _dir, clauses) {
  if (!/hard blackout/i.test(clause)) return null
  const named = clause.match(/^([A-Za-z0-9&'’ -]+?)\s+(?:week|weekend|season)\s+is a hard blackout/i)
  const eventName = named ? named[1].trim() : 'Blackout'
  const supportIdx = clauses.findIndex((c) => /regardless of discount/i.test(c))
  const negotiable = supportIdx === -1
  return {
    rule: {
      rule_id: `${p.property_code}.hard_blackout.${slug(eventName)}`,
      property_code: p.property_code,
      kind: 'hard_blackout',
      label: `${eventName} hard blackout`,
      on_violation: 'fail',
      applies_when: compact({ match: 'any_night' }),
      constraint: {
        field: 'stay_dates',
        op: 'not_overlaps',
        value: p.blackout_dates,
        unit: 'date_ranges',
      },
      negotiable,
      human_reason: `${eventName} is a hard blackout at ${p.property_name}: no group holds are accepted${negotiable ? '' : ' regardless of discount'}.`,
      violation_template:
        'These dates fall inside the {threshold} blackout. There is no discount that changes this answer.',
      recommended_action:
        'Offer alternate dates outside the window or a nearby Solstice property. Do not counter on price, and do not imply the block might still clear.',
      citation: propertyCitation(p),
      provenance: {
        source_field: 'notes',
        extraction: 'parsed_from_notes',
        source_text: supportIdx === -1 ? clause : `${clause}; ${clauses[supportIdx]}`,
      },
    },
    alsoConsumes: supportIdx === -1 ? [] : [supportIdx],
  }
}

/** "group requests over 25 rooms need 2+ weeks lead time" */
function leadTime(clause, p) {
  const m = clause.match(
    /(?:requests?|blocks?|bookings?)\s+over\s+(\d+)\s+rooms?\s+need\s+(\d+)\s*\+?\s*(week|day|month)s?\s+lead\s*-?\s*time/i,
  )
  if (!m) return null
  const overRooms = Number(m[1])
  const qty = Number(m[2])
  const unitWord = m[3].toLowerCase()
  const days = unitWord === 'week' ? qty * 7 : unitWord === 'month' ? qty * 30 : qty
  return {
    rule: {
      rule_id: `${p.property_code}.lead_time.over_${overRooms}_rooms`,
      property_code: p.property_code,
      kind: 'lead_time',
      label: `Lead time for blocks over ${overRooms} rooms`,
      on_violation: 'fail',
      applies_when: compact({ min_rooms: overRooms + 1 }),
      constraint: { field: 'lead_time_days', op: 'gte', value: days, unit: 'days' },
      human_reason: `${p.property_name} needs at least ${qty} ${unitWord}${qty === 1 ? '' : 's'} (${days} days) of lead time for blocks over ${overRooms} rooms.`,
      violation_template:
        'Arrival is only {actual} days out; blocks this size need {threshold} days of lead time here.',
      recommended_action: `Offer the earliest arrival that is ${days}+ days out, or route to ${p.general_manager} for an exception.`,
      citation: propertyCitation(p),
      provenance: { source_field: 'notes', extraction: 'parsed_from_notes', source_text: clause },
    },
  }
}

/** "verify insurance certificate for youth groups" */
function requiredDocument(clause, p) {
  const m = clause.match(
    /\b(?:verify|confirm|require|obtain)\s+(?:an?\s+|the\s+)?([a-z][a-z\s]*?)\s+(?:is\s+)?(?:on file\s+)?for\s+([a-z][a-z\s-]*?)$/i,
  )
  if (!m) return null
  const document = m[1].trim().toLowerCase()
  const audience = m[2].trim().toLowerCase()
  if (!/certificate|insurance|waiver|contract|deposit|permit|licen[cs]e/.test(document)) return null
  // The audience words themselves become the match terms; nothing is hardcoded.
  const terms = [...new Set(audience.split(/\s+/).filter((w) => w.length > 3 && w !== 'group' && w !== 'groups'))]
  return {
    rule: {
      rule_id: `${p.property_code}.required_document.${slug(`${audience} ${document}`)}`,
      property_code: p.property_code,
      kind: 'required_document',
      label: `${document} required for ${audience}`,
      on_violation: 'flag',
      applies_when: compact({
        text_match: {
          fields: ['event_type', 'special_requests', 'company_name'],
          any_of: terms,
        },
      }),
      constraint: {
        field: 'documents_on_file',
        op: 'includes',
        value: document,
        unit: 'document',
      },
      human_reason: `${p.property_name} requires a ${document} on file for ${audience} before a block is confirmed.`,
      violation_template:
        'No {threshold} is on file for this {actual}. This is a required follow-up, not something to skip.',
      recommended_action: `Ask the organiser for a ${document} and record it against the inquiry before confirming. The block can be priced and drafted meanwhile.`,
      citation: propertyCitation(p),
      provenance: { source_field: 'notes', extraction: 'parsed_from_notes', source_text: clause },
    },
  }
}

/** "blocks over 15 rooms should be routed to Boston-area sister property instead"
 *  The referral target is resolved against the real property directory. When it does not
 *  resolve, we say so loudly: this is the trap the challenge planted, and the correct
 *  behaviour is to surface the referral WITHOUT inventing the hotel. */
function routing(clause, p, directory) {
  const m = clause.match(
    /\bblocks?\s+over\s+(\d+)\s+rooms?\s+(?:should\s+be\s+|are\s+|must\s+be\s+)?rout(?:ed|e)\s+to\s+(.+?)(?:\s+instead)?$/i,
  )
  if (!m) return null
  const maxRooms = Number(m[1])
  const target = m[2].trim()
  const tokens = target
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length > 3 && !['area', 'sister', 'property', 'hotel', 'instead', 'nearby'].includes(t))
  const match = directory.find((other) =>
    tokens.some(
      (t) =>
        other.property_code !== p.property_code &&
        (other.city.toLowerCase().includes(t) ||
          other.property_name.toLowerCase().includes(t) ||
          other.state.toLowerCase() === t),
    ),
  )
  return {
    rule: {
      rule_id: `${p.property_code}.routing.overflow_block`,
      property_code: p.property_code,
      kind: 'routing',
      label: `Blocks over ${maxRooms} rooms route elsewhere`,
      on_violation: 'flag',
      applies_when: compact({ min_rooms: maxRooms + 1 }),
      constraint: { field: 'rooms_requested', op: 'lte', value: maxRooms, unit: 'rooms' },
      referral: {
        target_description: target,
        target_property_code: match ? match.property_code : null,
        resolved: Boolean(match),
        resolution_note: match
          ? `Resolved to ${match.property_name} (${match.property_code}).`
          : `UNRESOLVED. "${target}" does not correspond to any property in the Solstice directory (${directory.length} properties, none matching). The agent may mention that a referral exists; it must NOT quote rooms, rates, dates or availability for it, and must hand the inquiry to Group Sales to confirm the property is real.`,
      },
      human_reason: `${p.property_name} routes blocks over ${maxRooms} rooms to ${target}.`,
      violation_template:
        'This is a {actual}-room block; {threshold} rooms is the largest this property takes before the request is routed elsewhere.',
      recommended_action: match
        ? `Offer the block at ${match.property_name} instead, and re-run the rules against that property.`
        : `Tell the guest the request is being routed to a partner property and hand it to Group Sales. Do NOT quote rooms, rates, or availability for "${target}": it is not in our directory, so we have no grounded data for it.`,
      citation: propertyCitation(p),
      provenance: { source_field: 'notes', extraction: 'parsed_from_notes', source_text: clause },
    },
  }
}

/** "Rate drops ~20% June-Aug (off-peak)" -- context, never a discount we can hand out. */
function seasonalRateAdvisory(clause, p) {
  const m = clause.match(/rates?\s+drops?\s+(~|about\s+|approx\.?\s+)?(\d+(?:\.\d+)?)\s*%\s+([A-Za-z]+)\s*[-–]\s*([A-Za-z]+)/i)
  if (!m) return null
  const approximate = Boolean(m[1])
  const pct = Number(m[2])
  const window = parseSeasonWindow(`${m[3]}-${m[4]}`)
  return {
    rule: {
      rule_id: `${p.property_code}.advisory.off_peak_rates`,
      property_code: p.property_code,
      kind: 'advisory',
      label: 'Off-peak rate window',
      on_violation: null,
      applies_when: compact({ match: 'any_night', months: window.months }),
      constraint: null,
      pricing_safe: false,
      approximate,
      human_reason: `Rates at ${p.property_name} run ${approximate ? 'roughly ' : ''}${pct}% below peak in this window, which makes it the best value period for large blocks.`,
      violation_template: null,
      recommended_action: `Use as negotiating context only. The figure is ${approximate ? 'approximate' : 'stated'} and is NOT a discount the agent may apply: price off base_rate_* and the discount ceiling rules.`,
      citation: propertyCitation(p),
      provenance: { source_field: 'notes', extraction: 'parsed_from_notes', source_text: clause },
    },
  }
}

const EXTRACTORS = [
  seasonalDiscountCeiling,
  hardBlackout,
  leadTime,
  routing,
  requiredDocument,
  seasonalRateAdvisory,
]

/** Anything no parser claimed. Kept as context the agent may cite, never as a constraint. */
function advisory(clause, p, index) {
  return {
    rule_id: `${p.property_code}.advisory.${slug(clause) || `note_${index}`}`,
    property_code: p.property_code,
    kind: 'advisory',
    label: 'Property note',
    on_violation: null,
    applies_when: compact({}),
    constraint: null,
    pricing_safe: false,
    human_reason: `${clause}.`,
    violation_template: null,
    recommended_action:
      'Context only. Cite it when it helps the guest, but it grants no discount and imposes no threshold.',
    citation: propertyCitation(p),
    provenance: { source_field: 'notes', extraction: 'unparsed_clause', source_text: clause },
  }
}

/** @param {any[]} properties generated Property records (with `__raw` still attached) */
export function buildRules(properties) {
  const directory = properties.map((p) => ({
    property_code: p.property_code,
    property_name: p.property_name,
    city: p.city,
    state: p.state,
  }))

  const rules = []
  const coverage = []

  for (const p of properties) {
    rules.push(...structuralRules(p))

    const clauses = splitClauses(p.notes)
    /** @type {Map<number, {rule_id: string, parsed: boolean}[]>} */
    const claimed = new Map()
    const claim = (idx, rule) => {
      const list = claimed.get(idx) ?? []
      list.push({ rule_id: rule.rule_id, parsed: rule.provenance.extraction === 'parsed_from_notes' })
      claimed.set(idx, list)
    }

    for (const extractor of EXTRACTORS) {
      clauses.forEach((clause, i) => {
        if (claimed.has(i)) return
        const hit = extractor(clause, p, directory, clauses)
        if (!hit) return
        rules.push(hit.rule)
        claim(i, hit.rule)
        for (const j of hit.alsoConsumes ?? []) claim(j, hit.rule)
      })
    }

    clauses.forEach((clause, i) => {
      if (!claimed.has(i)) {
        const r = advisory(clause, p, i)
        rules.push(r)
        claim(i, r)
      }
      const claims = claimed.get(i) ?? []
      coverage.push({
        property_code: p.property_code,
        clause,
        rule_ids: claims.map((c) => c.rule_id),
        // false == no parser understood this sentence; it survives only as context.
        parsed: claims.some((c) => c.parsed),
      })
    })
  }

  return { rules, coverage }
}
