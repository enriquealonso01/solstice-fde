// Prints what the rules engine says about one inquiry, with no network and no model.
//
// This is the rehearsal aid for the live modification: run it, change a threshold, run it again,
// and the difference is visible in seconds in front of an audience.
//
//   node scripts/show-verdict.ts INQ-2009
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluateGroupRules, priceBlock } from '../src/lib/rules/index.ts'
import type { GroupInquiry, Property } from '../shared/types.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (f: string) => JSON.parse(readFileSync(resolve(root, 'data/generated', f), 'utf8'))

const code = process.argv[2] ?? 'INQ-2009'
const inquiries: GroupInquiry[] = read('inquiries.json')
const properties: Property[] = read('properties.json')

const inquiry = inquiries.find((i) => i.inquiry_id === code)
if (!inquiry) {
  console.error(`No inquiry ${code}. Known: ${inquiries.map((i) => i.inquiry_id).join(', ')}`)
  process.exit(1)
}
const property = properties.find((p) => p.property_code === inquiry.preferred_property_code)
if (!property) {
  console.error(`No property ${inquiry.preferred_property_code}`)
  process.exit(1)
}

const result = evaluateGroupRules({ inquiry, property })

console.log(`\n${code} — ${inquiry.company_name} at ${property.property_name}`)
console.log(`asked for ${inquiry.rooms_requested} rooms at ${inquiry.requested_discount_pct}% off\n`)

for (const v of result.verdicts) {
  if (v.status === 'pass') continue
  console.log(`  ${v.status.toUpperCase().padEnd(5)} ${v.rule_id}`)
  console.log(`        asked ${v.actual}, allowed ${v.threshold}`)
  console.log(`        "${v.human_reason}"`)
}
if (result.verdicts.every((v) => v.status === 'pass')) console.log('  every rule passes')

const priced = priceBlock({
  property,
  rooms: inquiry.rooms_requested ?? 0,
  arrival_date: inquiry.arrival_date ?? undefined,
  departure_date: inquiry.departure_date ?? undefined,
  room_type: inquiry.room_type_preference ?? undefined,
  discount_pct: result.allowed_discount_pct ?? inquiry.requested_discount_pct ?? 0,
})
console.log(
  `\n  at the discount the customer asked for (${priced.discount_pct}%): $${(priced.total_cents / 100).toFixed(2)}`,
)
console.log('  (what they may actually be offered depends on the verdicts above)')
console.log('')
