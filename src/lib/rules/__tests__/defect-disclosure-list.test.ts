/**
 * The list of places the open defect is disclosed must name every place it is disclosed.
 *
 * `HUMAN_INTERVENTION.md` tells Enrique that if he applies the `drop policy` SQL before submitting, the
 * disclosure lives in **three places, "so none is left behind"**: the `README.md` paragraph, the
 * `SUBMISSION.md` row, and a parenthesis in `docs/where-this-goes.md`.
 *
 * That is the same shape as the list which was wrong at iteration 139 — a superseding block that corrected
 * *"eight verdicts"* and turned out to have missed a ninth, because **a list reads as complete**. This one
 * is acted on in the last minutes before submission, and the failure is asymmetric: a disclosure left
 * behind after the hole is closed is worse than the disclosure was, because a reviewer who tests the hole,
 * finds it shut, and then reads that we still have it concludes the honesty was decoration.
 *
 * Swept at iteration 145 across every tracked file rather than only the Markdown — the narrower sweep is
 * the mistake this suite keeps finding. The list is complete today. `agent/sol.md`'s assumption 13 is the
 * one other affected passage and correctly not on it: it claims approvals are attributable, which the fix
 * makes true rather than false, so it needs no edit.
 *
 * Also confirmed while here, and written into that file because it is the question that could stop him
 * applying a security fix at 10:55: **both guards are hermetic**. `send-gate-bypass.test.ts` and
 * `rls-policies.test.ts` read `schema.sql` and migration 004 from disk and make zero network calls, so
 * running the SQL cannot turn the suite red. `schema.sql` already declares no client write policy; the
 * three policies exist only in the live database.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { shippedFiles } from './shippedFiles'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8').replace(/\r\n/g, '\n')

/** The three the instructions name. Kept as data so a change here is a deliberate edit. */
const LISTED = ['README.md', 'SUBMISSION.md', 'docs/where-this-goes.md']

/** Files that are allowed to discuss the defect without being a reader-facing disclosure. */
const NOT_A_DISCLOSURE = (p: string) =>
  p === 'HUMAN_INTERVENTION.md' || // the instruction file itself
  p.startsWith('agents/') || // the coordination record
  p.startsWith('plans/') || // planning, exempt everywhere else too
  p.startsWith('src/lib/rules/__tests__/') || // the guards that cover it
  p.startsWith('supabase/') // the schema and the migration that fixes it

/** How the disclosure reads, in any of the words the three passages use. */
const DISCLOSES =
  /004_client_read_only|defect is open|open defect|status column directly|set `?status`? to `?approved`?/i

/**
 * Every file that ships, through the shared helper rather than a `git ls-files` of its own.
 *
 * This called git directly until iteration 152, and **it was the one test in the suite that failed for a
 * reviewer who used GitHub's Download ZIP**: no `.git`, so the call threw and the case reported
 * `fatal: not a git repository` in place of a result. Measured by extracting the tracked files with
 * `git archive`, running `npm ci` and the suite in that tree: **1 failed, 892 passed, 5 skipped**.
 *
 * That is the failure iteration 137 already fixed for three other guards, and the one `agents/README.md`
 * has warned about since iteration 138 -- *do not shell out to git from a test without a fallback*. I then
 * wrote this file at iteration 145 and did it anyway.
 *
 * `shippedFiles()` prefers git where it can and walks the tree with `.gitignore` applied where it cannot;
 * `shipped-files.test.ts` proves the walk is a superset of what git tracks, in a clone where both answers
 * are available. Using it here removes the last place the suite required being a clone.
 */
const tracked = (): string[] => shippedFiles(repoRoot).files

