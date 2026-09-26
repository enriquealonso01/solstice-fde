/**
 * The logins a reviewer is told to use must be the logins that exist.
 *
 * `SUBMISSION.md` carries the email body Enrique sends, and it names three staff addresses. The
 * addresses that actually exist are the ones `scripts/seed-users.mjs` creates, and the role each one
 * gets is set there too. Four documents and one migration repeat those addresses; nothing tied any of
 * them to the script.
 *
 * The failure is the worst-shaped one in the package. Rename a seeded address -- or add a fourth login
 * and mention it in one document -- and a reviewer types an address that does not exist, gets *"invalid
 * credentials"* from the live site, and concludes the whole thing is broken. It happens on their first
 * interaction with the deployed app, before they have seen anything work, and nothing here would fail.
 *
 * Verified live at iteration 155 rather than assumed, read-only against production plus one sign-in each:
 *
 *   supervisor@solsticehotels.com   auth yes, confirmed, profile role concierge    signed in
 *   sales@solsticehotels.com        auth yes, confirmed, profile role group_sales  signed in
 *   admin@solsticehotels.com        auth yes, confirmed, profile role admin        signed in
 *
 * Three auth users, three profile rows, no extras, and each session read its own role back through RLS.
 * So the chain holds today: documented address -> auth user -> confirmed -> profile role -> password
 * sign-in. What this file adds is the part a test can keep true, which is the first link.
 *
 * Scoped to documents on purpose. `src/pages/Login.tsx` uses `you@solsticehotels.com` and
 * `AdminHome.tsx` uses `name@solsticehotels.com` as form placeholders -- correct, and exactly what a
 * placeholder should be, which is why the sweep reads prose rather than the app.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(__dirname, '../../../..')
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8').replace(/\r\n/g, '\n')

/** What the seed script creates: the only addresses that can be signed into. */
function seeded(): { email: string; role: string }[] {
  const src = read('scripts/seed-users.mjs')
  return [...src.matchAll(/email:\s*'([^']+)'[^}]*?role:\s*'([^']+)'/g)].map((m) => ({
    email: m[1].toLowerCase(),
    role: m[2],
  }))
}

/**
 * Documents that tell a human which address to type.
 *
 * `DEMO_LOGINS.md` is gitignored -- it holds the working password -- so it is checked when present and
 * skipped when not. A guard that required it would fail for the reviewer who downloaded the ZIP, which
 * is the failure iteration 137 spent an iteration removing from three other guards.
 */
const DOCS = ['SUBMISSION.md', 'README.md', 'docs/demo-runbook.md', 'docs/role-walkthroughs.md', 'DEMO_LOGINS.md']

const ADDRESS = /[a-z0-9._%+-]+@solsticehotels\.com/gi

