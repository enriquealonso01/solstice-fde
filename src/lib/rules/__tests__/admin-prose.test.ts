/**
 * Nothing on an operator's screen should name the machinery it runs on.
 *
 * T29 listed three user-visible strings that leaked implementation vocabulary. I fixed two and
 * missed the third, then swept again and found eight, then found a ninth and a tenth while
 * verifying. Each miss has the same cause: every sweep was shaped by what I expected to find. The
 * first grepped a word list I predicted. The second read only `label=` / `hint=` / `body=`
 * attributes, so it could not see an inline JSX string. The third matched quoted strings only, so
 * it could not see bare JSX text like `Live read failed, showing demo fixtures.`
 *
 * A word list is still a prediction, so this test is not a proof that the prose is plain. What it
 * does is close the loop: a term already known to be jargon cannot come back into an admin screen
 * without turning this suite red, and it reads BOTH quoted strings and JSX text so the two shapes
 * that hid a string before are covered.
 *
 * The allowlist is deliberate. Some of these screens are read by a technical audience who should
 * see that the data really is live, and naming the product there is evidence rather than jargon.
 * Every entry below says why it stays.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(__dirname, '../../../..')
const SCREEN_DIRS = ['src/pages/admin', 'src/components/admin']

/**
 * Terms that describe how the thing is built rather than what the operator is looking at. Product
 * and protocol names, table and column names, and HTTP/endpoint vocabulary.
 */
const JARGON = [
  'supabase',
  'postgres',
  'rls',
  'sip',
  'webrtc',
  'telnyx',
  'endpoint',
  'fixtures',
  'payload',
  'webhook',
  'schema',
  'query',
  'null',
  'uuid',
  'json',
  'api',
  'sdk',
  'http',
  'post request',
  'login_token',
  'tool_invocations',
  'audit_log',
  'session_id',
  'inquiry_id',
]

/**
 * Sentences that keep a technical term on purpose. Matched on the trimmed text, so a reword forces
 * a fresh decision here rather than silently inheriting the exemption.
 */
const ALLOWED: { text: string; why: string }[] = [
  {
    text: 'Every call and chat Sol is handling right now, streaming from Supabase Realtime.',
    why: 'The supervisor screen is shown to engineers; naming the transport is the evidence that these tiles really are live rather than a polling loop.',
  },
  {
    text: 'Live from the Telnyx API, not an estimate.',
    why: 'The cost page reports a real vendor balance. Naming the vendor whose invoice it is makes the number checkable, which is the whole point of the page.',
  },
  {
    text: 'Anything marked as our estimate is the first thing to replace with a real invoice. The Telnyx balance above is exact; these per-unit rates only attribute that spend across calls, texts and email.',
    why: 'Same reason: this sentence exists to say which number is vendor truth and which is ours.',
  },
]

/**
 * Files whose subject IS the machinery. The architecture explainer is read by an engineer asking
 * how this is built; stripping the product names out of it would remove its content, not its
 * jargon.
 */
const EXEMPT_FILES = ['backendMapModel.ts']

/**
 * Reads the strings an operator can actually end up reading: quoted literals and JSX text.
 *
 * Both halves are deliberately blunt, and both were written wrong first. A single pattern that
 * tracked its own opening quote by backreference matched almost nothing under V8, so this scans
 * with a plain left-to-right alternation instead: because it is one regex, an apostrophe inside a
 * double-quoted string is consumed by the double-quote branch and cannot open a bogus match. And
 * the JSX pass has to remove `{...}` interpolations BEFORE looking for text, or a line like
 * `Live read failed. {message}` is invisible, which is precisely how that line survived.
 */
function visibleText(source: string): string[] {
  const out: string[] = []

  for (const m of source.matchAll(/"([^"\r\n]*)"|'([^'\r\n]*)'|`([^`$\r\n]*)`/g)) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '')
  }

  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\{[^{}]*\}/g, ' ')
    // Inline formatting tags split a sentence into fragments too short to look like prose:
    // `This is written to <code>audit_log</code> with your user id` was invisible for exactly
    // this reason. Remove the tag, keep the words either side as one run of text.
    .replace(/<\/?(code|strong|em|b|i|kbd|abbr|small)>/g, '')
  for (const m of stripped.matchAll(/>([^<>{}]+)</g)) {
    out.push(m[1])
  }

  return out
}

function sourceFiles(): string[] {
  const files: string[] = []
  for (const dir of SCREEN_DIRS) {
    for (const name of readdirSync(join(repoRoot, dir))) {
      if (/\.(tsx|ts)$/.test(name) && !name.endsWith('.test.ts')) files.push(join(dir, name))
    }
  }
  return files
}

describe('admin screens speak the operator’s language', () => {
  it('has screens to check, so a moved directory fails loudly instead of passing empty', () => {
    expect(sourceFiles().length).toBeGreaterThan(10)
  })

  it('never shows an implementation term to an operator', () => {
    const offences: string[] = []

    for (const file of sourceFiles()) {
      if (EXEMPT_FILES.some((name) => file.endsWith(name))) continue
      const source = readFileSync(join(repoRoot, file), 'utf8')
      for (const raw of visibleText(source)) {
        const text = raw.replace(/\s+/g, ' ').trim()

        // Prose, not an identifier, a class list or a key: four or more words with a space.
        if (text.split(' ').length < 4) continue
        // TypeScript generics make the JSX pass read `useState<string | null>(null) const x = useRef<` as
        // if it were prose. Anything that looks like code is not something an operator reads.
        if (/(^|[ (])(const|let|export|function|return|import|await|use[A-Z])[ (<]/.test(text)) continue
        if (text.includes('=>') || text.includes('===')) continue
        // Tailwind class strings are long and space-separated but are not prose.
        if (/^[a-z0-9:/\[\]\-. ]+$/.test(text) && /(\bbg-|\btext-|\bflex\b|\bgrid\b|\brounded)/.test(text)) continue
        if (ALLOWED.some((a) => a.text === text)) continue

        // Word-level rather than a regex, on purpose. The first version of this line built its
        // pattern in a template literal, where `\b` is the BACKSPACE character and not a word
        // boundary, so it compiled to something that could never match. Splitting into words is
        // both harder to get wrong and exactly the question being asked.
        const words = new Set(text.toLowerCase().match(/[a-z0-9_]+/g) ?? [])
        const lower = text.toLowerCase()
        const hit = JARGON.find((term) => (term.includes(' ') ? lower.includes(term) : words.has(term)))
        if (hit) offences.push(`${relative('.', file)}: "${text}" — contains "${hit}"`)
      }
    }

    expect(
      offences,
      `An operator screen names its own machinery. Say the same true thing in plain words, or add\n` +
        `it to ALLOWED with a reason if the term is the point:\n\n${offences.join('\n')}\n`,
    ).toEqual([])
  })
})
