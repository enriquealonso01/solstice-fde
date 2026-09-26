#!/usr/bin/env node
// Builds data/generated/*.json from the four provided files in data/.
//
//   node scripts/data/build.mjs            # write
//   node scripts/data/build.mjs --check    # fail if the checked-in output is stale
//
// Output is DETERMINISTIC on purpose: no timestamps in the payloads, stable key order,
// stable sort. A diff in data/generated therefore means the source data or a parser changed,
// which is exactly what you want to see in review. Provenance lives in manifest.json as a
// sha256 of every input file.
//
// Masking is imported from netlify/functions/_lib/mask.ts (Node 24 strips the types), so the
// PII rules applied here at rest are literally the same code the runtime uses.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

import { parseCsvObjects, str, num, bool } from './lib/csv.mjs'
import { parseDateRanges } from './lib/calendar.mjs'
import { buildRules } from './lib/rules.mjs'
import { generatedDir, SOURCE_FILES } from './lib/paths.mjs'
import { maskEmail, maskPhone, last4 } from '../../netlify/functions/_lib/mask.ts'
import { phoneLookupKey, emailLookupKey } from '../../netlify/functions/_lib/lookup.ts'
import { INVENTORY_COLUMNS } from '../../netlify/functions/_lib/roomTypes.ts'

const CHECK_ONLY = process.argv.includes('--check')

// --------------------------------------------------------------------------- properties

function buildProperties(rows) {
  return rows.map((row) => {
    /** @type {string[]} */
    const flags = []

    /** @type {Record<string, number>} */
    const inventory = {}
    for (const [column, label] of Object.entries(INVENTORY_COLUMNS)) {
      const value = num(row[column])
      if (value === null) flags.push(`inventory_${column}_unparsed`)
      inventory[label] = value ?? 0
    }

    const totalRooms = num(row.total_rooms) ?? 0
    const inventorySum = Object.values(inventory).reduce((a, b) => a + b, 0)
    if (inventorySum !== totalRooms) flags.push('inventory_sum_mismatch')

    const rates = {
      standard: num(row.base_rate_standard),
      deluxe: num(row.base_rate_deluxe),
      suite: num(row.base_rate_suite),
    }
    for (const [key, value] of Object.entries(rates)) {
      if (value === null) flags.push(`base_rate_${key}_missing`)
      else if (value < 0) flags.push(`base_rate_${key}_negative`)
      else if (value === 0) flags.push(`base_rate_${key}_zero`)
    }

    const { ranges, unparsed } = parseDateRanges(row.blackout_dates)
    if (unparsed.length > 0) flags.push('blackout_dates_unparsed')

    const maxDiscount = num(row.max_discount_auto_approve_pct)
    if (maxDiscount === null || maxDiscount < 0 || maxDiscount > 100) {
      flags.push('max_discount_auto_approve_pct_out_of_range')
    }

    return {
      property_code: row.property_code,
      property_name: row.property_name,
      city: row.city,
      state: row.state,
      market_type: row.market_type,
      total_rooms: totalRooms,
      inventory,
      base_rate_standard: rates.standard ?? 0,
      base_rate_deluxe: rates.deluxe ?? 0,
      base_rate_suite: rates.suite ?? 0,
      meeting_space_sqft: num(row.meeting_space_sqft) ?? 0,
      max_meeting_capacity: num(row.max_meeting_capacity) ?? 0,
      group_block_auto_approve_max_rooms: num(row.group_block_auto_approve_max_rooms) ?? 0,
      max_discount_auto_approve_pct: maxDiscount ?? 0,
      blackout_dates: ranges,
      general_manager: row.general_manager,
      notes: row.notes,
      data_quality_flags: flags,
      // stripped before writing; the rule builder wants the raw cells for provenance
      __raw: row,
    }
  })
}

// --------------------------------------------------------------- guests and reservations

function buildGuestsAndReservations(rows) {
  /** @type {Map<string, any>} */
  const guests = new Map()
  const reservations = []

  for (const row of rows) {
    if (!guests.has(row.guest_id)) {
      guests.set(row.guest_id, {
        guest_id: row.guest_id,
        first_name: row.first_name,
        last_name: row.last_name,
        email_masked: maskEmail(row.email),
        phone_masked: maskPhone(row.phone),
        // One-way keys so an inbound caller ID can still be matched without the number
        // ever being stored. See netlify/functions/_lib/lookup.ts.
        phone_lookup: phoneLookupKey(row.phone),
        email_lookup: emailLookupKey(row.email),
        loyalty_tier: str(row.loyalty_tier) ?? 'None',
        loyalty_points: num(row.loyalty_points) ?? 0,
        member_since: str(row.member_since),
        marketing_opt_in: bool(row.marketing_opt_in),
      })
    }

    reservations.push({
      reservation_id: row.reservation_id,
      guest_id: row.guest_id,
      property_code: row.property_code,
      check_in_date: row.check_in_date,
      check_out_date: row.check_out_date,
      room_type: row.room_type,
      rate_plan: row.rate_plan,
      nightly_rate: num(row.nightly_rate) ?? 0,
      total_nights: num(row.total_nights) ?? 0,
      status: row.reservation_status,
      payment_last4: last4(row.payment_method_last4),
      special_requests: str(row.special_requests),
      internal_notes: str(row.internal_notes),
    })
  }

  return {
    guests: [...guests.values()].sort((a, b) => a.guest_id.localeCompare(b.guest_id)),
    reservations: reservations.sort((a, b) => a.reservation_id.localeCompare(b.reservation_id)),
  }
}

