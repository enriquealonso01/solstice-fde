/**
 * No real email, phone or card digits from data/*.csv may reach the public bundle. The same scanner
 * runs as `postbuild` over dist/; here it runs over the sources that feed the bundle.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const repoRoot = resolve(__dirname, '../../../..')

interface Needles {
  emails: string[]
  phones: string[]
  cardLast4: string[]
}
interface Offender {
  file: string
  kind: 'email' | 'phone' | 'card'
  value: string
}
interface Scanner {
  loadNeedles(): Needles
  findPii(text: string, needles: Needles): Array<Omit<Offender, 'file'>>
  scanDirectory(dir: string, options: { needles: Needles; extensions?: string[]; skip?: (path: string) => boolean }): Offender[]
}

// Loaded by URL: the scanner is plain JS that the build runs with node, outside the TypeScript project.
let scanner: Scanner
let needles: Needles
beforeAll(async () => {
  scanner = (await import(pathToFileURL(resolve(repoRoot, 'scripts/check-bundle-pii.mjs')).href)) as Scanner
  needles = scanner.loadNeedles()
})

/** Tests quote the data on purpose and never ship. */
const notATest = (path: string) => /[\\/]__tests__[\\/]|\.test\.tsx?$/.test(path)
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.css', '.html', '.json']

describe('the scanner itself', () => {
  it('reads every email, phone and card last-four from the provided data', () => {
    expect(needles.emails.length).toBeGreaterThanOrEqual(30)
    expect(needles.phones.length).toBeGreaterThanOrEqual(30)
    expect(needles.cardLast4.length).toBeGreaterThanOrEqual(20)
  })

  it('catches a CSV email, and prints it masked', () => {
    const email = needles.emails[0]
    const hits = scanner.findPii(`const contact = { email: '${email.toUpperCase()}' }`, needles)
    expect(hits).toHaveLength(1)
    expect(hits[0].kind).toBe('email')
    expect(hits[0].value).not.toBe(email)
  })

  it('catches a CSV phone as written, digits only, or in E.164', () => {
    const digits = needles.phones[0]
    const dashed = `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
    for (const written of [dashed, digits, `+1${digits}`, `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`]) {
      expect(scanner.findPii(`call ${written} today`, needles).map((h) => h.kind), written).toEqual(['phone'])
    }
  })

  it('catches card digits only in card wording, not a masked phone that ends the same way', () => {
    const last4 = needles.cardLast4[0]
    expect(scanner.findPii(`card on file ending ${last4}.`, needles).map((h) => h.kind)).toEqual(['card'])
    expect(scanner.findPii(`Visa •••• ${last4}`, needles).map((h) => h.kind)).toEqual(['card'])
    for (const field of [`{payment_last4:"${last4}"}`, `"payment_method_last4": "${last4}"`, `last4='${last4}'`, `payment_last4:${last4}`]) {
      expect(scanner.findPii(field, needles).map((h) => h.kind), field).toEqual(['card'])
    }
    expect(scanner.findPii(`phone_masked: '***-***-${last4}', guest: 'GST-${last4}'`, needles)).toEqual([])
  })
})

describe('what feeds the public bundle', () => {
  it.each(['src', 'shared'])('%s/ carries no CSV email, phone or card digits', (dir) => {
    const offenders = scanner.scanDirectory(resolve(repoRoot, dir), {
      needles,
      extensions: SOURCE_EXTENSIONS,
      skip: notATest,
    })
    expect(offenders.map((o) => `${o.file}: ${o.kind} ${o.value}`)).toEqual([])
  })

  const dist = resolve(repoRoot, 'dist')
  it.skipIf(!existsSync(dist))('the last build in dist/ is clean', () => {
    expect(scanner.scanDirectory(dist, { needles }).map((o) => `${o.file}: ${o.kind} ${o.value}`)).toEqual([])
  })
})
