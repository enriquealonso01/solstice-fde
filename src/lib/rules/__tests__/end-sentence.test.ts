// Customer-facing templates must not double the punctuation of data dropped into them
// ("... Alumni Assoc.. Reference INQ-2007." on a proposal PDF).
import { describe, expect, it } from 'vitest'
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
