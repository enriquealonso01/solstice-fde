#!/usr/bin/env node
// Applies supabase/schema.sql.
//
//   SUPABASE_DB_URL=postgresql://... node scripts/data/apply-schema.mjs
//
// With SUPABASE_DB_URL set it applies the file for you, preferring the `pg` driver and
// falling back to `psql`. Without it, it prints exactly what to paste where. It NEVER drops
// or truncates anything: schema.sql uses plain `create`, so a second run reports "already
// exists" and stops rather than guessing that you wanted the data gone.
//
// Where to find the URL: Supabase > Project Settings > Database > Connection string > URI.
// Use the pooled (port 6543) or direct (5432) string; either works for DDL.

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { loadEnv } from './lib/env.mjs'
import { repoRoot } from './lib/paths.mjs'

loadEnv()

const SCHEMA_FILE = resolve(repoRoot, 'supabase', 'schema.sql')
const DB_URL = process.env.SUPABASE_DB_URL

function manualInstructions(reason) {
  const rel = 'supabase/schema.sql'
  console.log('')
  console.log('='.repeat(78))
  console.log('  Supabase schema NOT applied automatically')
  console.log('='.repeat(78))
  console.log(`  Reason: ${reason}`)
  console.log('')
  console.log('  Option A - paste it in (no local Postgres client needed):')
  console.log('    1. Open your project at https://supabase.com/dashboard')
  console.log('    2. SQL Editor > New query')
  console.log(`    3. Paste the contents of ${rel} and Run`)
  console.log('')
  console.log('  Option B - let this script do it:')
  console.log('    1. Supabase > Project Settings > Database > Connection string > URI')
  console.log('    2. Add it to .env as SUPABASE_DB_URL=postgresql://postgres:...@...:5432/postgres')
  console.log('    3. node scripts/data/apply-schema.mjs')
  console.log('')
  console.log('  Option C - psql directly:')
  console.log(`    psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f ${rel}`)
  console.log('')
  console.log('  Then seed the reference data:')
  console.log('    node scripts/data/seed.mjs')
  console.log('='.repeat(78))
  console.log('')
}

function reportAlreadyApplied(message) {
  console.log('')
  console.log('  The schema appears to be applied already:')
  console.log(`    ${message}`)
  console.log('')
  console.log('  supabase/schema.sql is written with plain `create` statements, so it is not')
  console.log('  re-runnable. This script will not drop anything to make it re-runnable: that')
  console.log('  would take your sessions, messages and proposals with it.')
  console.log('')
  console.log('  If you genuinely want a clean slate, do it deliberately in the Supabase SQL')
  console.log('  editor, then re-run this script and `node scripts/data/seed.mjs`.')
  console.log('')
}

async function applyWithPg(sql) {
  let pg
  try {
    pg = await import('pg')
  } catch {
    return { attempted: false }
  }
  const Client = pg.default?.Client ?? pg.Client
  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } })
  try {
    await client.connect()
    await client.query(sql)
    await client.end()
    return { attempted: true, ok: true }
  } catch (err) {
    try {
      await client.end()
    } catch {
      /* already closed */
    }
    return { attempted: true, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function applyWithPsql() {
  const probe = spawnSync('psql', ['--version'], { encoding: 'utf8' })
  if (probe.error) return { attempted: false }
  const run = spawnSync('psql', [DB_URL, '-v', 'ON_ERROR_STOP=1', '-f', SCHEMA_FILE], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (run.status === 0) return { attempted: true, ok: true, stdout: run.stdout }
  return { attempted: true, ok: false, error: (run.stderr || run.stdout || '').trim() }
}

async function main() {
  if (!existsSync(SCHEMA_FILE)) {
    console.error(`Cannot find ${SCHEMA_FILE}. Nothing to apply.`)
    process.exitCode = 1
    return
  }
  const sql = readFileSync(SCHEMA_FILE, 'utf8')
  console.log(`Read supabase/schema.sql (${sql.length.toLocaleString()} bytes).`)

  if (!DB_URL) {
    manualInstructions('SUPABASE_DB_URL is not set.')
    return
  }

  console.log('SUPABASE_DB_URL is set. Applying ...')

  const viaPg = await applyWithPg(sql)
  if (viaPg.attempted && viaPg.ok) {
    console.log('  Applied via the pg driver.')
    console.log('  Next: node scripts/data/seed.mjs')
    return
  }
  if (viaPg.attempted && !viaPg.ok) {
    if (/already exists/i.test(viaPg.error ?? '')) {
      reportAlreadyApplied(viaPg.error)
      return
    }
    console.error(`  pg driver failed: ${viaPg.error}`)
  }

  const viaPsql = applyWithPsql()
  if (viaPsql.attempted && viaPsql.ok) {
    console.log('  Applied via psql.')
    console.log('  Next: node scripts/data/seed.mjs')
    return
  }
  if (viaPsql.attempted && !viaPsql.ok) {
    if (/already exists/i.test(viaPsql.error ?? '')) {
      reportAlreadyApplied(viaPsql.error)
      return
    }
    console.error(`  psql failed: ${viaPsql.error}`)
    process.exitCode = 1
    return
  }

  manualInstructions(
    'neither the `pg` driver nor a `psql` binary is available here. ' +
      '(`pg` is not in package.json, which is the shared shell and not ours to edit.)',
  )
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 1
})
