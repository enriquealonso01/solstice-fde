// Side chat scoped to one inquiry.
//
// The rep talks to the same agent the guest did, except the inquiry id is bound into
// the context, so "drop it to 15 and resend" is unambiguous. Posts to
// POST /api/group/assistant { inquiry_id, message }.
//
// Until that endpoint exists, a small local responder keeps the surface demonstrable
// and labels every reply it produced as simulated. It never pretends to have acted.

import { useState, type FormEvent } from 'react'
import Markdown from './Markdown'
import { isMissingBackend, postJson, useStickToBottom } from './useAdminData'
import type { InquiryRow, ProposalRow } from './mockData'
import { money, verdictSeverity } from './mockData'

export interface AssistantReply {
  reply: string
  /** Optional structured follow-ups the endpoint suggests; rendered as chips. */
  suggestions?: string[]
}

interface Turn {
  id: string
  role: 'rep' | 'assistant'
  text: string
  simulated?: boolean
  refused?: boolean
}

const QUICK_PROMPTS = [
  'Explain the flags in plain English',
  'Re-price this at the compliant discount',
  'Draft a shorter version of the proposal',
  'What would it take to say yes?',
]

export default function InquiryAssistant({
  inquiry,
  proposal,
}: {
  inquiry: InquiryRow
  proposal: ProposalRow | null
}) {
  const [turns, setTurns] = useState<Turn[]>([
    {
      id: 'seed',
      role: 'assistant',
      text: `I have ${inquiry.inquiry_code} open: ${inquiry.payload.company_name} at ${inquiry.payload.property_name}. Ask me to modify it, explain a verdict, resend it or delete it.`,
    },
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>(QUICK_PROMPTS)
  const listRef = useStickToBottom<HTMLDivElement>(turns.length)

  async function send(text: string) {
    const clean = text.trim()
    if (!clean || busy) return
    setInput('')
    setBusy(true)
    setTurns((t) => [...t, { id: `rep-${Date.now()}`, role: 'rep', text: clean }])

    const res = await postJson<AssistantReply>('/api/group/assistant', {
      // The tool layer speaks in INQ-2001. Reading live from Postgres gives us a uuid primary key,
      // so send the code when we have it; the backend tolerates either.
      inquiry_id: inquiry.inquiry_code ?? inquiry.id,
      message: clean,
    })

    if (res.ok && res.data?.reply) {
      setTurns((t) => [...t, { id: `a-${Date.now()}`, role: 'assistant', text: res.data!.reply }])
      if (res.data.suggestions?.length) setSuggestions(res.data.suggestions)
    } else if (isMissingBackend(res.failure)) {
      setTurns((t) => [
        ...t,
        { id: `a-${Date.now()}`, role: 'assistant', text: simulate(clean, inquiry, proposal), simulated: true },
      ])
    } else {
      // The endpoint is live and refused us. Say so rather than answering locally and
      // letting the rep believe they are talking to the real assistant.
      setTurns((t) => [
        ...t,
        { id: `a-${Date.now()}`, role: 'assistant', text: res.error ?? 'The assistant is unavailable.', refused: true },
      ])
    }
    setBusy(false)
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    void send(input)
  }

  return (
    // Bounded and sticky on purpose: h-full inside a tall grid column let the panel grow with the
    // page, which pushed the composer below the fold and made the rep scroll to reach Send.
    <div className="panel sticky top-4 flex h-[calc(100vh-7rem)] max-h-[46rem] min-h-[26rem] flex-col">
      <header className="panel-header flex items-center justify-between gap-2">
        <span>Assistant · {inquiry.inquiry_code}</span>
        <span className="chip bg-solstice-ember/10 text-solstice-ember">scoped to this inquiry</span>
      </header>

      {/* overscroll-contain stops the page behind from taking over the wheel once this list
          hits its end, which made the panel feel like it was leaking scroll. */}
      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto overscroll-contain p-4">
        {turns.map((t) => (
          <div key={t.id} className={t.role === 'rep' ? 'flex justify-end' : ''}>
            <div
              className={`sol-rise max-w-[92%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
                t.role === 'rep'
                  ? 'bg-solstice-ink text-white'
                  : t.refused
                    ? 'border border-rose-200 bg-rose-50 text-rose-900'
                    : 'border border-solstice-sand bg-solstice-cream text-solstice-ink'
              }`}
            >
              {t.role === 'rep' ? (
                <p className="whitespace-pre-wrap">{t.text}</p>
              ) : (
                <Markdown text={t.text} />
              )}
              {t.simulated ? (
                <p className="mt-1.5 text-[11px] text-solstice-stone">
                  Simulated locally. <code>/api/group/assistant</code> is not deployed yet.
                </p>
              ) : null}
            </div>
          </div>
        ))}
        {busy ? (
          <div className="flex items-center gap-1 pl-1 text-solstice-stone">
            <span className="sol-dot h-1.5 w-1.5 rounded-full bg-solstice-stone" />
            <span className="sol-dot h-1.5 w-1.5 rounded-full bg-solstice-stone" style={{ animationDelay: '150ms' }} />
            <span className="sol-dot h-1.5 w-1.5 rounded-full bg-solstice-stone" style={{ animationDelay: '300ms' }} />
          </div>
        ) : null}
      </div>

      <div className="border-t border-solstice-sand p-3">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {suggestions.slice(0, 4).map((s) => (
            <button
              key={s}
              type="button"
              disabled={busy}
              onClick={() => void send(s)}
              className="chip border border-solstice-sand bg-white text-solstice-slate transition hover:bg-solstice-sand/40 disabled:opacity-40"
            >
              {s}
            </button>
          ))}
        </div>
        <form onSubmit={onSubmit} className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Modify, explain, resend or delete this inquiry…"
            className="min-w-0 flex-1 rounded-md border border-solstice-sand bg-white px-3 py-2 text-sm outline-none transition focus:border-solstice-ember focus:ring-1 focus:ring-solstice-ember"
          />
          <button type="submit" className="btn-primary" disabled={busy || !input.trim()}>
            Send
          </button>
        </form>
      </div>
    </div>
  )
}

/**
 * Local stand-in for the real endpoint. Answers only from data already on screen, and
 * says what it would do rather than claiming to have done it. That is the same rule the
 * production agent follows: never assert an action it did not take.
 */
function simulate(message: string, inquiry: InquiryRow, proposal: ProposalRow | null): string {
  const m = message.toLowerCase()
  const p = inquiry.payload

  if (!proposal) {
    return `There is no proposal on ${inquiry.inquiry_code} yet, because ${inquiry.missing_fields.length} field(s) are still missing: ${inquiry.missing_fields.join(', ')}. I can draft the clarifying questions for ${p.contact_name} if you want to send those first.`
  }

  const severity = verdictSeverity(proposal.verdicts)
  const flagged = proposal.verdicts.filter((v) => v.status !== 'pass')

  if (m.includes('explain') || m.includes('flag') || m.includes('why')) {
    if (flagged.length === 0) {
      return `Nothing is flagged on ${inquiry.inquiry_code}. Every rule passed, the contact has an email on file, and it is ready to send.`
    }
    return `${flagged.length} thing(s) need you on ${inquiry.inquiry_code}:\n\n${flagged
      .map((v) => `• ${v.rule_id}: ${v.human_reason}`)
      .join('\n')}`
  }

  if (m.includes('price') || m.includes('discount') || m.includes('re-price') || m.includes('reprice')) {
    const requested = proposal.pricing.requested_discount_pct
    return `Right now it is priced at ${proposal.pricing.discount_pct}%, total ${money(proposal.pricing.total_cents)}.${
      requested !== undefined && requested !== proposal.pricing.discount_pct
        ? ` They asked for ${requested}%, which is over what the property auto-approves, so the difference needs an approval with a justification before I regenerate.`
        : ' That is already the compliant number, so there is nothing for me to move without an override.'
    }`
  }

  if (m.includes('send') || m.includes('resend')) {
    if (severity !== 'clear' && proposal.status !== 'approved') {
      return `I will not send ${inquiry.inquiry_code} while it is flagged. Approve or override it first, with a justification, and then the send button unlocks.`
    }
    const channel = p.contact_email ? `email to ${p.contact_email}` : p.contact_phone ? `SMS to ${p.contact_phone}, with a link to the hosted PDF` : 'no channel, because there is neither an email nor a phone number'
    return `Ready. Delivery would go out as ${channel}. Use "Accept and send" so the action is written to the audit log under your name rather than mine.`
  }

  if (m.includes('delete') || m.includes('remove')) {
    return `Deleting ${inquiry.inquiry_code} removes the inquiry, its proposal and the generated PDF. I cannot do that from the side chat; use Reject if you want it closed with a reason kept on the record.`
  }

  if (m.includes('shorter') || m.includes('draft') || m.includes('rewrite')) {
    return `I can tighten the proposal copy to three lines: the hold, the rate, and the reply-by date. It would still carry the ${proposal.pricing.discount_pct}% discount and the ${money(proposal.pricing.total_cents)} total, because those come from the pricing record, not from the copy.`
  }

  if (m.includes('yes') || m.includes('what would it take')) {
    if (flagged.length === 0) return `Nothing. ${inquiry.inquiry_code} is inside every rule and can go out as it stands.`
    return `To get to yes on ${inquiry.inquiry_code}: ${flagged
      .map((v) => `${v.rule_id} needs ${v.threshold} and you have ${v.actual}`)
      .join('; ')}. Each one is either an override with a justification or a change to the request.`
  }

  return `I have ${inquiry.inquiry_code} in front of me: ${p.rooms_requested ?? 'an unspecified number of'} rooms at ${p.property_name}, currently ${proposal.status.replace(/_/g, ' ')} at ${money(proposal.pricing.total_cents)}. Ask me to explain a verdict, re-price it, redraft the proposal, or tell you what it would take to approve.`
}
