// Customer-facing templates must not double the punctuation of data dropped into them.
//
// The regression this guards, found on the proposal PDF for INQ-2007 — the document demo beat 4b
// puts on screen:
//
//   "Prepared for Kevin Marsh at Ocean State University Alumni Assoc.. Reference INQ-2007."
//
// The template ended the sentence with a full stop; the company name is an abbreviation that
// already ends in one. Nine of the ten seeded companies do not, which is why it survived.
//
// It is the same class as the doubled article fixed in PR #33: a template and its data colliding
// at the seam, invisible in the source, visible only once real data flows through.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { endSentence } from '../../../../shared/text'

describe('endSentence', () => {
  it('does not double a full stop after an abbreviation — the production case', () => {
    expect(endSentence('Prepared for Kevin Marsh at Ocean State University Alumni Assoc.')).toBe(
      'Prepared for Kevin Marsh at Ocean State University Alumni Assoc.',
    )
  })

  it('adds the full stop when the data does not end in one', () => {
    expect(endSentence('Prepared for Bethany Cruz at Harlow & Vance Consulting')).toBe(
      'Prepared for Bethany Cruz at Harlow & Vance Consulting.',
    )
  })

  it('leaves other sentence terminators alone rather than appending to them', () => {
    expect(endSentence('Ask for Dana at Cypress Ridge Reunion!')).toBe('Ask for Dana at Cypress Ridge Reunion!')
    expect(endSentence('Who should we ask for at Vantage Labs?')).toBe('Who should we ask for at Vantage Labs?')
  })

  it('does not leave a space before the punctuation', () => {
    // The other way this seam fails: a trailing space in the data giving "Acme ."
    expect(endSentence('Thank you for getting in touch about Acme ')).toBe('Thank you for getting in touch about Acme.')
  })

  it('handles empty input without emitting a lone full stop', () => {
    expect(endSentence('')).toBe('')
    expect(endSentence('   ')).toBe('')
  })

  it('takes a different terminator when asked', () => {
    expect(endSentence('Shall we hold the rooms', '?')).toBe('Shall we hold the rooms?')
  })
})

describe('the customer-facing templates use it', () => {
  // A source check, because the rendered defect only appears for a company name ending in "."
  // and there is exactly one such name in the dataset. This keeps the other four sites honest.
  const files = [
    'netlify/functions/group/proposal.ts',
    'netlify/functions/group/followUps.ts',
    'netlify/functions/group/tools.ts',
  ]

  for (const f of files) {
    it(`${f} interpolates a name before a full stop only via endSentence`, () => {
      const src = readFileSync(join(process.cwd(), f), 'utf8')
      // e.g. `${doc.company_name}.` — a name dropped straight in front of a hard-coded stop.
      const raw = src.match(/\$\{[^}]*(company_name|contact_name)\}\./g) ?? []
      expect(raw, `unguarded interpolation: ${raw.join(' , ')}`).toEqual([])
      expect(src).toContain('endSentence')
    })
  }
})
