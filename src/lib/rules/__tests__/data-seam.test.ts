/**
 * One file reads the provided data, and the integration recommendation is built on that.
 *
 * `docs/integration-recommendation.md` argues that replacing the CSV exports with OPERA's
 * Hospitality Integration Platform is *"a change to that file's implementation, not a rewrite"* —
 * because `netlify/functions/_lib/data.ts` holds every import of `data/generated/*.json` and nothing
 * that serves a request touches them directly.
 *
 * That is the load-bearing claim of a named brief deliverable, and it is an invariant about the code
 * rather than a description of it: the day a second file imports one of those JSON files, the
 * recommendation becomes a paragraph about a seam that no longer exists, and nothing would have said
 * so. Auditing the document found the claim true but overstated in the absolute — one CLI script
 * reads the JSON deliberately — so the document now names that exception and this pins the rest.
 *
 * Scope, stated so it is not read as more: this proves the request path has one door. It does not
 * prove the adapter behind that door is good, and it deliberately allows scripts and tests, which do
 * not serve requests.
 */
import { readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { readdirSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(__dirname, '../../../..')

/** The seam itself. */
const SEAM = 'netlify/functions/_lib/data.ts'

/**
 * Allowed to read the JSON directly, each for a stated reason.
 *
 * `scripts/show-verdict.ts` is the rehearsal aid `docs/live-modification.md` runs on stage; it must
 * work with no network and no model, so it loads the snapshot itself. It is not on the request path.
 */
const ALLOWED = [SEAM, 'scripts/show-verdict.ts']

/** Every TypeScript file that could serve a request or be bundled into one. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(repoRoot, dir))) {
    if (name === 'node_modules' || name === 'dist' || name === '.netlify') continue
    const rel = `${dir}/${name}`
    if (statSync(join(repoRoot, rel)).isDirectory()) sourceFiles(rel, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel)
  }
  return out
}

describe('the provided data has one door', () => {
  const files = [...sourceFiles('netlify'), ...sourceFiles('src'), ...sourceFiles('scripts')]

  it('finds files to check, so a moved directory cannot make this vacuous', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it('is imported only by the seam and the named exceptions', () => {
    const offenders: string[] = []

    for (const file of files) {
      if (file.includes('__tests__') || file.includes('.test.')) continue
      if (ALLOWED.includes(file)) continue

      const text = readFileSync(join(repoRoot, file), 'utf8')
      // An import or a read of the generated JSON — not a mention of the path in a comment.
      const imports = /(?:from\s+['"][^'"]*data\/generated\/[^'"]+['"])|(?:readFileSync\([^)]*data\/generated)/.test(text)
      if (imports) offenders.push(relative('.', file))
    }

    expect(
      offenders,
      `docs/integration-recommendation.md claims every read of the provided data on the request path ` +
        `goes through ${SEAM}. These read data/generated directly:\n\n${offenders.join('\n')}\n\n` +
        `Either route them through the seam, or add them to ALLOWED with a reason and say so in the ` +
        `document — the recommendation is built on this being true.`,
    ).toEqual([])
  })

  it('still holds the seven imports the document counts', () => {
    const seam = readFileSync(join(repoRoot, SEAM), 'utf8')
    const count = [...seam.matchAll(/from\s+['"][^'"]*data\/generated\/[^'"]+['"]/g)].length
    expect(count, `${SEAM} imports ${count} generated files; the document says seven`).toBe(7)
  })
})
