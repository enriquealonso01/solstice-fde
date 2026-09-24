#!/usr/bin/env node
// Seeds Supabase with the reference data and the ten group inquiries.
//
//   node scripts/data/seed.mjs            # upsert everything
//   node scripts/data/seed.mjs --dry-run  # show what would be written
//
// Idempotent: every write is an upsert keyed on the natural id (property_code, guest_id,
// reservation_id, section_id, inquiry_code), so running it twice changes nothing and running
// it after `node scripts/data/build.mjs` republishes whatever the source data now says.
//
// Two things are deliberately NOT sent to the database:
//   - `dataset_notes`, the challenge author's commentary on each inquiry. It is an answer key;
//     the group-sales side chat reads the inquiries table, so leaking it would make every
//     demo a lie.
//   - raw guest emails and phone numbers. guests.json is already masked at rest.
//     Inquiry contact details DO go in, because a proposal has to be deliverable.

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { loadEnv } from './lib/env.mjs'
import { generatedDir } from './lib/paths.mjs'

loadEnv()

const DRY_RUN = process.argv.includes('--dry-run')

function readGenerated(name) {
  const file = resolve(generatedDir, name)
  if (!existsSync(file)) {
    throw new Error(
      `data/generated/${name} is missing. Run \`node scripts/data/build.mjs\` first: the generated ` +
        `JSON is what both the tools and this seeder read.`,
    )
  }
  return JSON.parse(readFileSync(file, 'utf8'))
}

function requireSupabase() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const missing = []
  if (!url) missing.push('SUPABASE_URL')
  if (!key) missing.push('SUPABASE_SERVICE_ROLE_KEY')
  if (missing.length > 0) {
    throw new Error(
      `${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} not set.\n` +
        '  Add them to .env (see .env.example). Both are in Supabase > Project Settings > API.\n' +
        '  SUPABASE_SERVICE_ROLE_KEY bypasses row-level security: keep it out of the browser bundle.',
    )
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

function isMissingTable(error) {
  if (!error) return false
  if (['42P01', 'PGRST205', 'PGRST202'].includes(error.code)) return true
  return /relation .* does not exist|could not find the table/i.test(error.message ?? '')
}

function explain(error, table) {
  if (isMissingTable(error)) {
    return (
      `Table "${table}" does not exist (${error.message}).\n` +
      '  The schema has not been applied to this project yet. Run:\n' +
      '    node scripts/data/apply-schema.mjs\n' +
      '  or paste supabase/schema.sql into the Supabase SQL editor, then re-run this seeder.'
    )
  }
  if (error.code === '42501' || /row-level security/i.test(error.message ?? '')) {
    return (
      `Writing "${table}" was blocked by row-level security (${error.message}).\n` +
      '  This seeder must run with SUPABASE_SERVICE_ROLE_KEY, not the anon key. Check .env.'
    )
  }
  return `Writing "${table}" failed: ${error.message}${error.hint ? ` (${error.hint})` : ''}`
}

async function upsert(db, table, rows, conflictColumn) {
  if (rows.length === 0) return
  if (DRY_RUN) {
    console.log(`  [dry-run] ${table}: would upsert ${rows.length} row(s) on ${conflictColumn}`)
    return
  }
  const { error } = await db.from(table).upsert(rows, { onConflict: conflictColumn })
  if (error) throw new Error(explain(error, table))
  const { count, error: countError } = await db.from(table).select('*', { count: 'exact', head: true })
  if (countError) throw new Error(explain(countError, table))
  console.log(`  ${table}: upserted ${rows.length}, table now holds ${count}`)
}

async function main() {
  const properties = readGenerated('properties.json')
  const guests = readGenerated('guests.json')
  const reservations = readGenerated('reservations.json')
  const policies = readGenerated('policies.json')
  const inquiries = readGenerated('inquiries.json')

  const db = DRY_RUN && !process.env.SUPABASE_URL ? null : requireSupabase()

  console.log(DRY_RUN ? 'Seeding Supabase (dry run) ...' : 'Seeding Supabase ...')

  await upsert(
    db,
    'properties',
    properties.map((p) => ({ property_code: p.property_code, data: p })),
    'property_code',
  )

  await upsert(
    db,
    'guests',
    guests.map((g) => ({ guest_id: g.guest_id, data: g })),
    'guest_id',
  )

  await upsert(
    db,
    'reservations',
    reservations.map((r) => ({ reservation_id: r.reservation_id, guest_id: r.guest_id, data: r })),
    'reservation_id',
  )

  await upsert(
    db,
    'policies',
    policies.map((s) => ({ section_id: s.section_id, title: s.title, body: s.body })),
    'section_id',
  )

  await upsert(
    db,
    'inquiries',
    inquiries.map(({ dataset_notes: _answerKey, ...payload }) => ({
      inquiry_code: payload.inquiry_id,
      source: payload.source,
      payload,
      missing_fields: payload.missing_fields,
      status: payload.is_actionable ? 'new' : 'needs_info',
    })),
    'inquiry_code',
  )

  console.log('')
  console.log('Done. The reference tables are readable by any signed-in staff member; the')
  console.log('inquiries table is restricted to group_sales and admin by the policies in')
  console.log('supabase/schema.sql. `dataset_notes` was stripped before writing.')
}

main().catch((err) => {
  console.error('')
  console.error(err instanceof Error ? err.message : String(err))
  console.error('')
  process.exitCode = 1
})
