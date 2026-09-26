/**
 * The row level security a database ends up with after schema.sql and every migration are applied
 * in order. Checked structurally: policy names, commands, tables and roles, never comments.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(__dirname, '../../../..')
const LEAST_PRIVILEGE = 'supabase/migrations/007_least_privilege.sql'

type Policy = { name: string; table: string; command: string; body: string; file: string }

const FILES = [
  'supabase/schema.sql',
  ...readdirSync(join(repoRoot, 'supabase/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => `supabase/migrations/${f}`),
]

const sql = (file: string) => readFileSync(join(repoRoot, file), 'utf8')

// A declaration runs to its terminating semicolon and may wrap across lines.
const STATEMENT =
  /create policy\s+(\w+)\s+on\s+(\w+)\s+for\s+(\w+)([\s\S]*?);|drop policy\s+if exists\s+(\w+)\s+on\s+(\w+)\s*;/gi

/** Every `create policy`, in every file. */
function declared(): Policy[] {
  const out: Policy[] = []
  for (const file of FILES) {
    for (const m of sql(file).matchAll(STATEMENT)) {
      if (m[1]) out.push({ name: m[1], table: m[2], command: m[3].toLowerCase(), body: m[4], file })
    }
  }
  return out
}

/** What is left once the files are applied in order: a drop removes, a create replaces. */
function effective(): Policy[] {
  const live = new Map<string, Policy>()
  for (const file of FILES) {
    for (const m of sql(file).matchAll(STATEMENT)) {
      if (m[1]) live.set(`${m[2]}.${m[1]}`, { name: m[1], table: m[2], command: m[3].toLowerCase(), body: m[4], file })
      else live.delete(`${m[6]}.${m[5]}`)
    }
  }
  return [...live.values()]
}

/** The roles a `my_role() in (...)` policy admits, sorted; null when it tests something else. */
function roles(policy: Policy): string[] | null {
  const m = policy.body.match(/my_role\s*\(\s*\)\s+in\s*\(([^)]*)\)/i)
  return m ? [...m[1].matchAll(/'(\w+)'/g)].map((r) => r[1]).sort() : null
}

describe('the declared row level security policies', () => {
  it('finds them, so nothing below passes by parsing nothing', () => {
    expect(declared().length).toBeGreaterThanOrEqual(12)
    expect(effective().map((p) => p.name)).toContain('prop_read')
  })

  it('never grants a write without testing who is asking', () => {
    const offenders = declared()
      .filter((p) => p.command !== 'select')
      .filter((p) => !/my_role\s*\(\s*\)|auth\.uid\s*\(\s*\)/.test(p.body))
      .map((p) => `${p.file}: ${p.name} on ${p.table} (for ${p.command})`)
    expect(offenders).toEqual([])
  })

  // Migration 004 drops the FOR ALL write policies on these tables; the reads must not depend on it.
  it.each(['proposals', 'inquiries', 'follow_ups'])('%s has a select policy outside migration 004', (table) => {
    const reads = declared().filter(
      (p) => p.table === table && p.command === 'select' && !p.file.includes('004_'),
    )
    expect(reads).not.toEqual([])
  })
})

describe('least privilege after migration 007', () => {
  it.each(['guests', 'reservations'])('%s is readable by concierge and admin only', (table) => {
    const onTable = effective().filter((p) => p.table === table)
    expect(onTable.map((p) => p.command)).toEqual(['select'])
    expect(onTable.map(roles)).toEqual([['admin', 'concierge']])
  })

  it('leaves group sales no read on reservations, where payment_last4 lives', () => {
    const readers = effective().filter((p) => p.table === 'reservations').flatMap((p) => roles(p) ?? ['anyone signed in'])
    expect(readers).not.toContain('group_sales')
    expect(readers).not.toContain('anyone signed in')
  })

  it('lets no browser write the audit log: reads only, inserts come from the service role', () => {
    const commands = effective()
      .filter((p) => p.table === 'audit_log')
      .map((p) => p.command)
    expect(commands).toEqual(['select'])
  })

  it('keeps raw inquiry contacts in a table with RLS on and no policy at all', () => {
    const text = sql(LEAST_PRIVILEGE)
    expect(text).toMatch(/create table if not exists inquiry_contacts\s*\(/i)
    expect(text).toMatch(/alter table inquiry_contacts enable row level security\s*;/i)
    expect(text).toMatch(/revoke all on inquiry_contacts from anon,\s*authenticated\s*;/i)
    expect(declared().filter((p) => p.table === 'inquiry_contacts')).toEqual([])
  })

  it('backfills the contacts before it rewrites the payload', () => {
    const text = sql(LEAST_PRIVILEGE)
    const backfill = text.search(/insert into inquiry_contacts/i)
    const rewrite = text.search(/update inquiries\s+set payload/i)
    expect(backfill).toBeGreaterThan(-1)
    expect(rewrite).toBeGreaterThan(backfill)
  })

  it('never blanks a stored contact when the backfill runs again', () => {
    expect(sql(LEAST_PRIVILEGE)).toMatch(
      /on conflict \(inquiry_code\) do update\s+set email = coalesce\(excluded\.email, inquiry_contacts\.email\),\s*phone = coalesce\(excluded\.phone, inquiry_contacts\.phone\)/i,
    )
  })

  it('can be pasted twice: every policy it creates is dropped first', () => {
    const text = sql(LEAST_PRIVILEGE)
    for (const m of text.matchAll(/create policy\s+(\w+)\s+on\s+(\w+)/gi)) {
      const drop = text.search(new RegExp(`drop policy if exists ${m[1]} on ${m[2]}\\s*;`, 'i'))
      expect(drop, `${m[1]} on ${m[2]}`).toBeGreaterThan(-1)
      expect(drop).toBeLessThan(m.index ?? 0)
    }
  })
})
