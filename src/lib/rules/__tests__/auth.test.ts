// Access control on the group function.
//
// The regression this guards: with no credentials at all, POST /api/group/tool and
// GET /api/group/inquiries both answered 200 in production, which meant anyone on the internet
// could read the inquiry pipeline and invoke group tools.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import handler from '../../../../netlify/functions/group/index'
import {
  authorizeStaff,
  authorizeToolCaller,
  secretsMatch,
  GROUP_ROLES,
} from '../../../../netlify/functions/group/auth'
import {
  accessTokenFor,
  getProposal,
  resetProposalStore,
  setClock,
} from '../../../../netlify/functions/group/store'
import { generate_proposal } from '../../../../netlify/functions/group/tools'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const repoRoot = resolve(__dirname, '../../../..')

const SECRET = 'test-webhook-secret-0123456789'
const ORIGINAL = { ...process.env }

// Before every arrival in the dataset, so the date rules do not rot with the calendar.
beforeAll(() => setClock(() => new Date('2026-07-15T12:00:00Z')))
afterAll(() => setClock(null))

// `Context` is a Netlify runtime object none of these routes touch.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CTX = {} as any

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://solstice.example${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

function get(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://solstice.example${path}`, { method: 'GET', headers })
}

beforeEach(() => {
  resetProposalStore()
  process.env.TOOL_WEBHOOK_SECRET = SECRET
  // No Supabase on this deploy: the staff routes must refuse, never fall open.
  delete process.env.SUPABASE_URL
  delete process.env.SUPABASE_ANON_KEY
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
})

afterEach(() => {
  process.env = { ...ORIGINAL }
})

describe('the shared secret on the assistant-facing tool route', () => {
  it('compares in constant time and rejects a wrong or short key', () => {
    expect(secretsMatch(SECRET, SECRET)).toBe(true)
    expect(secretsMatch('wrong', SECRET)).toBe(false)
    expect(secretsMatch(SECRET.slice(0, -1), SECRET)).toBe(false)
    expect(secretsMatch(`${SECRET}x`, SECRET)).toBe(false)
    expect(secretsMatch(null, SECRET)).toBe(false)
    expect(secretsMatch('', SECRET)).toBe(false)
  })

  it('accepts the header the Telnyx assistant actually sends', () => {
    expect(authorizeToolCaller(post('/api/group/tool', {}, { 'x-solstice-tool-key': SECRET })).ok).toBe(true)
  })

  it('accepts the bearer form too, because the concierge tool layer does', () => {
    expect(
      authorizeToolCaller(post('/api/group/tool', {}, { authorization: `Bearer ${SECRET}` })).ok,
    ).toBe(true)
  })

  it('refuses an unauthenticated call', async () => {
    const response = await handler(post('/api/group/tool', { tool: 'evaluate_group_rules' }), CTX)
    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.data).toBeUndefined()
  })

  it('lets the assistant through with the key, contract unchanged', async () => {
    const response = await handler(
      post(
        '/api/group/tool',
        { tool: 'evaluate_group_rules', args: { inquiry_id: 'INQ-2009' }, call_control_id: 'v3:abc' },
        { 'x-solstice-tool-key': SECRET },
      ),
      CTX,
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.decision).toBe('needs_approval')
  })

  it('still answers when the secret is unset, matching the concierge tool layer', () => {
    delete process.env.TOOL_WEBHOOK_SECRET
    expect(authorizeToolCaller(post('/api/group/tool', {})).ok).toBe(true)
  })
})

