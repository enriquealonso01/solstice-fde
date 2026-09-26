/**
 * The fallback that lets three guards run for someone who did not clone the repository.
 *
 * `README.md` invites a reviewer to run `npx vitest run` — for the live test count, and because
 * `repo-floors.test.ts` exists so they can check the README's own numbers rather than take them. Until
 * iteration 137 that invitation broke for anyone who used GitHub's **Download ZIP** instead of
 * `git clone`. Measured in a copy of the 262 tracked files with `.git` removed:
 *
 *   FAIL  no-committed-credentials.test.ts   fatal: not a git repository
 *   FAIL  repo-floors.test.ts                fatal: not a git repository
 *   FAIL  suite-integrity.test.ts            fatal: not a git repository
 *   Test Files  3 failed (3)        Tests  no tests
 *
 * They did not fail an assertion. They failed to **collect**, so the credential scan's twelve assertions
 * did not run at all and reported a git error in place of a result — the worst shape a guard can take,
 * and the one this suite has been finding in itself all night.
 *
 * `shippedFiles` prefers git, because in a clone it is the exact answer and it leaves untracked scratch
 * files out. Where git cannot answer it walks the tree with `.gitignore` applied, which for a ZIP is the
 * same set by construction: the archive contains what was tracked.
 *
 * The fallback can only be proven faithful somewhere both paths work, which is here. That is what the
 * subset case below is for.
 */
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isGitClone, shippedFiles, walkedFiles } from './shippedFiles'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')

describe('the file set three guards depend on', () => {
  const resolved = shippedFiles(repoRoot)

  it('answers with something substantial however it got there', () => {
    expect(
      resolved.files.length,
      'shippedFiles returned almost nothing, so every guard built on it is now vacuous',
    ).toBeGreaterThan(250)
  })

  it('every file it names is actually on disk', () => {
    const missing = resolved.files.filter((f) => !existsSync(join(repoRoot, f)))
    expect(missing.slice(0, 10), `shippedFiles named files that do not exist: ${missing.length}`).toEqual([])
  })

  // Clone-only, and the reason is the whole point of this file. Asserting "we are in a clone" would
  // fail for exactly the reviewer this fallback exists for -- which is what the first draft did when it
  // was run against a tree with no .git, one failure left over from three.
  const clone = isGitClone(repoRoot)

  it.skipIf(!clone)('prefers git when it can, rather than quietly walking instead', () => {
    expect(
      resolved.fromGit,
      'shippedFiles fell back to the walk inside a clone. Git is the exact answer here, and silently ' +
        'preferring the walk would hide a broken git call behind a plausible file list.',
    ).toBe(true)
  })

  it.skipIf(!clone)('the walk finds everything git tracks, so the fallback loses no coverage', () => {
    // The only direction that matters. The walk may legitimately return more than git -- an agent's new
    // test file before it is committed, a scratch dump -- but it must never return less, or a guard
    // running from a ZIP would scan a smaller set than the same guard running here.
    const walked = new Set(walkedFiles(repoRoot))
    const gitOnly = resolved.files.filter((f) => !walked.has(f))
    expect(
      gitOnly.slice(0, 20),
      `the walk misses ${gitOnly.length} tracked file(s). Anyone reviewing a ZIP would have them ` +
        `skipped by the credential scan and left out of the README's counts.`,
    ).toEqual([])
  })

  it('leaves out what must never be scanned or counted', () => {
    const walked = walkedFiles(repoRoot)
    for (const unwanted of ['node_modules/', 'dist/', '.git/', '.netlify/']) {
      expect(
        walked.filter((f) => f.startsWith(unwanted)).slice(0, 3),
        `the walk descended into ${unwanted}. That inflates every count and makes the credential scan ` +
          `read dependencies it does not ship.`,
      ).toEqual([])
    }
    for (const secret of ['.env', 'DEMO_LOGINS.md', 'FDE_Project_Challenge.pdf']) {
      expect(
        walked.includes(secret),
        `the walk includes ${secret}, which is gitignored on purpose. A ZIP does not contain it, so ` +
          `counting it here would make the two paths disagree about what ships.`,
      ).toBe(false)
    }
  })

  it.skipIf(!clone)('agrees with git on the numbers the README publishes', () => {
    // Not just the file set: the derived counts a reviewer sees have to come out the same either way.
    const walked = walkedFiles(repoRoot)
    const ts = (xs: string[]) => xs.filter((f) => /\.tsx?$/.test(f)).length
    const tests = (xs: string[]) => xs.filter((f) => /\.test\.tsx?$/.test(f)).length

    expect(
      ts(walked),
      'the walk and git disagree on the TypeScript file count, which README.md states as a floor',
    ).toBeGreaterThanOrEqual(ts(resolved.files))
    expect(
      tests(walked),
      'the walk and git disagree on the test file count, which README.md states as a floor',
    ).toBeGreaterThanOrEqual(tests(resolved.files))
  })
})
