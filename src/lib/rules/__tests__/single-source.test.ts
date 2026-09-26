// The properties CSV is the one hand-edited place for a property's numbers.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { GroupInquiry } from '../../../../shared/types'
import inquiries from '../../../../data/generated/inquiries.json'
import { propertiesFromCsv } from '../../../../scripts/data/lib/properties.mjs'
import { NOTE_RULES } from '../seasonal'
import { PROPERTY_RULES, ruleSetFor } from '../thresholds'

const csv = readFileSync(resolve(__dirname, '../../../../data/solstice-properties.csv'), 'utf8')
const PROPERTIES_JSON = '../../../../data/generated/properties.json'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The CSV with one cell changed. Only for rows without quoted cells, such as SOL-PHX. */
function withCell(text: string, code: string, column: string, value: string): string {
  const lines = text.split(/\r?\n/)
  const index = lines[0].split(',').indexOf(column)
  expect(index, column).toBeGreaterThan(-1)
  return lines
    .map((line) => {
      if (!line.startsWith(`${code},`)) return line
      const cells = line.split(',')
      cells[index] = value
      return cells.join(',')
    })
    .join('\n')
}

// INQ-2009 (Phoenix, 17% asked), moved to future dates so only the ceiling is in question.
const phoenixInquiry = {
  ...inquiries.find((i) => i.inquiry_id === 'INQ-2009'),
  arrival_date: '2027-10-12',
  departure_date: '2027-10-15',
} as unknown as GroupInquiry

describe('the rule table is derived from the properties CSV', () => {
  it('every entry equals what the data build derives from its CSV row', () => {
    const fromCsv = propertiesFromCsv(csv)
    expect(Object.keys(PROPERTY_RULES).sort()).toEqual(fromCsv.map((p) => p.property_code).sort())
    for (const property of fromCsv) {
      expect(PROPERTY_RULES[property.property_code], property.property_code).toEqual(ruleSetFor(property))
    }
  })

  it('editing one CSV cell moves the ceiling the engine enforces', async () => {
    const edited = propertiesFromCsv(withCell(csv, 'SOL-PHX', 'max_discount_auto_approve_pct', '12'))
    vi.resetModules()
    vi.doMock(PROPERTIES_JSON, () => ({ default: edited }))
    try {
      // No rules passed in: the engine looks them up itself, as it does in production.
      const { evaluateGroupRules } = await import('../engine')
      const ceiling = evaluateGroupRules({ inquiry: phoenixInquiry }).verdicts.find(
        (v) => v.rule_id === 'GRP-DISCOUNT-CEILING',
      )
      expect(ceiling).toMatchObject({ status: 'flag', actual: 17, threshold: 12 })
    } finally {
      vi.doUnmock(PROPERTIES_JSON)
      vi.resetModules()
    }
  })

  it('every hand-coded note rule quotes its CSV note verbatim, numbers included', () => {
    const notes = new Map(propertiesFromCsv(csv).map((p) => [p.property_code, p.notes]))
    const checks: [code: string, sourceNote: string, mustContain: string[]][] = []
    for (const [code, r] of Object.entries(NOTE_RULES)) {
      for (const s of r.seasonal_discount_rules ?? []) {
        const months = `${MONTHS[s.window.months[0] - 1]}-${MONTHS[s.window.months[s.window.months.length - 1] - 1]}`
        checks.push([code, s.source_note, [`${s.max_discount_pct}%`, months]])
      }
      for (const s of r.seasonal_rate_notes ?? []) checks.push([code, s.source_note, [`~${Math.abs(s.approx_change_pct)}%`]])
      for (const d of r.required_documents ?? []) checks.push([code, d.source_note, []])
      if (r.lead_time) {
        const { over_rooms, min_days, source_note } = r.lead_time
        checks.push([code, source_note, [`over ${over_rooms} rooms`, `${min_days / 7}+ weeks`]])
      }
      if (r.overflow_routing) {
        checks.push([code, r.overflow_routing.source_note, [`over ${r.overflow_routing.over_rooms} rooms`]])
      }
    }
    expect(checks).toHaveLength(6)
    for (const [code, sourceNote, mustContain] of checks) {
      expect(notes.get(code), code).toContain(sourceNote)
      for (const fragment of mustContain) expect(sourceNote, code).toContain(fragment)
    }
  })

  it('get_property_info tells the model the note rules the engine enforces', async () => {
    const seasonal = await import('../seasonal')
    const { getPropertyInfo } = await import('../../../../netlify/functions/tools/policy')
    const overflow = seasonal.PROVIDENCE_OVERFLOW
    const original = overflow.over_rooms
    try {
      // A value only seasonal.ts holds, so a hand-typed copy in the tool layer would disagree.
      overflow.over_rooms = original - 2
      for (const code of Object.keys(seasonal.NOTE_RULES)) {
        const result = await getPropertyInfo({ property_code: code }, { channel: 'chat' })
        const data = result.data as { structured_notes: unknown }
        expect(data.structured_notes, code).toEqual(seasonal.describeNoteRules(code))
      }
      expect(seasonal.describeNoteRules('SOL-PVD')[0].rule).toContain(`over ${original - 2} rooms`)
    } finally {
      overflow.over_rooms = original
    }
  })
})

describe('tool descriptions leave the numbers to the tools', () => {
  it('no concierge tool description states an amount, a duration, a percentage or a clock time', async () => {
    const { toolDefinitions } = await import('../../../../netlify/functions/tools/registry')
    const NUMBER = /\$\d|\d+[ -]?(hours?|days?|nights?|%|am\b|pm\b)|\b\d{1,2}:\d{2}\b/i
    for (const tool of toolDefinitions()) {
      const texts = [tool.description, ...Object.values(tool.input_schema.properties).map((p) => p.description)]
      for (const text of texts) expect(text, tool.name).not.toMatch(NUMBER)
    }
  })
})
