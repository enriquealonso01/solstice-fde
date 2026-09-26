/**
 * The failure-injection beat SUBMISSION.md invites a reviewer to run, which nothing covered.
 *
 * The email a reviewer receives says:
 *
 *   > On the admin Backend page there is a failure-injection panel. Take the property management
 *   > system offline and ask the chat for a late checkout: it stops confirming what it can no
 *   > longer verify, while policy questions keep working.
 *
 * That is two promises about live behaviour, and before this file **no test mentioned `pms_offline` or
 * failure injection at all**. It is also the one invitation a reviewer can act on without any data of
 * their own: two clicks and a sentence.
 *
 * Both halves are decided by one table. `runTool` reads `DEPENDENCY_OF[name]`, asks `isOffline`, and on
 * an injected outage returns `toolFail(OUTAGE_REASON[dependency] + guidance)` **instead of calling the
 * handler**. So a tool degrades exactly when it is in that table under the flag being flipped, and keeps
 * working exactly when it is not. The promise is therefore checkable from the wiring, without a database
 * and without flipping anything:
 *
 *   - "stops confirming what it can no longer verify" -> check_late_checkout is mapped to pms_offline
 *   - "while policy questions keep working"           -> get_policy is NOT mapped to pms_offline
 *
 * **Not by mocking.** This suite has no `vi.mock` in any of its sixty-four files: it is hermetic because
 * `vitest.setup.ts` strips every credential, so `tryGetDb()` returns null and `readFlags()` reports
 * nothing injected. Introducing module mocking for one file, an hour before submission, would be a new
 * failure surface for every other file in the run. The mapping is the thing that can silently rot; the
 * `runTool` seam it feeds is fifteen lines and reviewed.
 *
 * The beat itself was rehearsed on production at T5 (PR #15). The Tester could not verify it -- their
 * permission layer refuses flag writes -- which is part of why it reached submission day with no guard.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OUTAGE_REASON, type FlagKey } from '../../../../netlify/functions/_lib/flags'

const repoRoot = resolve(__dirname, '../../../..')
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8').replace(/\r\n/g, '\n')

const REGISTRY = 'netlify/functions/tools/registry.ts'

/** `DEPENDENCY_OF`: which flag takes each tool out of service. */
function dependencyOf(): Record<string, string> {
  const src = read(REGISTRY)
  const block = /const DEPENDENCY_OF: Record<string, FlagKey> = \{([\s\S]*?)\n\}/.exec(src)
  expect(block, `${REGISTRY} no longer declares DEPENDENCY_OF; re-point this file rather than deleting it`).toBeTruthy()
  const out: Record<string, string> = {}
  for (const m of (block as RegExpExecArray)[1].matchAll(/^\s*([a-z_]+):\s*'([a-z_]+)'/gm)) out[m[1]] = m[2]
  return out
}

/**
 * Tool name -> the identifier that implements it.
 *
 * Read from `CONCIERGE_HANDLERS`, which is the object literal the registry builds its map from, plus the
 * one name set explicitly afterwards. The first draft of this parser looked for an inline
 * `new Map(Object.entries({...}))` that does not exist here, parsed nothing, and the vacuity assertion
 * below said so -- which is why that assertion is the first case in the file.
 */
function handlerOf(): Record<string, string> {
  const src = read(REGISTRY)
  const block = /const CONCIERGE_HANDLERS: Record<ConciergeTool, ToolHandler> = \{([\s\S]*?)\n\}/.exec(src)
  expect(block, `${REGISTRY} no longer declares CONCIERGE_HANDLERS in a shape this can read`).toBeTruthy()
  const out: Record<string, string> = {}
  for (const m of (block as RegExpExecArray)[1].matchAll(/^\s*([a-z_]+):\s*([A-Za-z_]\w*)\s*,/gm)) out[m[1]] = m[2]
  for (const m of src.matchAll(/handlers\.set\('([a-z_]+)',\s*([A-Za-z_]\w*)\)/g)) out[m[1]] = m[2]
  return out
}

/** Which module each imported handler identifier comes from. */
function moduleOfIdentifier(): Record<string, string> {
  const src = read(REGISTRY)
  const out: Record<string, string> = {}
  for (const m of src.matchAll(/^import \{([^}]+)\} from '\.\/([\w.-]+)'/gm)) {
    for (const raw of m[1].split(',')) {
      const name = raw.replace(/\btype\b/, '').trim()
      if (name) out[name] = `netlify/functions/tools/${m[2]}.ts`
    }
  }
  return out
}

/** Does that module reach the simulated inventory service? */
const REACHES_INVENTORY = /sameDayAvailability|houseOccupancy|availabilityByClass/

