// Checks whether the sending domain has verified yet, and says exactly what is still missing.
//
// DNS propagation is the step where people guess. This asks Telnyx directly, record by record,
// so "did it work" has an answer instead of a shrug.
//
//   node scripts/check-email-domain.mjs
//   node scripts/check-email-domain.mjs --send   # once verified, sends a real test email
import { readFileSync } from 'node:fs'
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

const KEY = env.TELNYX_API_KEY
if (!KEY) throw new Error('TELNYX_API_KEY required')
// slice(2): argv[0] is the node binary, whose path contains dots and matched the old check.
const DOMAIN = process.argv.slice(2).find((a) => a.includes('.') && !a.startsWith('-')) ?? 'enriquecodes.com'

const res = await fetch('https://api.telnyx.com/v2/email_domains', {
  headers: { Authorization: `Bearer ${KEY}` },
})
const body = await res.json()
const domain = (body.data ?? []).find((d) => d.domain === DOMAIN)

if (!domain) {
  console.error(`${DOMAIN} is not registered in Telnyx. Create it first.`)
  process.exit(1)
}

const PURPOSE = { dkim: 'DKIM signature', ownership: 'ownership proof', mx: 'inbound MX', spf: 'SPF', dmarc: 'DMARC' }

console.log(`\n${DOMAIN} — status: ${domain.status.toUpperCase()}\n`)
let missingRequired = 0
for (const r of domain.dns_records ?? []) {
  const ok = r.status === 'verified' || r.status === 'ok'
  if (!ok && r.required) missingRequired += 1
  const mark = ok ? 'OK     ' : r.required ? 'MISSING' : 'missing'
  console.log(`  ${mark}  ${(PURPOSE[r.purpose] ?? r.purpose).padEnd(17)} ${r.record_type.padEnd(4)} ${r.host}`)
  if (!ok && r.actual_value) console.log(`           found instead: ${String(r.actual_value).slice(0, 70)}`)
}

if (domain.status === 'verified') {
  console.log('\nVerified. Set TELNYX_EMAIL_FROM to something@' + DOMAIN + ' and any recipient will work.')
} else {
  console.log(
    `\n${missingRequired} required record(s) still not visible to Telnyx.` +
      '\nDNS usually propagates in minutes, occasionally an hour. Re-run this when you have waited.',
  )
}

if (process.argv.includes('--send')) {
  if (domain.status !== 'verified') {
    console.log('\nNot sending: the domain is not verified yet.')
    process.exit(0)
  }
  const to = env.DEMO_EMAIL
  const from = `sol@${DOMAIN}`
  const r = await fetch('https://api.telnyx.com/v2/email_messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [to],
      subject: 'Solstice Hotel Group — sending domain verified',
      text_body: `This came from ${from}, so any recipient now works.`,
      html_body: `<p>This came from <strong>${from}</strong>, so any recipient now works.</p>`,
    }),
  })
  const out = await r.json()
  if (out.errors) console.log(`\nSend failed: ${out.errors[0]?.detail}`)
  else console.log(`\nTest email sent from ${from} to ${to}.`)
}
