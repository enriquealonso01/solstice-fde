// Captures REAL conversations against the deployed /api/chat and writes them to transcripts/.
// These are evidence, not illustrations: every tool call and latency below actually happened.
//   node scripts/capture-transcripts.mjs [--base https://...] [--only slug]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
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

const argv = process.argv.slice(2)
const argOf = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : null
}
// Which site these captures are evidence ABOUT. No default host.
//
// This ended in `|| 'https://solstice-hotel-group.netlify.app'`. That host is the right one, so nothing
// ever broke -- but the transcripts in transcripts/ are evidence in the submission, and "captured from
// production" has to be a fact rather than a guess. With a default, an operator whose PUBLIC_BASE_URL is
// missing or pointing at a draft deploy gets files that look identical and describe a different system.
// Iteration 114 removed the same pattern from provision.mjs, where the literal was a host that 404s.
const BASE = argOf('--base') || env.PUBLIC_BASE_URL
if (!BASE) {
  throw new Error(
    'No base URL. Set PUBLIC_BASE_URL in .env (see .env.example) or pass --base https://your-site. ' +
      'These captures are evidence about a specific deploy, so the target is not something to assume.',
  )
}
const ONLY = argOf('--only')

const SCENARIOS = [
  {
    slug: 'platinum-late-checkout',
    title: 'Platinum guest asks for a late checkout',
    shows: 'Identity verification before acting, tier benefits read from policy, availability checked rather than assumed.',
    turns: [
      'Hi, I have a stay coming up in Denver. Confirmation R55004, last name Chen.',
      'Great. Can I keep the room until 2pm on checkout day?',
    ],
  },
  {
    slug: 'service-animal',
    title: 'Pets versus service animals',
    shows: 'Policy 8 encoded precisely, including the ADA limits on what staff may ask. A generic assistant gets this wrong.',
    turns: ['Do your hotels allow dogs? I travel with a service animal.'],
  },
  {
    slug: 'parking-rate-refusal',
    title: 'Agent refuses to quote a number it does not have',
    shows: 'Policy 12 says there is no chain-wide parking rate. The agent declines to invent one instead of guessing plausibly.',
    turns: ['How much is parking per night at your Chicago Riverwalk hotel?'],
  },
  {
    slug: 'refund-outside-window',
    title: 'Cancellation charge upheld, with a handoff that carries the context',
    shows: 'Honest refusal, no false promise, and an escalation that carries full context rather than a dead end.',
    turns: [
      'This is Denise Franklin, reservation R55005. I cancelled my Nashville stay and was charged a night. I want a full refund.',
      'I understand, but I think that is unfair. What can you actually do for me?',
    ],
  },
]

async function streamTurn(sessionId, message) {
  const started = Date.now()
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sessionId ? { session_id: sessionId, message } : { message }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)

  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let text = ''
  const tools = []
  let done = null
  let sid = sessionId

  for (;;) {
    const { value, done: fin } = await reader.read()
    if (fin) break
    buf += dec.decode(value, { stream: true })
    const frames = buf.split(/\r?\n\r?\n/)
    buf = frames.pop() ?? ''
    for (const frame of frames) {
      const ev = /^event:\s*(.+)$/m.exec(frame)?.[1]?.trim()
      const dataLines = [...frame.matchAll(/^data:\s?(.*)$/gm)].map((m) => m[1])
      if (!ev || !dataLines.length) continue
      let payload
      try {
        payload = JSON.parse(dataLines.join('\n'))
      } catch {
        continue
      }
      if (ev === 'session') sid = payload.session_id
      else if (ev === 'delta') text += payload.text ?? ''
      else if (ev === 'tool') {
        if (payload.status === 'done') {
          const open = tools.find((t) => t.name === payload.name && !t.resolved)
          if (open) Object.assign(open, { resolved: true, summary: payload.summary, citations: payload.citations })
          else tools.push({ ...payload, resolved: true })
        } else tools.push({ ...payload, resolved: false })
      } else if (ev === 'done') done = payload
      else if (ev === 'error') throw new Error(payload.message ?? 'stream error')
    }
  }
  return { sid, text, tools, done, wall_ms: Date.now() - started }
}

function render(scn, runs) {
  const L = []
  L.push(`# ${scn.title}`, '')
  L.push(`**What this shows:** ${scn.shows}`, '')
  L.push(`Captured from the deployed system at ${BASE} on ${new Date().toISOString().slice(0, 10)}.`)
  L.push('Every tool call and timing below is real.', '')
  L.push('---', '')
  for (const r of runs) {
    L.push(`**Guest:** ${r.prompt}`, '')
    if (r.tools.length) {
      L.push('<sub>Sol used:</sub>', '')
      for (const t of r.tools) {
        const cites = (t.citations ?? []).map((c) => c.label ?? c.ref).filter(Boolean)
        L.push(`- \`${t.name}\`${t.summary ? ` — ${t.summary}` : ''}${cites.length ? ` _(cites: ${cites.join('; ')})_` : ''}`)
      }
      L.push('')
    }
    L.push(`**Sol:** ${r.text.trim()}`, '')
    if (r.done) {
      const bits = []
      if (r.done.first_token_ms != null) bits.push(`first token ${r.done.first_token_ms}ms`)
      if (r.done.latency_ms != null) bits.push(`turn ${r.done.latency_ms}ms`)
      if (bits.length) L.push(`<sub>${bits.join(' · ')}</sub>`, '')
    }
    L.push('---', '')
  }
  return L.join('\n')
}

mkdirSync(resolve(root, 'transcripts'), { recursive: true })
const picked = ONLY ? SCENARIOS.filter((s) => s.slug === ONLY) : SCENARIOS
console.log(`Capturing ${picked.length} conversation(s) against ${BASE}\n`)

for (const scn of picked) {
  console.log(`  ${scn.slug}`)
  let sid = null
  const runs = []
  try {
    for (const prompt of scn.turns) {
      const r = await streamTurn(sid, prompt)
      sid = r.sid
      runs.push({ prompt, ...r })
      console.log(`    turn ok — ${r.tools.length} tool(s), ${r.done?.first_token_ms ?? '?'}ms to first token`)
    }
    writeFileSync(resolve(root, 'transcripts', `${scn.slug}.md`), render(scn, runs))
  } catch (err) {
    console.log(`    FAILED: ${err.message}`)
  }
}
console.log('\nWritten to transcripts/')