// ----------------------------------------------------------------------------- policies

const KEEP_UPPER = new Set(['ID', 'AGM', 'GM', 'ADA', 'VIP', 'AV', 'PM', 'AM'])
const SMALL_WORDS = new Set(['and', 'or', 'the', 'a', 'an', 'at', 'of', 'for', 'in', 'to', 'on', 'with', 'per'])

function titleCase(raw) {
  const words = raw.trim().split(/\s+/)
  return words
    .map((word, i) => {
      if (KEEP_UPPER.has(word)) return word
      const lower = word.toLowerCase()
      if (i > 0 && SMALL_WORDS.has(lower)) return lower
      // Hyphenated words get each part capitalised: CHECK-IN -> Check-In
      return lower.replace(/(^|[-/])([a-z])/g, (_m, sep, ch) => sep + ch.toUpperCase())
    })
    .join(' ')
}

function buildPolicies(markdown) {
  const lines = markdown.split(/\r?\n/)
  const headerAt = []
  lines.forEach((line, i) => {
    const m = line.match(/^(\d{1,2})\.\s+([A-Z][A-Z0-9 ,/&'-]+)\s*$/)
    if (m) headerAt.push({ index: i, number: Number(m[1]), title: m[2].trim() })
  })

  if (headerAt.length === 0) throw new Error('No numbered policy sections found in the policy markdown.')

  const preamble = lines
    .slice(1, headerAt[0].index)
    .join('\n')
    .trim()

  const sections = headerAt.map((h, i) => {
    const end = i + 1 < headerAt.length ? headerAt[i + 1].index : lines.length
    const body = lines
      .slice(h.index + 1, end)
      .join('\n')
      .trim()
    return {
      section_id: `policy:${h.number}`,
      number: h.number,
      title: titleCase(h.title),
      title_source: h.title,
      body,
    }
  })

  const document = {
    title: lines[0].trim(),
    preamble,
    source_file: 'data/SOLSTICE HOTEL GROUP — FRONT DESK POLICY REFERENCE.md',
    section_count: sections.length,
  }

  return { sections, document }
}

// ---------------------------------------------------------------------------- inquiries

// Blocking: without these we cannot price, date, or place the block at all.
const HARD_REQUIRED = [
  'company_name',
  'contact_name',
  'preferred_property_code',
  'arrival_date',
  'departure_date',
  'rooms_requested',
]
// Non-blocking: worth asking about, but a proposal can still be drafted.
const SOFT_OPTIONAL = [
  'contact_email',
  'contact_phone',
  'nights',
  'room_type_preference',
  'requested_discount_pct',
  'stated_budget_per_night',
  'special_requests',
]

function buildInquiries(rows) {
  return rows.map((row) => {
    const roomsRaw = str(row.rooms_requested)
    const roomsExact = num(row.rooms_requested)
    const roomsApprox = roomsExact === null && roomsRaw ? num((roomsRaw.match(/\d+/) ?? [])[0]) : null

    const record = {
      inquiry_id: row.inquiry_id,
      source: 'portal',
      company_name: str(row.company_name),
      contact_name: str(row.contact_name),
      contact_email: str(row.contact_email),
      contact_phone: str(row.contact_phone),
      // Unlike guests/reservations, the raw contact details survive here: a proposal has to
      // be deliverable. They never leave the server unmasked -- listInquiries() in
      // netlify/functions/_lib/data.ts strips them and hands back the *_masked pair, and only
      // getInquiryDeliveryTarget() resolves the real address, for the send path alone.
      contact_email_masked: maskEmail(row.contact_email),
      contact_phone_masked: maskPhone(row.contact_phone),
      event_type: str(row.event_type),
      preferred_property_code: str(row.preferred_property_code),
      alternate_property_ok: bool(row.alternate_property_ok),
      arrival_date: str(row.arrival_date),
      departure_date: str(row.departure_date),
      rooms_requested: roomsExact,
      room_type_preference: str(row.room_type_preference),
      requested_discount_pct: num(row.requested_discount_pct),
      meeting_capacity_needed: num(row.meeting_capacity_needed),
      special_requests: str(row.special_requests),
      missing_fields: [],
      // ---- beyond the GroupInquiry interface, see data/generated/README.md
      date_received: str(row.date_received),
      nights: num(row.nights),
      stated_budget_per_night: num(row.stated_budget_per_night),
      meeting_space_needed: bool(row.meeting_space_needed),
      rooms_requested_raw: roomsRaw,
      rooms_requested_approx: roomsApprox,
      incomplete_fields: [],
      is_actionable: true,
      // The challenge author's commentary on each row. NEVER goes to the agent.
      dataset_notes: str(row.notes),
    }

    const missing = []
    for (const field of HARD_REQUIRED) {
      if (record[field] === null || record[field] === undefined || record[field] === '') missing.push(field)
    }
    if (!record.contact_email && !record.contact_phone) missing.push('contact_channel')
    if (record.meeting_space_needed && record.meeting_capacity_needed === null) {
      missing.push('meeting_capacity_needed')
    }

    const incomplete = SOFT_OPTIONAL.filter(
      (field) => record[field] === null || record[field] === undefined || record[field] === '',
    )
    if (roomsApprox !== null) incomplete.push('rooms_requested_is_approximate')

    record.missing_fields = missing
    record.incomplete_fields = incomplete
    record.is_actionable = missing.length === 0
    return record
  })
}

// -------------------------------------------------------------------------- data quality

function buildDataQuality(properties, rules) {
  const quarantined = []
  for (const p of properties) {
    for (const flag of p.data_quality_flags) {
      const m = flag.match(/^base_rate_(standard|deluxe|suite)_(negative|zero|missing)$/)
      if (!m) continue
      const field = `base_rate_${m[1]}`
      quarantined.push({
        entity: 'property',
        ref: `property:${p.property_code}`,
        field,
        raw_value: p[field],
        flag,
        severity: 'blocker',
        detected_by: 'scripts/data/build.mjs -> buildProperties()',
        effect: `${m[1]} pricing at ${p.property_code} is UNAVAILABLE. getPropertyRate() refuses it; any tool that needs it must return grounded:false and escalate rather than price off the value.`,
        remediation: `Confirm the correct ${field} for ${p.property_name} with GM ${p.general_manager} and fix the source export. Do not patch it in code.`,
      })
    }
  }

  const unresolved = rules
    .filter((r) => r.kind === 'routing' && r.referral && !r.referral.resolved)
    .map((r) => ({
      entity: 'property',
      ref: `property:${r.property_code}`,
      field: 'notes',
      rule_id: r.rule_id,
      target_description: r.referral.target_description,
      severity: 'blocker',
      effect: r.referral.resolution_note,
      remediation:
        'Group Sales must confirm whether the sister property exists and, if so, add it to the property directory before the agent can quote anything for it.',
    }))

  return {
    checks_run: [
      'base_rate_* negative / zero / unparsable',
      'inventory column sum vs total_rooms',
      'blackout_dates parsability',
      'max_discount_auto_approve_pct within 0-100',
      'property referenced in notes resolves to a real property in the directory',
    ],
    quarantined_values: quarantined,
    unresolved_references: unresolved,
    properties_with_flags: properties
      .filter((p) => p.data_quality_flags.length > 0)
      .map((p) => ({ property_code: p.property_code, data_quality_flags: p.data_quality_flags })),
  }
}

// --------------------------------------------------------------------------------- main

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

// Files confirmed identical to what the sources regenerate. Counted so --check can say what it
// verified: it used to print a header and then nothing on success, which reads exactly like a run
// that did nothing. The README tells a reviewer to run this, and "exit 0 and no output" is not a
// result anyone can act on.
const checked = []

function writeJson(name, payload) {
  const file = resolve(generatedDir, name)
  const text = `${JSON.stringify(payload, null, 2)}\n`
  if (CHECK_ONLY) {
    const current = existsSync(file) ? readFileSync(file, 'utf8') : ''
    if (current !== text) {
      console.error(`STALE: ${name} differs from the source data. Run: node scripts/data/build.mjs`)
      process.exitCode = 1
    } else {
      checked.push(name)
    }
    return
  }
  writeFileSync(file, text, 'utf8')
  console.log(`  wrote data/generated/${name} (${text.length.toLocaleString()} bytes)`)
}

function main() {
  mkdirSync(generatedDir, { recursive: true })

  const propertyRows = parseCsvObjects(readFileSync(SOURCE_FILES.properties, 'utf8'))
  const guestRows = parseCsvObjects(readFileSync(SOURCE_FILES.guests, 'utf8'))
  const inquiryRows = parseCsvObjects(readFileSync(SOURCE_FILES.inquiries, 'utf8'))
  const policyMarkdown = readFileSync(SOURCE_FILES.policies, 'utf8')

  const properties = buildProperties(propertyRows)
  const { rules, coverage } = buildRules(properties)

  // A note that points at a property we do not have is a data-quality problem, not just a rule.
  for (const rule of rules) {
    if (rule.kind === 'routing' && rule.referral && !rule.referral.resolved) {
      const p = properties.find((x) => x.property_code === rule.property_code)
      if (p && !p.data_quality_flags.includes('notes_reference_unresolved_property')) {
        p.data_quality_flags.push('notes_reference_unresolved_property')
      }
    }
  }

  const { guests, reservations } = buildGuestsAndReservations(guestRows)
  const { sections, document } = buildPolicies(policyMarkdown)
  const inquiries = buildInquiries(inquiryRows)
  const dataQuality = buildDataQuality(properties, rules)

  const cleanProperties = properties.map(({ __raw, ...rest }) => rest)

  console.log(CHECK_ONLY ? 'Checking data/generated ...' : 'Building data/generated ...')

  writeJson('properties.json', cleanProperties)
  writeJson('guests.json', guests)
  writeJson('reservations.json', reservations)
  writeJson('policies.json', sections)
  writeJson('policy-document.json', document)
  writeJson('inquiries.json', inquiries)
  writeJson('data-quality.json', dataQuality)
  writeJson('rules.json', {
    schema_version: 1,
    generator: 'scripts/data/build.mjs -> lib/rules.mjs',
    resolution: {
      discount_ceiling: 'most_restrictive_wins',
      note: 'When several discount_ceiling rules match the same stay, the LOWEST constraint.value is the effective ceiling. Report the winning rule_id in RuleVerdict.rule_id so the rep can see which rule bit.',
    },
    predicate_semantics: {
      absent_key: 'A predicate key that is absent does not constrain the rule; the rule applies.',
      match: '"any_night" means the predicate fires if ANY night of the stay falls inside the window.',
      months: 'Calendar months, 1-12.',
      weekdays: 'Three-letter names. WEEKDAYS.indexOf(name) equals JS Date#getDay().',
      min_rooms: 'Inclusive. min_rooms:26 means "26 or more", i.e. the CSV phrase "over 25".',
      text_match: 'Case-insensitive substring match of any_of[] against any of fields[].',
    },
    evaluation_context_fields: [
      'rooms_requested (number)',
      'requested_discount_pct (number)',
      'arrival_date, departure_date (ISO dates)',
      'stay_dates ({start,end}) derived from arrival/departure',
      'lead_time_days (arrival_date - date_received, in days)',
      'meeting_capacity_needed (number)',
      'room_type_preference (canonical room type, see roomTypes.ts)',
      'documents_on_file (string[])',
      'event_type, special_requests, company_name (strings, for text_match)',
    ],
    counts: {
      total: rules.length,
      by_kind: rules.reduce((acc, r) => ({ ...acc, [r.kind]: (acc[r.kind] ?? 0) + 1 }), {}),
      parsed_from_notes: rules.filter((r) => r.provenance.extraction === 'parsed_from_notes').length,
    },
    rules,
    notes_coverage: coverage,
  })
  writeJson('manifest.json', {
    schema_version: 1,
    sources: Object.fromEntries(
      Object.entries(SOURCE_FILES).map(([key, path]) => [
        key,
        { file: `data/${path.split(/[\\/]/).pop()}`, sha256: sha256(path) },
      ]),
    ),
    counts: {
      properties: cleanProperties.length,
      guests: guests.length,
      reservations: reservations.length,
      policies: sections.length,
      inquiries: inquiries.length,
      rules: rules.length,
    },
  })

  if (CHECK_ONLY && process.exitCode !== 1) {
    console.log(`OK - ${checked.length} generated files match their sources: ${checked.join(', ')}`)
  }

  if (!CHECK_ONLY) {
    console.log('')
    console.log(`  properties ${cleanProperties.length}   guests ${guests.length}   reservations ${reservations.length}`)
    console.log(`  policies   ${sections.length}   inquiries ${inquiries.length}   rules ${rules.length}`)
    const flagged = cleanProperties.filter((p) => p.data_quality_flags.length > 0)
    for (const p of flagged) {
      console.log(`  ! ${p.property_code}: ${p.data_quality_flags.join(', ')}`)
    }
    const blocked = inquiries.filter((i) => !i.is_actionable)
    for (const i of blocked) {
      console.log(`  ? ${i.inquiry_id}: missing ${i.missing_fields.join(', ')}`)
    }
  }
}

main()
