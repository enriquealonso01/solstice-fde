// Creates the three scoped demo logins and their profile rows.
// Idempotent: re-running updates the password and role rather than erroring.
//   node scripts/seed-users.mjs
import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from './data/lib/env.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// `loadEnv` tolerates a missing .env and falls back to the shell. The hand-rolled reader that used to
// live here did not: it called readFileSync on .env unguarded, so anyone following README.md's
// "Running it locally" block without credentials -- which is every reviewer, because the block says to
// fill in .env and they have no Supabase project -- got an unhandled ENOENT and a stack trace with an
// absolute path, while the two checks below sat there holding the actual answer. `db:schema` and
// `db:seed` both explain themselves in that situation; this one crashed.
loadEnv()

const URL_ = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const missing = [!URL_ && 'SUPABASE_URL', !KEY && 'SUPABASE_SERVICE_ROLE_KEY'].filter(Boolean)
if (missing.length > 0) {
  console.error('')
  console.error(`${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} not set.`)
  console.error('  Add them to .env (see .env.example). Both are in Supabase > Project Settings > API.')
  console.error('  SUPABASE_SERVICE_ROLE_KEY bypasses row-level security: keep it out of the browser bundle.')
  console.error('')
  console.error('  Reviewing rather than running it? The deployed site needs none of this, and')
  console.error('  `npx vitest run` and `npm run data:check` both work with no credentials at all.')
  console.error('')
  process.exit(1)
}

// No default. A literal here ends up in git history, and this repository is public, so the
// password would be permanently published even after being removed from the working tree.
const PASSWORD = process.env.DEMO_PASSWORD
if (!PASSWORD) {
  console.error('Set DEMO_PASSWORD in .env before seeding users. It is deliberately not defaulted.')
  process.exit(1)
}

const USERS = [
  { email: 'supervisor@solsticehotels.com', role: 'concierge', name: 'Dana Reyes' },
  { email: 'sales@solsticehotels.com', role: 'group_sales', name: 'Marcus Feld' },
  { email: 'admin@solsticehotels.com', role: 'admin', name: 'Enrique Alonso' },
]

const h = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

async function findUser(email) {
  const r = await fetch(`${URL_}/auth/v1/admin/users?per_page=200`, { headers: h })
  if (!r.ok) throw new Error(`list users failed: ${r.status} ${await r.text()}`)
  const body = await r.json()
  return (body.users ?? body).find((u) => u.email === email) ?? null
}

async function upsertUser({ email, role, name }) {
  let user = await findUser(email)
  if (user) {
    const r = await fetch(`${URL_}/auth/v1/admin/users/${user.id}`, {
      method: 'PUT',
      headers: h,
      body: JSON.stringify({ password: PASSWORD, email_confirm: true }),
    })
    if (!r.ok) throw new Error(`update ${email}: ${r.status} ${await r.text()}`)
    console.log(`  ${email.padEnd(34)} exists, password reset`)
  } else {
    const r = await fetch(`${URL_}/auth/v1/admin/users`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
    })
    if (!r.ok) throw new Error(`create ${email}: ${r.status} ${await r.text()}`)
    user = await r.json()
    console.log(`  ${email.padEnd(34)} created`)
  }

  const p = await fetch(`${URL_}/rest/v1/profiles`, {
    method: 'POST',
    headers: { ...h, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ id: user.id, email, full_name: name, role }),
  })
  if (!p.ok) throw new Error(`profile ${email}: ${p.status} ${await p.text()}`)
  return { email, role, name }
}

console.log('Creating demo logins ...')
const made = []
for (const u of USERS) made.push(await upsertUser(u))

const card = [
  '# Demo logins (local only, gitignored)',
  '',
  `Password for all three: ${PASSWORD}`,
  '',
  '| Role | Email | Sees |',
  '|---|---|---|',
  `| Concierge supervisor | ${USERS[0].email} | Live sessions, transcripts, takeover. No group sales. |`,
  `| Group sales | ${USERS[1].email} | Inquiry inbox, proposals, approvals. No guest calls. |`,
  `| Super admin | ${USERS[2].email} | Everything, invites, backend map. |`,
  '',
  'Scoping is enforced by row level security in Postgres, not by the UI.',
  'Sign in at /login.',
  '',
].join('\n')
writeFileSync(resolve(root, 'DEMO_LOGINS.md'), card)

console.log(`\nDone. ${made.length} logins ready. Password: ${PASSWORD}`)
console.log('Written to DEMO_LOGINS.md (gitignored).')
