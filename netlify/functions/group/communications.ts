// The conversation thread for one enquiry: everything we have said to this customer and
// everything they have said to us, in the order it happened.
//
// It is assembled rather than stored, from the three places the record actually lives:
//   - `proposals`  what we quoted, and when it went out
//   - `follow_ups` what we asked for, and when that went out
//   - `sessions` + `messages`  the call or chat the enquiry came from, which is how the thread
//     explains where a voice-created enquiry appeared from rather than leaving a mystery row
//
// DEMO_MODE honesty. The thread shows the CUSTOMER's own address as the recipient, because that
// is who the proposal is addressed to and a screen that said "enrique@..." would be lying about
// the booking. The redirect is carried separately in `demo_redirect_to`, so the screen can say
// "sent to b***@harlowvance.com, redirected to the demo inbox for this run" and both halves are
// true.

import { tryGetDb } from '../_lib/db'
import { recentAudit } from '../_delivery/audit'
import { readDeliveryEnv } from '../_delivery/config'
import { loadInquiry, loadInquiryContact } from './_deps'
import { listFollowUps } from './followUps'
import { listProposals } from './store'

export type CommunicationDirection = 'outbound' | 'inbound'
export type CommunicationChannel = 'email' | 'sms' | 'voice'

export interface CommunicationItem {
  id: string
  direction: CommunicationDirection
  channel: CommunicationChannel
  subject: string | null
  preview: string
  body: string
  status: string
  occurred_at: string
  actor: string | null
  /** Masked customer contact this was addressed to. Null on inbound items. */
  recipient?: string | null
  /** Set only when DEMO_MODE rerouted the actual send. The UI shows this beside the recipient. */
  demo_redirect_to?: string | null
}

function preview(text: string, length = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= length ? flat : `${flat.slice(0, length - 1)}…`
}

/** Accepts `INQ-2001` or the row uuid, because the UI has whichever it happens to hold. */
async function resolveInquiryCode(idOrUuid: string): Promise<string | null> {
  if (/^INQ-/i.test(idOrUuid)) return idOrUuid.toUpperCase()
  const db = tryGetDb()
  if (!db) return null
  const { data, error } = await db
    .from('inquiries')
    .select('inquiry_code')
    .eq('id', idOrUuid)
    .limit(1)
  if (error || !data?.[0]) return null
  return (data[0] as { inquiry_code: string }).inquiry_code
}

/** The voice call or chat an enquiry was created from, so the thread starts where the customer
 *  actually started. Best effort: no session is a normal outcome for a portal enquiry. */
async function inboundFromSession(inquiryCode: string): Promise<CommunicationItem[]> {
  const db = tryGetDb()
  if (!db) return []

  // `inquiry.created` audit rows carry the call that created them.
  const created = recentAudit(200, 'inquiry.created').find(
    (e) => e.subject === `inquiry:${inquiryCode}`,
  )
  const callControlId = created?.detail?.call_control_id
  if (typeof callControlId !== 'string' || !callControlId) return []

  try {
    const sessions = await db
      .from('sessions')
      .select('id, channel, guest_label, phone_masked, started_at')
      .eq('call_control_id', callControlId)
      .limit(1)
    const session = sessions.data?.[0] as
      | { id: string; channel: string; guest_label: string | null; phone_masked: string | null; started_at: string }
      | undefined
    if (!session) return []

    const messages = await db
      .from('messages')
      .select('id, role, content, created_at')
      .eq('session_id', session.id)
      .order('created_at', { ascending: true })
      .limit(50)

    const rows = (messages.data ?? []) as {
      id: string
      role: string
      content: string
      created_at: string
    }[]
    const guestTurns = rows.filter((m) => m.role === 'user')
    const transcript = rows.map((m) => `${m.role === 'user' ? 'Guest' : 'Sol'}: ${m.content}`).join('\n')

    return [
      {
        id: `session:${session.id}`,
        direction: 'inbound',
        channel: session.channel === 'chat' ? 'sms' : 'voice',
        subject: 'Enquiry taken over the phone',
        preview: guestTurns[0]
          ? preview(guestTurns[0].content)
          : 'The customer called in and Sol opened this enquiry from the conversation.',
        body: transcript || 'The customer called in and Sol opened this enquiry from the conversation.',
        status: 'received',
        occurred_at: session.started_at,
        actor: session.guest_label ?? null,
        recipient: null,
      },
    ]
  } catch {
    return []
  }
}

