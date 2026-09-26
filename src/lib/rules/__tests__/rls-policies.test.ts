/**
 * Two properties of the declared policy set, one of which makes Enrique's pending SQL safe to paste.
 *
 * The package's open security item is that `proposals`, `inquiries` and `follow_ups` carry `FOR ALL`
 * write policies, so a signed-in rep can PATCH `status` to `approved` from the browser with the
 * public anon key and walk past `canSend` entirely. The fix is
 * `supabase/migrations/004_client_read_only_on_group_tables.sql`, and what reaches Enrique is its
 * three `drop policy` lines, pasted by hand into the SQL editor.
 *
 * **Dropping a `FOR ALL` policy also drops the read it was granting.** That is only safe because
 * `schema.sql:183-185` declares `inq_read`, `prop_read` and `fup_read` separately. If someone tidied
 * those away as redundant -- they look redundant while `FOR ALL` exists -- the paste would silently
 * turn the group sales inbox into an empty screen, and it would happen in the SQL editor minutes
 * before a demo, with beat 4 reading "no inquiries". Migration 004 restates the reads in a
 * `do $$ ... end $$` block for exactly this reason, but the three lines Enrique has in hand do not
 * carry that block. Nothing asserted the reads existed. Now something does.
 *
 * The second property is the general form of the bug: a write policy that does not test who is asking
 * is the whole defect. Every one declared today tests `my_role()` or `auth.uid()`; this keeps it that
 * way, so a new `for all using (true)` cannot arrive quietly while attention is elsewhere.
 *
 * Checked empirically in iteration 100 before writing this, against production: `/api/flags` answers
 * 401 unauthenticated and 403 to a signed-in concierge, and `demo_flags` is admin-only at the database
 * layer too -- an anon `select` returns `[]` where a signed-in one returns three rows, which proves
 * migration 003's RLS is live and not merely declared.
 *
 * Note for anyone probing RLS by hand: a PATCH whose filter matches no row returns `200 []` on every
 * table in this schema, including `audit_log` and `profiles`, which nothing may write. It says
 * nothing about whether the write would have been allowed. I nearly filed a hole on the strength of
 * it.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readdirSync } from 'node:fs'

const repoRoot = resolve(__dirname, '../../../..')

type Policy = { name: string; table: string; command: string; body: string; file: string }

function policies(): Policy[] {
  const files = [
    'supabase/schema.sql',
    ...readdirSync(join(repoRoot, 'supabase/migrations'))
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => `supabase/migrations/${f}`),
  ]
  const out: Policy[] = []
  for (const file of files) {
    const text = readFileSync(join(repoRoot, file), 'utf8')
    // A declaration runs to its terminating semicolon and may wrap across lines.
    for (const m of text.matchAll(/create policy\s+(\w+)\s+on\s+(\w+)\s+for\s+(\w+)([\s\S]*?);/gi)) {
      out.push({ name: m[1], table: m[2], command: m[3].toLowerCase(), body: m[4], file })
    }
  }
  return out
}

describe('the declared row level security policies', () => {
  it('finds them, so nothing below passes by parsing nothing', () => {
    const all = policies()
    expect(all.length).toBeGreaterThanOrEqual(12)
    expect(all.map((p) => p.name)).toContain('prop_read')
  })

  it('never grants a write without testing who is asking', () => {
    const offenders = policies()
      .filter((p) => p.command !== 'select')
      .filter((p) => !/my_role\s*\(\s*\)|auth\.uid\s*\(\s*\)/.test(p.body))
      .map((p) => `${p.file}: ${p.name} on ${p.table} (for ${p.command})`)

    expect(
      offenders,
      `A write policy that does not test my_role() or auth.uid() is the defect this package already ` +
        `discloses on the group tables -- a signed-in browser, or an unauthenticated one, writing ` +
        `rows the Netlify functions are supposed to own:\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  // Deliberately blind to migration 004 itself. Its do-block restates the three reads, so counting
  // them would make this case pass on the strength of the very file whose three drop lines are the
  // thing being pasted without that block. The first version of this test did exactly that and
  // stayed green when prop_read was deleted from schema.sql -- caught by red-checking it, which is
  // the only reason it is written this way.
  const FIX = 'supabase/migrations/004_client_read_only_on_group_tables.sql'

  it.each(['proposals', 'inquiries', 'follow_ups'])(
    '%s has a select policy that does not depend on migration 004' ,
    (table) => {
      const reads = policies().filter((p) => p.table === table && p.command === 'select' && p.file !== FIX)
      expect(
        reads.map((p) => `${p.name} (${p.file})`),
        `${table} has no "for select" policy outside ${FIX}. Its reads would then be coming from ` +
          `the ` +
          `FOR ALL write policy, and the three "drop policy" lines in ` +
          `supabase/migrations/004_client_read_only_on_group_tables.sql -- which Enrique pastes by ` +
          `hand, without that file's do-block -- would take the group sales inbox blank at the same ` +
          `time as closing the hole.`,
      ).not.toEqual([])
    },
  )

  it('keeps the audit trail append-only, which is what makes it evidence', () => {
    const onAudit = policies().filter((p) => p.table === 'audit_log')
    const commands = onAudit.map((p) => p.command)
    expect(commands).toContain('insert')
    expect(commands).toContain('select')
    // No update and no delete policy, so an override cannot be edited or removed after the fact --
    // the property InquiryDetail.tsx promises with "Overrides are readable forever."
    expect(commands, 'audit_log gained an update or delete policy').not.toContain('update')
    expect(commands, 'audit_log gained an update or delete policy').not.toContain('delete')
    expect(commands, 'audit_log gained a FOR ALL policy').not.toContain('all')
  })
})
