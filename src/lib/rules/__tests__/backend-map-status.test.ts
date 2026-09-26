/**
 * The status badge on every node of the in-app Backend map, against what actually runs.
 *
 * `backendMapModel.ts` opens with *"Editing a node here changes what Enrique narrates"*, and beat 7 of
 * the runbook puts this page on screen in front of the technical panel. At iteration 134 it carried
 * **16 `pending` and 6 `blocked`** nodes and only two of them were true. `Claude` was `blocked`. So
 * were `API key`, `Phone number + Call Control` and `AI Assistant "Sol"`. `BackendNode.tsx` renders
 * those as a rose badge reading **blocked**, so the panel would have been shown a system whose model,
 * whose credentials, whose phone number and whose voice agent are all marked broken — while Enrique
 * narrated the opposite over the top of it.
 *
 * It is the same defect as iteration 133's on `docs/architecture.drawio`, and it was findable from it:
 * `docs/README-diagram.md` says the two diagram files and this page are *"built from the same
 * component model"*, so once one was a day stale on status the other was the obvious next place.
 *
 * Everything was verified against the live systems before any badge moved -- Anthropic answering on
 * `claude-sonnet-5`, the DID active, the assistant at 29,784 characters and 25 tools, the WebRTC
 * credential unexpired, the sending domain verified, six voice sessions in Postgres with their
 * transcripts, four proposals sent by email.
 *
 * What is pinned here is the invariant that broke, not the audit: **`pending` means "written and
 * waiting on an account", and nothing is waiting on an account any more.** One thing is genuinely
 * blocked and it is 10DLC. If that stops being true, this file should fail before a reviewer notices.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MAP_TABS } from '../../../components/admin/backendMapModel'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')

interface Badge {
  tab: string
  title: string
  status: string
}

const badges: Badge[] = MAP_TABS.flatMap((tab) =>
  tab.nodes.map((node) => ({
    tab: tab.id,
    title: String(node.data.title ?? node.id),
    status: String(node.data.status ?? 'live'),
  })),
)

const withStatus = (s: string) => badges.filter((b) => b.status === s)

/** The only two things that are genuinely blocked, and the reason is upstream of every vendor here. */
const BLOCKED_TITLES = ['SMS (10DLC)', '10DLC registration']

describe('the Backend map Enrique narrates', () => {
  it('has nodes to check, so nothing below passes by finding an empty model', () => {
    expect(MAP_TABS.length, 'MAP_TABS is empty').toBeGreaterThan(0)
    expect(badges.length, 'the map has no nodes').toBeGreaterThan(40)
  })

  it('marks nothing as pending, because nothing is waiting on an account', () => {
    const pending = withStatus('pending').map((b) => `${b.tab}/${b.title}`)
    expect(
      pending,
      `these nodes are still badged "pending": ${pending.join(', ')}. Pending means written and waiting ` +
        `on an account. The Telnyx account is funded and active, the Anthropic key answers, the sending ` +
        `domain is verified and the schema is applied -- so a pending badge on this page is a claim that ` +
        `the thing on screen does not work, shown to a panel while it is being demonstrated.`,
    ).toEqual([])
  })

  it('marks exactly the 10DLC pair as blocked, and nothing else', () => {
    const blocked = withStatus('blocked').map((b) => b.title)
    expect(
      blocked.slice().sort(),
      `blocked should be exactly ${BLOCKED_TITLES.join(' and ')}. Anything else is either newly broken ` +
        `or a stale badge; both are worth stopping for.`,
    ).toEqual(BLOCKED_TITLES.slice().sort())
  })

  it.each([
    'Claude',
    'API key',
    'Phone number + Call Control',
    'AI Assistant “Sol”',
    '/api/chat',
    'Email API',
  ])('%s is live, which is the specific thing that was wrong', (title) => {
    const found = badges.filter((b) => b.title === title)
    expect(found.length, `no node titled "${title}" any more; this case is checking nothing`).toBeGreaterThan(0)
    for (const b of found) {
      expect(b.status, `${b.tab}/${title} is badged ${b.status}`).toBe('live')
    }
  })

  it('states the supervisor ladder limit rather than badging it live in silence', () => {
    // The ladder really is live -- a session in Postgres is `taken_over` -- but the monitor hears the
    // guest and not Sol, and the README says so precisely. A live badge without the caveat overstates
    // the one thing in the package that is deliberately described as partly working.
    const leg = badges.find((b) => b.title === 'Supervisor leg')
    expect(leg, 'the Supervisor leg node is gone').toBeTruthy()
    expect((leg as Badge).status).toBe('live')

    const src = readFileSync(join(repoRoot, 'src/components/admin/backendMapModel.ts'), 'utf8')
    expect(
      src,
      'the Supervisor leg node is badged live without naming the limit: the supervisor hears the guest, ' +
        'not Sol. README.md states it; the map should not quietly claim more.',
    ).toContain('the supervisor hears the GUEST, not Sol')
  })
})

/**
 * `docs/README-diagram.md` claims the .drawio files and this page are built from the same component
 * model. That claim is what made this bug findable, and it is only useful if the two agree on status,
 * so it is checked rather than trusted.
 */
describe('the map and the .drawio agree on what runs', () => {
  const drawio = readFileSync(join(repoRoot, 'docs/architecture.drawio'), 'utf8')
  const todayPage = (() => {
    const start = drawio.indexOf('<diagram id="today"')
    const from = start >= 0 ? start : drawio.indexOf('Today (MVP)')
    const end = drawio.indexOf('</diagram>', from)
    return drawio.slice(from, end === -1 ? undefined : end)
  })()
  const count = (tag: string) =>
    todayPage.match(new RegExp(`letter-spacing:1px[^>]*&gt;${tag}&lt;`, 'g'))?.length ?? 0

  it('still claims to share one component model, or this pairing is meaningless', () => {
    const guide = readFileSync(join(repoRoot, 'docs/README-diagram.md'), 'utf8')
    expect(guide).toContain('same component model')
  })

  it('neither surface has anything pending', () => {
    expect(count('PENDING'), 'the .drawio Today page has PENDING nodes again').toBe(0)
    expect(withStatus('pending').length, 'the in-app map has pending nodes again').toBe(0)
  })

  it('both are blocked only on 10DLC', () => {
    // The .drawio collapses SMS and its registration into one node; the app map keeps them apart.
    expect(count('BLOCKED'), 'the .drawio Today page blocks something other than SMS').toBe(1)
    expect(withStatus('blocked').map((b) => b.title).sort()).toEqual(BLOCKED_TITLES.slice().sort())
  })
})