export interface CommunicationsResult {
  inquiry_id: string | null
  items: CommunicationItem[]
  demo_mode: boolean
}

/** Newest LAST, which is how a thread reads. Never 404: an enquiry nobody has written to yet
 *  has an empty thread, not a missing one. */
export async function getCommunications(inquiryIdOrUuid: string): Promise<CommunicationsResult> {
  const env = readDeliveryEnv()
  const code = await resolveInquiryCode(inquiryIdOrUuid)
  if (!code) return { inquiry_id: null, items: [], demo_mode: env.demo_mode }

  const inquiry = await loadInquiry(code)
  const contact = await loadInquiryContact(code)
  const items: CommunicationItem[] = []

  items.push(...(await inboundFromSession(code)))

  // ---- proposals we have sent
  for (const proposal of await listProposals()) {
    if (proposal.inquiry_id !== code || !proposal.sent_at) continue
    const channel: CommunicationChannel = proposal.sent_via === 'sms' ? 'sms' : 'email'
    const recipient =
      channel === 'sms' ? (contact?.phone_masked ?? null) : (contact?.email_masked ?? null)
    items.push({
      id: `proposal:${proposal.proposal_id}`,
      direction: 'outbound',
      channel,
      subject: `Group proposal ${proposal.proposal_id} for ${inquiry?.company_name ?? code}`,
      preview: `Proposal ${proposal.proposal_id}: ${proposal.pricing.line_items[0]?.rooms ?? 0} rooms, ${(proposal.pricing.total_cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} total at ${proposal.pricing.discount_pct}% off.`,
      body: proposal.pdf_url
        ? `The full proposal was sent, with the PDF at ${proposal.pdf_url}`
        : 'The full proposal was sent in the body of the message.',
      status: 'sent',
      occurred_at: proposal.sent_at,
      actor: proposal.approved_by ?? null,
      recipient,
      // The screen tells the truth about both: who it was for, and where it actually landed.
      demo_redirect_to: env.demo_mode
        ? (channel === 'sms' ? env.demo_phone : env.demo_email) ?? null
        : null,
    })
  }

  // ---- follow-ups we have sent
  for (const followUp of await listFollowUps()) {
    if (followUp.inquiry_id !== code || !followUp.sent_at) continue
    const channel: CommunicationChannel = followUp.channel === 'sms' ? 'sms' : 'email'
    items.push({
      id: `follow_up:${followUp.follow_up_id}`,
      direction: 'outbound',
      channel,
      subject: followUp.subject,
      preview: preview(followUp.body),
      body: followUp.body,
      status: 'sent',
      occurred_at: followUp.sent_at,
      actor: followUp.approved_by ?? null,
      recipient:
        channel === 'sms' ? (contact?.phone_masked ?? null) : (contact?.email_masked ?? null),
      demo_redirect_to: env.demo_mode
        ? (channel === 'sms' ? env.demo_phone : env.demo_email) ?? null
        : null,
    })
  }

  items.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
  return { inquiry_id: code, items, demo_mode: env.demo_mode }
}

/** What the side chat is handed when a rep asks "what have we sent this customer?" or
 *  "have we already followed up?". Short, so it fits in a prompt without crowding it out. */
export async function communicationsSummary(inquiryCode: string): Promise<{
  count: number
  last_contacted_at: string | null
  items: { what: string; channel: string; when: string; to: string | null }[]
}> {
  const { items } = await getCommunications(inquiryCode)
  const outbound = items.filter((i) => i.direction === 'outbound')
  return {
    count: items.length,
    last_contacted_at: outbound[outbound.length - 1]?.occurred_at ?? null,
    items: items.map((i) => ({
      what: i.subject ?? i.preview,
      channel: `${i.direction} ${i.channel}`,
      when: i.occurred_at,
      to: i.recipient ?? null,
    })),
  }
}
