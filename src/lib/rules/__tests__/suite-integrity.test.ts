/**
 * Every test that is supposed to run must actually be runnable — by anyone, not just here.
 *
 * At the Tester's iteration 55, `list-counts.test.ts` was in `HEAD` and in `origin/main` and **not on
 * disk**. Vitest cannot skip loudly what it cannot see, so the file simply did not run: the suite
 * reported 36 files where it should have reported 37, and the guard protecting the deliverable against
 * miscounts was itself not being executed. Three agents share one working tree, and a stray `reset`
 * is all it takes.
 *
 * That is the worst failure a guard can have. A missing guard is visible; a guard that quietly stops
 * running looks exactly like a guard that passes.
 *
 * It checks one direction: **tracked but not on disk**, which runs for nobody and shrinks the suite
 * without complaining. That is the case that occurred.
 *
 * The mirror — on disk but **not tracked**, so it passes here and does not exist for anyone who
 * clones the repo — is deliberately not checked here. Every new test file is untracked until it is
 * committed, so asserting it would go red for any agent mid-iteration, and a guard that cries wolf
 * gets ignored. The ship sequence already covers it: `agents/README.md` requires a clean tree before
 * deploying, and `git status --porcelain` counts untracked files.
 *
 * This cannot protect itself: if this file goes missing, nothing reports it. It covers the other
 * forty-odd, which is the case that actually occurred.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(__dirname, '../../../..')

function gitTestFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '*.test.ts', '*.test.tsx'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  return out.split('\n').map((l) => l.trim()).filter(Boolean)
}

describe('the test suite is the suite that ships', () => {
  const tracked = gitTestFiles()

  it('finds tracked test files, so a git failure cannot make this vacuous', () => {
    expect(tracked.length).toBeGreaterThan(30)
  })

  it('every tracked test file is present on disk, or it runs for nobody', () => {
    const absent = tracked.filter((f) => !existsSync(join(repoRoot, f)))
    expect(
      absent,
      `These test files are committed but missing from the working tree, so vitest never loads them ` +
        `and the suite silently shrinks:\n\n${absent.join('\n')}\n\n` +
        `This happened once already. Restore them with: git checkout -- <path>`,
    ).toEqual([])
  })
})