describe('the staff logins the documents hand a reviewer', () => {
  it('parses the seed script, so nothing below is checked against an empty list', () => {
    const users = seeded()
    expect(
      users.length,
      'could not read email/role pairs out of scripts/seed-users.mjs. If its shape changed, re-point this ' +
        'parser -- every case in this file compares against it.',
    ).toBeGreaterThanOrEqual(3)
    expect(new Set(users.map((u) => u.email)).size, 'the seed script names the same address twice').toBe(users.length)
  })

  it('names no address the seed script does not create', () => {
    const known = new Set(seeded().map((u) => u.email))
    const strays: string[] = []
    let scanned = 0

    for (const doc of DOCS) {
      if (!existsSync(join(repoRoot, doc))) continue
      scanned += 1
      for (const m of read(doc).matchAll(ADDRESS)) {
        const address = m[0].toLowerCase()
        if (!known.has(address)) strays.push(`${doc}: ${address}`)
      }
    }

    expect(scanned, 'no login documents were readable, so this sweep proved nothing').toBeGreaterThanOrEqual(4)
    expect(
      [...new Set(strays)],
      `these documents name a staff address that scripts/seed-users.mjs does not create: ` +
        `${[...new Set(strays)].join(', ')}. A reviewer typing it gets "invalid credentials" from the live ` +
        `site on their first interaction with it. Either seed it or correct the document.`,
    ).toEqual([])
  })

  /**
   * SUBMISSION.md carries the addresses TWICE and both copies have to be complete: the credentials block
   * Enrique reads, and the blockquote he pastes into the email a reviewer actually receives.
   *
   * The first version of this case asked `read('SUBMISSION.md').includes(email)` -- the whole file. Its
   * red-check deleted `sales@solsticehotels.com` from the credentials block and **the case still passed**,
   * because the email template sixty lines below still mentioned it. That is iteration 145's defect
   * exactly: a file-wide containment check proves nothing about WHICH occurrence satisfied it, and here
   * the two occurrences are two different jobs. Found by the mutation that mattered being the one that
   * did not fail.
   */
  /**
   * The CONTENTS of the fenced block under "Staff credentials", not the prose above it.
   *
   * The first attempt sliced from the heading to `search(/\n```[\s\S]*?\n```/)` -- and `search` returns
   * where the fence BEGINS, so the slice stopped one line in and held the heading alone. It failed
   * immediately rather than passing on nothing, which is the good version of that mistake, but it is the
   * same family as an over-long slice: print the region before trusting it.
   */
  const credentialsBlock = (): string => {
    const m = /\*\*3\. Staff credentials\*\*[\s\S]*?\n```\n([\s\S]*?)\n```/.exec(read('SUBMISSION.md'))
    expect(m, 'SUBMISSION.md no longer has a fenced staff-credentials block; re-point this rather than deleting it').toBeTruthy()
    return (m as RegExpExecArray)[1].toLowerCase()
  }

  /** The blockquote Enrique pastes into the email: the contiguous run of quoted lines. */
  const emailTemplate = (): string => {
    const lines = read('SUBMISSION.md').split('\n')
    const start = lines.findIndex((l) => /^> To see the staff side, sign in at \/login:/.test(l))
    expect(start, 'SUBMISSION.md no longer carries the email template; re-point this rather than deleting it').toBeGreaterThan(-1)
    const run: string[] = []
    for (let i = start; i < lines.length && lines[i].startsWith('>'); i++) run.push(lines[i])
    return run.join('\n').toLowerCase()
  }

  it('gives every seeded login in BOTH places SUBMISSION.md lists them', () => {
    for (const [label, slice] of [
      ['the credentials block', credentialsBlock()],
      ['the email template', emailTemplate()],
    ] as const) {
      expect(slice.length, `${label} came back empty, so the addresses below are checked against nothing`).toBeGreaterThan(60)

      const missing = seeded()
        .map((u) => u.email)
        .filter((email) => !slice.includes(email))

      expect(
        missing,
        `${label} in SUBMISSION.md does not name ${missing.join(', ')}. Checked per block on purpose: the ` +
          `file lists the addresses twice, sixty lines apart, and a file-wide search passes while the block ` +
          `a reviewer actually reads has lost one. A seeded login nobody is told about is a role they ` +
          `cannot see the product through.`,
      ).toEqual([])
    }
  })

  it('keeps the two lists in agreement, so neither can drift alone', () => {
    const inBlock = [...new Set([...credentialsBlock().matchAll(ADDRESS)].map((m) => m[0].toLowerCase()))].sort()
    const inEmail = [...new Set([...emailTemplate().matchAll(ADDRESS)].map((m) => m[0].toLowerCase()))].sort()
    expect(inBlock.length, 'no addresses found in the credentials block').toBeGreaterThanOrEqual(3)
    expect(
      inEmail,
      `the credentials block lists ${inBlock.join(', ')} and the email template lists ${inEmail.join(', ')}.`,
    ).toEqual(inBlock)
  })

  it('seeds only roles the schema accepts', () => {
    // A user created with a role outside the enum signs in and can do nothing: the row is rejected or the
    // policies match nothing, and it looks like a broken app rather than a bad seed.
    const enumLine = read('supabase/schema.sql').match(/create type staff_role as enum \(([^)]+)\)/)
    expect(enumLine, 'schema.sql no longer declares the staff_role enum; re-point this case').toBeTruthy()
    const allowed = new Set([...(enumLine as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]))
    expect(allowed.size, 'parsed no values out of the staff_role enum').toBeGreaterThanOrEqual(2)

    const bad = seeded().filter((u) => !allowed.has(u.role))
    expect(
      bad.map((u) => `${u.email} -> ${u.role}`),
      `seed-users.mjs assigns a role the staff_role enum does not have: ${bad
        .map((u) => u.role)
        .join(', ')}. Allowed: ${[...allowed].join(', ')}.`,
    ).toEqual([])
  })

  it('covers all three roles the product is built around, not one of them three times', () => {
    // The whole point of the three logins is that they see different things. Two concierges and no
    // group_sales would still satisfy every case above.
    const roles = new Set(seeded().map((u) => u.role))
    for (const role of ['concierge', 'group_sales', 'admin']) {
      expect(roles.has(role), `no seeded login has the ${role} role, so that half of the demo cannot be shown`).toBe(
        true,
      )
    }
  })
})