describe('the list of places the open defect is disclosed', () => {
  /**
   * The list block only, not the whole file.
   *
   * The first version of this asserted `readFileSync(HUMAN_INTERVENTION.md).toContain(f)` for each of the
   * three. It passed a red-check that removed `docs/where-this-goes.md` **from the list** — because the
   * paragraph this same iteration appended to that file names all three filenames while explaining that the
   * list is complete. The prose about the guard satisfied the guard, which is iteration 138's failure
   * exactly, one iteration after I wrote that one up.
   */
  const listBlock = (): string => {
    const hi = read('HUMAN_INTERVENTION.md')
    const start = hi.indexOf('The three places that mention it')
    if (start === -1) return ''
    const after = hi.slice(start)
    const end = after.search(/\n(?:---|#{2,3} )/)
    return end === -1 ? after : after.slice(0, end)
  }

  it('is still stated in the file Enrique acts on', () => {
    expect(
      read('HUMAN_INTERVENTION.md'),
      'HUMAN_INTERVENTION.md no longer carries the "three places that mention it" list. If the defect was ' +
        'closed and the passages removed, delete this whole file; if the list moved, re-point it.',
    ).toContain('The three places that mention it')

    const block = listBlock()
    expect(block.length, 'the list block came back empty, so the names below are checked against nothing').toBeGreaterThan(80)
    for (const f of LISTED) {
      expect(
        block,
        `the "three places" list no longer names ${f}. Checked inside the list block on purpose: the rest ` +
          `of this file mentions all three filenames in prose, so a file-wide search passes while the list ` +
          `Enrique actually reads has lost an entry.`,
      ).toContain(f)
    }
  })

  it('names every file that actually discloses it', () => {
    const disclosing = tracked()
      .filter((p) => !NOT_A_DISCLOSURE(p))
      .filter((p) => {
        try {
          return DISCLOSES.test(read(p))
        } catch {
          return false // binary or unreadable: not a prose disclosure
        }
      })

    const unlisted = disclosing.filter((p) => !LISTED.includes(p))
    expect(
      unlisted,
      `these files disclose the open defect and the "three places" list does not name them: ` +
        `${unlisted.join(', ')}. Enrique deletes the listed passages minutes before submitting; an ` +
        `unlisted one survives, and the package then claims a defect it has just fixed. Add it to the list ` +
        `in HUMAN_INTERVENTION.md and to LISTED here.`,
    ).toEqual([])
  })

  it('finds the disclosures it claims to have found, so the sweep is not matching nothing', () => {
    const found = LISTED.filter((p) => DISCLOSES.test(read(p)))
    expect(
      found,
      `the list names ${LISTED.length} files and only ${found.length} still disclose the defect. Either the ` +
        `hole was closed and the passages went — in which case this file and the list should go too — or a ` +
        `passage was reworded past what the sweep recognises, which would make the case above vacuous.`,
    ).toEqual(LISTED)
  })

  it('keeps assumption 13 off the list, because the fix makes it true', () => {
    // agent/sol.md is the one other affected passage. It claims approvals are attributable; the defect
    // falsifies that and the migration restores it, so it is correct post-fix and needs no edit. Listing
    // it would have Enrique delete a sentence that had just become true.
    const sol = read('agent/sol.md')
    expect(sol, "agent/sol.md no longer carries the attributability claim this defect affects").toMatch(
      /an approval happened and\s+is attributable/,
    )
    expect(
      LISTED,
      'agent/sol.md is on the delete list. The fix makes its assumption 13 true rather than false, so it ' +
        'must not be edited when the SQL is applied.',
    ).not.toContain('agent/sol.md')
  })

  it('keeps the guards hermetic, which is why applying the SQL cannot turn the suite red', () => {
    // Stated to Enrique in HUMAN_INTERVENTION.md. If a guard ever reaches the live database, that promise
    // stops being true and he would be applying a security fix into a red suite.
    for (const guard of [
      'src/lib/rules/__tests__/send-gate-bypass.test.ts',
      'src/lib/rules/__tests__/rls-policies.test.ts',
    ]) {
      expect(
        read(guard),
        `${guard} now makes a network call. HUMAN_INTERVENTION.md promises Enrique that running the drop ` +
          `policy SQL cannot turn the suite red, which is only true while these read the schema from disk.`,
      ).not.toMatch(/\bfetch\(|createClient\(/)
    }
  })
})
