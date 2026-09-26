// data/solstice-properties.csv -> the Property records written to properties.json.
// The group rule table (src/lib/rules/thresholds.ts) is derived from this output, so this is
// the only path a per-property number takes into the app.

import { parseCsvObjects, num } from './csv.mjs'
import { INVENTORY_COLUMNS } from '../../../netlify/functions/_lib/roomTypes.ts'

/** @param {string} csvText the properties CSV */
export function propertiesFromCsv(csvText) {
  return parseCsvObjects(csvText).map(buildProperty)
}

/** @param {Record<string, string>} row */
function buildProperty(row) {
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
  }
}

/** '2026-07-02 to 2026-07-06; 2026-12-28 to 2027-01-02' -> [{start,end},{start,end}].
 *  'none scheduled' -> []. Returns `unparsed` for anything we could not read, so the caller
 *  can raise a data-quality flag instead of silently dropping a blackout.
 *  @param {string|null} raw */
function parseDateRanges(raw) {
  const text = (raw ?? '').trim()
  if (text === '' || /^none(\s+scheduled)?$/i.test(text)) return { ranges: [], unparsed: [] }
  const ranges = []
  const unparsed = []
  for (const chunk of text.split(/[;]/)) {
    const part = chunk.trim()
    if (part === '') continue
    const m = part.match(/^(\d{4}-\d{2}-\d{2})\s*(?:to|through|-|–)\s*(\d{4}-\d{2}-\d{2})$/i)
    if (m) {
      ranges.push({ start: m[1], end: m[2] })
      continue
    }
    const single = part.match(/^(\d{4}-\d{2}-\d{2})$/)
    if (single) {
      ranges.push({ start: single[1], end: single[1] })
      continue
    }
    unparsed.push(part)
  }
  return { ranges, unparsed }
}
