/**
 * No test may invoke git without a path for the reviewer who has no `.git`.
 *
 * `README.md` invites a reviewer to run `npx vitest run`. Iteration 137 made three guards survive a
 * Download ZIP by building `shippedFiles()` -- git where git can answer, a `.gitignore`-filtered walk
 * where it cannot -- and `agents/README.md` has said since iteration 138: *do not shell out to git from a
 * test without a fallback*.
 *
 * Iteration 152 measured it anyway, in a tree extracted with `git archive` and no `.git`, and found
 * `defect-disclosure-list.test.ts` calling `git ls-files` bare. **It did not fail an assertion; it failed
 * to collect**, reporting `fatal: not a git repository` where a result belonged. One file, written seven
 * iterations after the rule, in the suite whose whole premise is that its guards can be trusted.
 *
 * Re-measured at iteration 165, after twelve new or rewritten test files: the extracted tree passes, 961
 * passed and 5 deliberate skips. **It passed because somebody remembered to look.** Twelve iterations went
 * by between the two measurements, and the second one was a choice rather than a consequence.
 *
 * So this is the mechanical form of the rule. The class cannot come back silently, and the claim in the
 * README stops depending on an agent deciding to re-measure it.
 *
 * Two files legitimately call git and both are listed with the reason. The check is deliberately about the
 * **call**, not about the outcome: a guarded call and an unguarded one look identical in a clone, which is
 * exactly why a passing suite here says nothing about a ZIP.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(__dirname, '../../../..')
const SELF = 'src/lib/rules/__tests__/git-usage.test.ts'

/** Any shape that reaches the git binary. */
const INVOKES_GIT =
  /(?:execFileSync|execSync|spawnSync|spawn|exec)\s*\(\s*['"`]git(?:['"`]|\s)|['"`]git['"`]\s*,\s*\[/

/**
 * The two files that may call git, each because of what it is for.
 *
 * `shippedFiles.ts` IS the fallback: it tries git and walks the tree when git is not there.
 * `suite-integrity.test.ts` enumerates test files to prove none is tracked-but-missing, which only git
 * can answer -- so it asks `isGitClone()` first and returns an empty list otherwise, and its two cases
 * carry `skipIf`. Asserting "we are in a clone" would fail for exactly the reviewer the fallback exists
 * for, which is what its first draft did.
 */
const ALLOWED: Record<string, string> = {
  'src/lib/rules/__tests__/shippedFiles.ts': 'is the fallback: prefers git, walks the tree when git cannot answer',
  'src/lib/rules/__tests__/suite-integrity.test.ts': 'guards its call with isGitClone() and skips its cases outside a clone',
}

function sources(): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry)) out.push(relative(repoRoot, full).split('\\').join('/'))
    }
  }
  walk(resolve(repoRoot, 'src'))
  // This file quotes the calls it bans, in its own positive control, as code rather than prose -- so it
  // matches its own pattern. Excluded, and the exclusion is backed by a fact rather than a promise: the
  // case below asserts it imports nothing from child_process, so it cannot reach git whatever it quotes.
  return out.filter((f) => f !== SELF)
}

/** Comments describe the problem; only code can cause it. */
const codeOf = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ').replace(/^\s*\*.*$/gm, ' ')

describe('tests that reach for git', () => {
  it('reads enough of the tree for the sweep to mean anything', () => {
    const files = sources()
    expect(files.length, 'almost no sources were walked, so the sweep below proves nothing').toBeGreaterThan(80)
    expect(
      files.filter((f) => /\.test\.tsx?$/.test(f)).length,
      'no test files were walked',
    ).toBeGreaterThan(40)
  })

  it('finds the two that are allowed to, so the allow-list is not describing files that left', () => {
    const invoking = sources().filter((f) => INVOKES_GIT.test(codeOf(readFileSync(join(repoRoot, f), 'utf8'))))
    for (const allowed of Object.keys(ALLOWED)) {
      expect(
        invoking,
        `${allowed} is on the allow-list and no longer calls git. Remove the entry rather than leaving an ` +
          `exemption nobody needs -- an allow-list nobody checks is how the next unguarded call gets waved ` +
          `through.`,
      ).toContain(allowed)
    }
  })

  it('has no other file calling git, because a ZIP has no .git to call it in', () => {
    const rogue = sources()
      .filter((f) => INVOKES_GIT.test(codeOf(readFileSync(join(repoRoot, f), 'utf8'))))
      .filter((f) => !(f in ALLOWED))

    expect(
      rogue,
      `${rogue.join(', ')} invoke git directly. In a tree with no .git that throws while the file is being ` +
        `collected, so the whole file reports "fatal: not a git repository" instead of a result -- and ` +
        `README.md invites a reviewer to run this suite. Use shippedFiles() from ./shippedFiles, which ` +
        `prefers git and walks the tree when git cannot answer, or guard the call with isGitClone() and ` +
        `skip the cases that need it.`,
    ).toEqual([])
  })

  it('would spot an unguarded call, so a clean sweep is not a broken pattern', () => {
    // A positive control. Every form this suite has actually used, plus the two it has not, because the
    // pattern is the whole check and one that matches nothing looks exactly like a disciplined suite.
    for (const snippet of [
      "execFileSync('git', ['ls-files', '-z'])",
      'execSync(`git rev-parse HEAD`)',
      "spawnSync('git', ['status'])",
      "const out = execFileSync('git', args)",
    ]) {
      expect(INVOKES_GIT.test(snippet), `the pattern does not match ${snippet}`).toBe(true)
    }
    // ...and must not fire on prose or on unrelated calls.
    for (const snippet of [
      "execFileSync('node', ['script.mjs'])",
      'const gitless = true',
      "readFileSync(join(repoRoot, '.gitignore'), 'utf8')",
    ]) {
      expect(INVOKES_GIT.test(snippet), `the pattern wrongly matches ${snippet}`).toBe(false)
    }
  })

  it('cannot itself reach git, which is what earns its own exclusion', () => {
    // The self-exclusion above is only safe if this file has no way to run a process. It quotes the
    // banned forms as strings in its positive control, and a string is not a call.
    //
    // Checked over the IMPORT LINES, not the whole file. The first version searched the file for the
    // module name and failed on itself: the name appears in this very assertion. Two self-references in
    // one file, both found by running it -- the pattern matching its own positive control, then the
    // import check matching its own subject.
    const own = readFileSync(join(repoRoot, SELF), 'utf8')
    const imports = own.split('\n').filter((l) => /^\s*(?:import|const .* = require)\b/.test(l))
    expect(imports.length, 'no import lines found, so this check read nothing').toBeGreaterThan(2)
    expect(
      imports.join('\n'),
      'git-usage.test.ts now imports a process runner, so it can no longer exempt itself from its own sweep',
    ).not.toContain('child_process')
    expect(own, 'the self-exclusion is no longer in place, so this file will flag itself').toContain('!== SELF')
  })

  it('keeps the fallback exporting what the allowed files depend on', () => {
    // If shippedFiles stopped offering a walk, every guard built on it would quietly become clone-only
    // again and this file would still pass.
    const src = readFileSync(join(repoRoot, 'src/lib/rules/__tests__/shippedFiles.ts'), 'utf8')
    for (const exported of ['export function shippedFiles', 'export function walkedFiles', 'export function isGitClone']) {
      expect(src, `shippedFiles.ts no longer has "${exported}"`).toContain(exported)
    }
    expect(src, 'shippedFiles.ts no longer falls back to a walk when git cannot answer').toMatch(/fromGit: false/)
  })
})
