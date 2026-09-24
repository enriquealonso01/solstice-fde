// Policy retrieval is what keeps the concierge grounded: every policy answer has to come back
// with a `policy:N` citation the UI can render and the panel can check.

import { describe, it, expect } from 'vitest'

import { getPolicySection, listPolicies, searchPolicies } from '../../../netlify/functions/_lib/data'

describe('the 15 sections', () => {
  it('are all present, numbered 1-15', () => {
    const sections = listPolicies()
    expect(sections).toHaveLength(15)
    expect(sections.map((s) => s.number)).toEqual([...Array(15)].map((_, i) => i + 1))
    for (const section of sections) {
      expect(section.section_id).toBe(`policy:${section.number}`)
      expect(section.title.length).toBeGreaterThan(3)
      expect(section.body.length).toBeGreaterThan(50)
    }
  })

  it('resolve by number, string, or citation ref', () => {
    expect(getPolicySection(5)!.title).toBe('Service Recovery Window')
    expect(getPolicySection('5')!.section_id).toBe('policy:5')
    expect(getPolicySection('policy:5')!.number).toBe(5)
    expect(getPolicySection(99)).toBeNull()
  })

  it('keep acronyms intact when title-casing', () => {
    expect(getPolicySection(14)!.title).toBe('ID Verification and Incidental Hold')
  })
})

describe('searchPolicies finds the section a guest is actually asking about', () => {
  const cases: [string, number][] = [
    ['can I cancel my reservation for free?', 2],
    ['I booked advance purchase and my flight was cancelled', 3],
    ['I never showed up, am I still charged?', 4],
    ['the room was noisy, I want a refund', 5],
    ['I am Platinum, do I get a late checkout?', 6],
    ['can I bring my dog?', 8],
    ['is smoking allowed on the balcony?', 10],
    ['I left my laptop in the room', 11],
    ['how much is parking?', 12],
    ['can you discount a block of 30 rooms?', 13],
  ]

  for (const [question, expected] of cases) {
    it(`"${question}" -> policy:${expected}`, () => {
      const hits = searchPolicies(question)
      expect(hits.length).toBeGreaterThan(0)
      expect(hits.map((h) => h.section.number)).toContain(expected)
    })
  }

  it('returns a citation and a snippet with every hit', () => {
    const [top] = searchPolicies('cancellation policy')
    expect(top.citation.source).toBe('policy')
    expect(top.citation.ref).toBe(`policy:${top.section.number}`)
    expect(top.citation.label).toContain(top.section.title)
    expect(top.snippet.length).toBeGreaterThan(10)
    expect(top.section.body).toContain(top.snippet.slice(0, 30))
  })

  it('returns nothing rather than a bad guess when nothing matches', () => {
    expect(searchPolicies('what is the wifi password for the rooftop helipad')).toEqual([])
    expect(searchPolicies('')).toEqual([])
  })

  it('respects the limit', () => {
    expect(searchPolicies('check-in', 1)).toHaveLength(1)
  })
})
