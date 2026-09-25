/**
 * The deliverables must not advertise a tool that cannot be called.
 *
 * `availability_service` was named as the brief's net-new tool in the README twice, in
 * SUBMISSION.md, in both architecture files and on the Backend map node. Nothing ever answered to
 * it: the capability is `sameDayAvailability()` in `netlify/functions/tools/availability.ts`,
 * reached through `check_late_checkout`, `check_upgrade_eligibility` and the group assistant's
 * `check_availability`. An interviewer finds that by reading the README and running one curl.
 *
 * It took two passes to clear because the first verification grep filtered whole lines through
 * `grep -v simulated_inventory_service`, and one occurrence sat on the same line as that
 * provenance string — so a real hit was hidden by the filter meant to remove a false one. This
 * test is the thing that would have caught it either way.
 *
 * Scope, stated honestly: this guards one specific invented name across the files a reviewer
 * reads. It is not a general proof that every documented tool exists.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(__dirname, '../../../..')

/** Files a reviewer actually reads, plus the map rendered inside the app. */
const SURFACES = [
  'README.md',
  'SUBMISSION.md',
  'agent/sol.md',
  'docs/architecture.drawio',
  'docs/architecture.svg',
  'src/components/admin/backendMapModel.ts',
]

/** The name that never existed. */
const PHANTOM = 'availability_service'

/**
 * `simulated_inventory_service` is a real provenance value and must survive the check. It does not
 * contain PHANTOM as a substring, but the original sweep filtered on it at line granularity and
 * lost a true positive that way, so the distinction is asserted rather than assumed.
 */
const LEGITIMATE = 'simulated_inventory_service'

describe('the deliverables never name a tool that does not exist', () => {
  for (const relative of SURFACES) {
    it(`${relative} does not mention ${PHANTOM}`, () => {
      const contents = readFileSync(resolve(repoRoot, relative), 'utf8')
      expect(contents).not.toContain(PHANTOM)
    })
  }

  it('does not achieve that by banning the legitimate provenance string too', () => {
    expect(LEGITIMATE).not.toContain(PHANTOM)

    const solMd = readFileSync(resolve(repoRoot, 'agent/sol.md'), 'utf8')
    expect(solMd).toContain(LEGITIMATE)
  })

  it('names the service that does exist, so the guard cannot pass by saying nothing', () => {
    const readme = readFileSync(resolve(repoRoot, 'README.md'), 'utf8')
    expect(readme).toContain('netlify/functions/tools/availability.ts')
    expect(readme).toContain('check_late_checkout')
  })
})