describe('the staff routes refuse an anonymous caller', () => {
  const routes: [string, () => Request][] = [
    ['GET /api/group/inquiries', () => get('/api/group/inquiries')],
    ['GET /api/group/proposals', () => get('/api/group/proposals')],
    ['GET /api/group/audit', () => get('/api/group/audit')],
    ['POST /api/group/assistant', () => post('/api/group/assistant', { inquiry_id: 'INQ-2009', message: 'hi' })],
    ['POST /api/group/proposal-action', () => post('/api/group/proposal-action', { proposal_id: 'PRP-0001', action: 'send' })],
    ['POST /api/group/approve', () => post('/api/group/approve', { proposal_id: 'PRP-0001', actor: 'x' })],
    ['POST /api/group/reject', () => post('/api/group/reject', { proposal_id: 'PRP-0001', actor: 'x' })],
    ['POST /api/group/send', () => post('/api/group/send', { proposal_id: 'PRP-0001' })],
  ]

  it.each(routes)('%s', async (_label, build) => {
    const response = await handler(build(), CTX)
    expect(response.status).not.toBe(200)
    expect([401, 403, 503]).toContain(response.status)
    const text = await response.text()
    // Nothing about a customer or an inquiry leaks in the refusal.
    expect(text).not.toMatch(/INQ-20\d\d.*company|Harlow|Ridgeline|Camelback/)
  })

  it('refuses without a bearer token before it ever reaches Supabase', async () => {
    const result = await authorizeStaff(get('/api/group/inquiries'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(401)
  })

  it('refuses rather than falling open when Supabase is not configured', async () => {
    const result = await authorizeStaff(get('/api/group/inquiries', { authorization: 'Bearer some-token' }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(503)
      expect(result.error).toContain('SUPABASE_URL')
    }
  })

  it('mirrors the row level security rule: group sales, the general manager and admin, never concierge', () => {
    expect(GROUP_ROLES).toEqual(['group_sales', 'gm', 'admin'])
    expect(GROUP_ROLES).not.toContain('concierge')
  })
})

describe('the health probe stays open and says nothing it should not', () => {
  it('reports configuration as booleans and no customer data', async () => {
    const response = await handler(get('/api/group'), CTX)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.secured['POST /api/group/tool']).toBe('x-solstice-tool-key')
    expect(JSON.stringify(body)).not.toContain(SECRET)
    expect(JSON.stringify(body)).not.toMatch(/INQ-20|Harlow|@/)
  })

  it('says out loud when the tool route is unsecured', async () => {
    delete process.env.TOOL_WEBHOOK_SECRET
    const body = await (await handler(get('/api/group'), CTX)).json()
    expect(body.secured['POST /api/group/tool']).toContain('OPEN')
  })
})

describe('the customer PDF link', () => {
  it('opens with the token that was put in their email or text', async () => {
    const generated = await generate_proposal({ inquiry_id: 'INQ-2001' })
    const proposal = (await getProposal(generated.data!.proposal_id))!
    const token = accessTokenFor(proposal.proposal_id)
    expect(token.length).toBeGreaterThan(20)

    const response = await handler(
      get(`/api/group/pdf/${proposal.proposal_id}.pdf?t=${token}`),
      CTX,
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/pdf')
  })

  it('is not enumerable: a bare proposal id gets the same answer as a missing one', async () => {
    const generated = await generate_proposal({ inquiry_id: 'INQ-2001' })
    const id = generated.data!.proposal_id

    const noToken = await handler(get(`/api/group/pdf/${id}.pdf`), CTX)
    const wrongToken = await handler(get(`/api/group/pdf/${id}.pdf?t=not-the-token`), CTX)
    const missing = await handler(get('/api/group/pdf/PRP-9999.pdf'), CTX)

    expect(noToken.status).toBe(404)
    expect(wrongToken.status).toBe(404)
    expect(missing.status).toBe(404)
    // Identical bodies, so the route cannot be used to discover which proposals exist.
    expect(await noToken.text()).toBe(await missing.text())
  })

  it('puts the token in the link, and nowhere the admin screen or the database can leak it', async () => {
    const generated = await generate_proposal({ inquiry_id: 'INQ-2001' })
    const proposal = (await getProposal(generated.data!.proposal_id))!
    const token = accessTokenFor(proposal.proposal_id)

    // The generated URL carries it...
    expect(proposal.pdf_url).toContain(token)
    // ...and nothing stored alongside the proposal does. The token is derived, never a column,
    // so reading the `proposals` table does not hand somebody every customer's link.
    expect(JSON.stringify(proposal.pricing)).not.toContain(token)
    expect(JSON.stringify(proposal.verdicts)).not.toContain(token)
  })

  it('derives the same token on any function instance', () => {
    // This is what makes a link minted by one request openable through another.
    expect(accessTokenFor('PRP-2001')).toBe(accessTokenFor('PRP-2001'))
    expect(accessTokenFor('PRP-2001')).not.toBe(accessTokenFor('PRP-2002'))
  })
})

/**
 * What README.md says about that link, against what the code does.
 *
 * The paragraph is the project's stated security limit for customer PDFs, and it described the path as
 * containing a *"32-character random segment"*. It is not random. `accessTokenFor` is an HMAC-SHA256 of
 * the proposal code under `PROPOSAL_LINK_SECRET`, truncated to 32 base64url characters -- deterministic,
 * and the same for a given code on every instance, which is the whole reason it is derived rather than
 * stored.
 *
 * The distinction is the reason the paragraph exists. A random segment gives each object independent
 * entropy: leaking one link tells you nothing about the others, and there is nothing to recompute. A
 * derived token means **one leaked secret yields every customer's link**, computable offline, and the
 * proposal codes are sequential. The paragraph carefully lists the other two limits -- no expiry, no
 * revocation -- so understating this one was the gap, not a missing feature.
 *
 * Measured live at iteration 162 rather than assumed, and all of it held: a storage `list` returns zero
 * entries with the public anon key and with a signed-in sales rep's token; the real URL returns a
 * 2,570-byte `application/pdf`; altering one character of the token returns **400**, and so does
 * altering the guessable `PRP-` code. The three `drop policy` statements waiting to be pasted are on
 * `proposals`, `inquiries` and `follow_ups` -- tables, not storage -- so none of that changes when they
 * are applied.
 *
 * What a test can hold still is the description. These cases fail if the number drifts from the code or
 * the mechanism is described as random again.
 */
describe('what README.md claims about the capability token', () => {
  const readme = () => readFileSync(join(repoRoot, 'README.md'), 'utf8').replace(/\s+/g, ' ')

  /** The paragraph, sliced, so none of this can be satisfied by prose elsewhere in a long README. */
  const paragraph = (): string => {
    const flat = readme()
    const start = flat.indexOf('A stated limit: a customer')
    expect(start, 'README.md no longer carries the capability-URL paragraph; re-point this rather than deleting it').toBeGreaterThan(-1)
    const end = flat.indexOf('**Email:**', start)
    const slice = end === -1 ? flat.slice(start) : flat.slice(start, end)
    expect(slice.length, 'the paragraph came back too short to be it').toBeGreaterThan(400)
    return slice
  }

  it('states the length the code actually produces', () => {
    const token = accessTokenFor('PRP-2011')
    expect(token.length, 'the capability token is no longer 32 characters').toBe(32)
    expect(
      paragraph(),
      `README.md states a token length that is not ${token.length}, which is what accessTokenFor returns. ` +
        `A shorter token is a guessable URL for a customer's pricing, and the paragraph is where this ` +
        `project says how long it is.`,
    ).toContain(`${token.length}-character`)
  })

  it('does not call a derived token random', () => {
    expect(
      accessTokenFor('PRP-2011'),
      'accessTokenFor is no longer deterministic, so the wording below would be wrong the other way',
    ).toBe(accessTokenFor('PRP-2011'))
    expect(
      paragraph(),
      'README.md describes the capability token as random. It is an HMAC of the proposal code under ' +
        'PROPOSAL_LINK_SECRET, so one leaked secret recomputes every customer link -- a different risk ' +
        'from independent per-object entropy, in the paragraph whose job is to state the limit honestly.',
    ).not.toMatch(/random segment|random token|random 32/i)
  })

  it('says the secret is the credential behind every link', () => {
    const p = paragraph()
    expect(p, 'README.md no longer names the secret the token is derived from').toMatch(/PROPOSAL_LINK_SECRET/)
    expect(
      p,
      'README.md no longer states the consequence of deriving rather than storing: the secret is the ' +
        'credential behind every link.',
    ).toMatch(/derived, not random|credential behind every link/i)
  })

  it('keeps the limits it already stated, which are still true', () => {
    const p = paragraph()
    for (const claim of ['capability URL', 'the link *is* the credential', 'no expiry']) {
      expect(p, `README.md no longer says "${claim}"`).toContain(claim)
    }
  })
})
