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
import { propertiesFromCsv } from './lib/properties.mjs'
import { generatedDir, SOURCE_FILES } from './lib/paths.mjs'
import { maskEmail, maskPhone, last4 } from '../../netlify/functions/_lib/mask.ts'
import { phoneLookupKey, emailLookupKey } from '../../netlify/functions/_lib/lookup.ts'

const CHECK_ONLY = process.argv.includes('--check')

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
      // ---- beyond the GroupInquiry interface
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

function buildDataQuality(properties) {
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
        detected_by: 'scripts/data/lib/properties.mjs',
        effect: `${m[1]} pricing at ${p.property_code} is UNAVAILABLE. getPropertyRate() refuses it; any tool that needs it must return grounded:false and escalate rather than price off the value.`,
        remediation: `Confirm the correct ${field} for ${p.property_name} with GM ${p.general_manager} and fix the source export. Do not patch it in code.`,
      })
    }
  }

  return {
    checks_run: [
      'base_rate_* negative / zero / unparsable',
      'inventory column sum vs total_rooms',
      'blackout_dates parsability',
      'max_discount_auto_approve_pct within 0-100',
    ],
    quarantined_values: quarantined,
    properties_with_flags: properties
      .filter((p) => p.data_quality_flags.length > 0)
      .map((p) => ({ property_code: p.property_code, data_quality_flags: p.data_quality_flags })),
  }
}

// --------------------------------------------------------------------------------- main

/**
 * Provenance hash of a source file, insensitive to the checkout's line endings.
 *
 * All four inputs are text -- three CSVs and the policy markdown -- and none of them is pinned in
 * .gitattributes, so git hands a Windows clone CRLF and a Linux clone LF. Hashing the raw bytes made
 * the manifest a fact about the machine that built it: `npm run data:check` passed here and reported
 * STALE: manifest.json differs from the source data in a fresh LF clone of the public repository.
 *
 * That command is the provenance proof two deliverables tell a reviewer to run -- the answer to "how
 * do you know it is not inventing rates" is `data:check` plus a current deploy. Failing it on their
 * machine is worse than not offering it.
 *
 * So the hash is of the content with CRLF folded to LF. It is still a real fingerprint of what they
 * sent: change a rate by a digit and it moves. It just stops moving for a reason that has nothing to
 * do with the data. Found at iteration 112, the same class as the compile hash in iteration 96.
 */
function sha256(path) {
  const normalised = readFileSync(path, 'utf8').split('\r\n').join('\n')
  return createHash('sha256').update(normalised, 'utf8').digest('hex')
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
    // Compared with carriage returns folded out, for the same reason the source hash is.
    //
    // The comparison is byte-for-byte against `JSON.stringify(...) + newline`, which is always LF.
    // git hands these files to a Windows checkout as CRLF, so --check reported STALE for every
    // generated file it had touched -- a fact about the checkout, not the data. Iteration 112 fixed
    // the hash half of this and missed the comparison half: the very next `git checkout` rewrote
    // manifest.json as CRLF and the check went red again, in the tree that had just passed.
    const fold = (t) => t.split('\r\n').join('\n')
    const current = existsSync(file) ? fold(readFileSync(file, 'utf8')) : ''
    if (current !== fold(text)) {
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

  const properties = propertiesFromCsv(readFileSync(SOURCE_FILES.properties, 'utf8'))
  const guestRows = parseCsvObjects(readFileSync(SOURCE_FILES.guests, 'utf8'))
  const inquiryRows = parseCsvObjects(readFileSync(SOURCE_FILES.inquiries, 'utf8'))
  const policyMarkdown = readFileSync(SOURCE_FILES.policies, 'utf8')

  const { guests, reservations } = buildGuestsAndReservations(guestRows)
  const { sections, document } = buildPolicies(policyMarkdown)
  const inquiries = buildInquiries(inquiryRows)
  const dataQuality = buildDataQuality(properties)

  console.log(CHECK_ONLY ? 'Checking data/generated ...' : 'Building data/generated ...')

  writeJson('properties.json', properties)
  writeJson('guests.json', guests)
  writeJson('reservations.json', reservations)
  writeJson('policies.json', sections)
  writeJson('policy-document.json', document)
  writeJson('inquiries.json', inquiries)
  writeJson('data-quality.json', dataQuality)
  writeJson('manifest.json', {
    schema_version: 1,
    sources: Object.fromEntries(
      Object.entries(SOURCE_FILES).map(([key, path]) => [
        key,
        { file: `data/${path.split(/[\\/]/).pop()}`, sha256: sha256(path) },
      ]),
    ),
    counts: {
      properties: properties.length,
      guests: guests.length,
      reservations: reservations.length,
      policies: sections.length,
      inquiries: inquiries.length,
    },
  })

  if (CHECK_ONLY && process.exitCode !== 1) {
    console.log(`OK - ${checked.length} generated files match their sources: ${checked.join(', ')}`)
  }

  if (!CHECK_ONLY) {
    console.log('')
    console.log(`  properties ${properties.length}   guests ${guests.length}   reservations ${reservations.length}`)
    console.log(`  policies   ${sections.length}   inquiries ${inquiries.length}`)
    const flagged = properties.filter((p) => p.data_quality_flags.length > 0)
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
