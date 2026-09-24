// Creates the three scoped demo logins and their profile rows.
// Idempotent: re-running updates the password and role rather than erroring.
//   node scripts/seed-users.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const env = Object.fromEntries(
  readFileSync(resolve(root, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const URL_ = env.SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_ || !KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required in .env')

const PASSWORD = env.DEMO_PASSWORD || 'SolsticeDemo2026!'

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
