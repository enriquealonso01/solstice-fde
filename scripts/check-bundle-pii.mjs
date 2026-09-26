#!/usr/bin/env node
// Fails the build when the public bundle carries a real email, phone number or card digits from
// the provided data. The needles are read from data/*.csv, so a new row is covered without an edit.
//
//   node scripts/check-bundle-pii.mjs          # scan dist/ (runs as `postbuild`)
//   node scripts/check-bundle-pii.mjs <dir>    # scan another directory

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCsvObjects } from './data/lib/csv.mjs'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

export const BUNDLE_EXTENSIONS = ['.js', '.html', '.css', '.map']

// A card's last four only counts as PII next to card wording or its field name: "ending in 4417",
// "card ... 4417", "•••• 4417", payment_last4:"4417". The same four digits elsewhere (an id, a price,
// a masked phone's "***-***-") are not a card.
const CARD_CONTEXT = /(ending(\s+in)?|last[\s_]*(4|four)(\s+digits)?|card\b[^\n]{0,24}?|(?<![•*xX])[•*xX]{4})[\s:#='"`-]*$/i

/** Every email, phone and card last-four in data/*.csv. */
export function loadNeedles(dataDir = join(repoRoot, 'data')) {
  const emails = new Set()
  const phones = new Set()
  const cardLast4 = new Set()
  for (const file of readdirSync(dataDir).filter((f) => f.endsWith('.csv'))) {
    for (const row of parseCsvObjects(readFileSync(join(dataDir, file), 'utf8'))) {
      for (const [column, raw] of Object.entries(row)) {
        const value = String(raw ?? '').trim()
        if (!value) continue
        if (/email/i.test(column)) emails.add(value.toLowerCase())
        else if (/phone/i.test(column)) phones.add(value.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''))
        else if (/last4/i.test(column)) cardLast4.add(value)
      }
    }
  }
  return { emails: [...emails], phones: [...phones].filter((d) => d.length >= 7), cardLast4: [...cardLast4] }
}

/** A phone as written or digits only: 312-555-0148, (312) 555-0148, +1 312 555 0148, 3125550148. */
function phonePattern(digits) {
  const parts = digits.length === 10 ? [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6)] : [digits]
  return new RegExp(`(?<!\\d)(\\+?1[^\\d\\n]{0,2})?${parts.join('[^\\d\\n]{0,3}')}(?!\\d)`, 'g')
}

/** Offenders are printed masked, so the build log does not become the leak. */
function mask(kind, value) {
  if (kind === 'email') return `${value[0]}***${value.slice(value.indexOf('@'))}`
  if (kind === 'phone') return `***-***-${value.slice(-4)}`
  return 'ending ****'
}

/** The PII found in one piece of text, masked for printing. */
export function findPii(text, needles) {
  const found = []
  const lower = text.toLowerCase()
  for (const email of needles.emails) if (lower.includes(email)) found.push({ kind: 'email', value: mask('email', email) })
  for (const digits of needles.phones) if (phonePattern(digits).test(text)) found.push({ kind: 'phone', value: mask('phone', digits) })
  for (const last4 of needles.cardLast4) {
    for (const m of text.matchAll(new RegExp(`(?<!\\d)${last4}(?!\\d)`, 'g'))) {
      if (CARD_CONTEXT.test(text.slice(Math.max(0, m.index - 30), m.index))) {
        found.push({ kind: 'card', value: mask('card', last4) })
        break
      }
    }
  }
  return found
}

/** Every offending file under `dir`, recursively. `skip` excludes paths (e.g. tests). */
export function scanDirectory(dir, { needles = loadNeedles(), extensions = BUNDLE_EXTENSIONS, skip = () => false } = {}) {
  const offenders = []
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (skip(path)) continue
      if (entry.isDirectory()) walk(path)
      else if (extensions.includes(extname(entry.name))) {
        for (const hit of findPii(readFileSync(path, 'utf8'), needles)) offenders.push({ file: path, ...hit })
      }
    }
  }
  walk(dir)
  return offenders
}

function main() {
  const dir = resolve(process.argv[2] ?? join(repoRoot, 'dist'))
  if (!existsSync(dir)) {
    console.error(`check-bundle-pii: ${dir} does not exist. Run the build first.`)
    process.exit(1)
  }
  const needles = loadNeedles()
  const offenders = scanDirectory(dir, { needles })
  if (offenders.length > 0) {
    console.error(`check-bundle-pii: FAILED. ${offenders.length} piece(s) of guest or contact PII in ${relative(repoRoot, dir)}:`)
    for (const o of offenders) console.error(`  ${relative(repoRoot, o.file)}  ${o.kind} ${o.value}`)
    process.exit(1)
  }
  const total = needles.emails.length + needles.phones.length + needles.cardLast4.length
  console.log(`check-bundle-pii: ${relative(repoRoot, dir) || '.'} is clean (${total} values from data/*.csv checked).`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