describe('the failure-injection wiring behind the beat SUBMISSION.md invites', () => {
  it('reads the tables it means to check, so nothing below is vacuous', () => {
    const deps = dependencyOf()
    const handlers = handlerOf()
    expect(Object.keys(deps).length, 'DEPENDENCY_OF parsed empty').toBeGreaterThanOrEqual(6)
    expect(Object.keys(handlers).length, 'the handlers map parsed empty').toBeGreaterThanOrEqual(8)
  })

  it('maps only tools that are actually mounted', () => {
    // A typo here does not fail anything: the name simply never matches, so the tool keeps answering
    // during an injected outage and the panel watches the agent confirm what it cannot see.
    const handlers = handlerOf()
    const unknown = Object.keys(dependencyOf()).filter((name) => !(name in handlers))
    expect(
      unknown,
      `DEPENDENCY_OF names ${unknown.join(', ')}, which no handler is registered under. A tool that is not ` +
        `mounted under that exact name is never taken offline, and nothing else would notice.`,
    ).toEqual([])
  })

  it('takes every tool that reaches live inventory offline with the PMS', () => {
    // The inverse direction, which is the one that matters. A new tool that asks the inventory service
    // for a number and is not in the table would keep confirming room availability while the panel
    // watches the PMS switch sit in the "offline" position.
    const deps = dependencyOf()
    const handlers = handlerOf()
    const modules = moduleOfIdentifier()

    const inventoryTools: string[] = []
    for (const [tool, ident] of Object.entries(handlers)) {
      const mod = modules[ident]
      if (!mod) continue
      if (REACHES_INVENTORY.test(read(mod))) inventoryTools.push(tool)
    }

    expect(
      inventoryTools.length,
      'no tool was found reaching the inventory service, so this case proved nothing. Three did at ' +
        'iteration 156: check_late_checkout, check_upgrade_eligibility, book_amenity.',
    ).toBeGreaterThanOrEqual(3)

    const unguarded = inventoryTools.filter((t) => deps[t] !== 'pms_offline')
    expect(
      unguarded,
      `${unguarded.join(', ')} reach the simulated inventory service and are not mapped to pms_offline. ` +
        `With the PMS switched off they would still answer, which is the opposite of what the submission ` +
        `email promises a reviewer will see.`,
    ).toEqual([])
  })

  it('takes late checkout offline with the PMS, because the email names that exact action', () => {
    expect(
      dependencyOf().check_late_checkout,
      'SUBMISSION.md tells a reviewer to take the PMS offline and ask for a late checkout. If that tool is ' +
        'not mapped to pms_offline, the reviewer does exactly what the email says and sees nothing change.',
    ).toBe('pms_offline')
  })

  it('leaves policy questions working when the PMS is offline, which is the second half of the promise', () => {
    const deps = dependencyOf()
    const policyTools = Object.keys(deps).filter((t) => deps[t] === 'policy_source_offline')
    expect(policyTools, 'no tool is mapped to policy_source_offline; the flag has nothing to switch').not.toEqual([])
    expect(
      deps.get_policy,
      'get_policy is mapped to pms_offline, so taking the property management system offline would also ' +
        'stop policy answers. The email promises the opposite: policy questions keep working, which is the ' +
        'whole point of injecting one dependency rather than a global kill switch.',
    ).not.toBe('pms_offline')
    expect(deps.get_policy).toBe('policy_source_offline')
  })

  it('gives every flag a reason the agent can say out loud, and none of them promises a value', () => {
    const src = read('netlify/functions/flags.ts')
    const valid = [...(/const VALID: FlagKey\[\] = \[([^\]]+)\]/.exec(src)?.[1] ?? '').matchAll(/'([^']+)'/g)].map(
      (m) => m[1],
    )
    expect(valid.length, 'could not read the VALID flag list out of flags.ts').toBeGreaterThanOrEqual(3)

    // The admin API accepting a key the tool layer never reads is the silent version of this beat
    // failing: the switch flips, the panel sees it flip, and no tool changes behaviour.
    expect(
      valid.filter((k) => !(k in OUTAGE_REASON)),
      'the admin flags endpoint accepts a key that has no OUTAGE_REASON, so flipping it changes nothing',
    ).toEqual([])
    expect(
      Object.keys(OUTAGE_REASON).filter((k) => !valid.includes(k)),
      'a dependency has an outage reason but the admin endpoint will not accept its key, so it cannot be ' +
        'switched on from the panel a reviewer is pointed at',
    ).toEqual([])

    for (const [flag, reason] of Object.entries(OUTAGE_REASON) as [FlagKey, string][]) {
      expect(reason.length, `${flag} has no readable reason`).toBeGreaterThan(40)
      expect(reason, `${flag}'s reason does not say something is unreachable`).toMatch(/unreachable|cannot be|offline/i)
      // An outage message that still quotes a figure is worse than no message: it is a guess wearing a
      // disclaimer. Any digit here would be one.
      expect(reason, `${flag}'s reason contains a figure: ${reason}`).not.toMatch(/\d/)
    }
  })

  it('refuses through the same shape a real outage produces', () => {
    // The seam returns toolFail(...), so ok:false and grounded:false, and it never calls the handler.
    // If it ever returned toolOk with a note, everything downstream -- the trace, the grounded badge,
    // the agent's own instructions -- would treat an outage as an answer.
    const src = read(REGISTRY)
    const seam = /const dependency = DEPENDENCY_OF\[name\][\s\S]*?\n  \}/.exec(src)
    expect(seam, 'the failure-injection seam in runTool has moved; re-point this case').toBeTruthy()
    const text = (seam as RegExpExecArray)[0]
    expect(text, 'the outage branch no longer returns toolFail, so an outage could read as an answer').toContain('toolFail(')
    expect(text, 'the outage branch no longer quotes OUTAGE_REASON').toContain('OUTAGE_REASON[dependency]')
    expect(text, 'the outage branch stopped telling the agent not to guess').toMatch(/do not guess/i)
  })
})
