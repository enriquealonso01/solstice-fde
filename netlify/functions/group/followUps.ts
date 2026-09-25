// Follow-ups: the message we send when an inquiry cannot be quoted yet.
//
// INQ-2004 is the case this exists for. No dates, no phone, and "around 25" rooms, which is not
// a number we can hold inventory against. The wrong answers are to quote anyway, or to leave it
// sitting in the inbox. The right answer is a short message asking for exactly the fields that
// are missing, drafted by the system, read by a person, approved, then sent.
//
// It gets the same discipline as a proposal because it is the same act: something going to a
// customer with the hotel's name on it.
//   - persisted in `follow_ups`, so it survives a cold start
//   - routed by the same rule as a proposal: email present -> email, phone only -> SMS,
//     neither -> needs_human and nothing is sent
//   - approve and send both write audit_log
//   - DEMO_MODE redirects the send exactly as it does for a proposal
//
// The body is assembled from `assessCompleteness`, which returns one question per field that is
// actually absent. It names nothing else. There is no deadline and no policy in it, because we
// have no basis for either: the hotel never told us how long it will hold anything for an
// inquiry it has not priced.

import { randomBytes } from 'node:crypto'
import { assessCompleteness, describeMissing } from '../../../src/lib/rules'
import { tryGetDb } from '../_lib/db'
import { deliver } from '../_delivery'
import { auditLog, describeError } from '../_delivery/audit'
import { routeFor, type Route } from '../_delivery/config'
import { loadInquiry, loadInquiryContact, loadInquiryContext } from './_deps'
import { resolveInquiryRowId } from './store'
import { endSentence } from '../../../shared/text'

export type FollowUpStatus = 'draft' | 'approved' | 'sent' | 'discarded' | 'needs_human'
export type FollowUpChannel = 'email' | 'sms' | 'needs_human'

export interface FollowUp {
  follow_up_id: string
  row_id: string | null
  inquiry_id: string
  inquiry_row_id: string | null
  channel: FollowUpChannel
  subject: string | null
  body: string
  missing_fields: string[]
  status: FollowUpStatus
  approved_by: string | null
  approved_at: string | null
  sent_to: string | null
  sent_at: string | null
  created_at: string
  /** False means this exists only in one server's memory. Same honesty rule as proposals. */
  persisted: boolean
}

/** Cache in front of the table, and the whole store when Supabase is unconfigured. */
const memory = new Map<string, FollowUp>()

export function resetFollowUpStore(): void {
  memory.clear()
}

function newCode(inquiryCode: string): string {
  return `FUP-${inquiryCode.replace(/^INQ-/i, '')}-${randomBytes(3).toString('hex')}`
}

// ---------------------------------------------------------------- composing

/** SMS has to fit on a phone screen and cannot carry a numbered list comfortably, so the two
 *  channels get genuinely different wording rather than the same text truncated. */
export function composeFollowUp(input: {
  channel: FollowUpChannel
  contact_name: string
  company_name: string
  questions: string[]
  missing_summary: string
}): { subject: string | null; body: string } {
  const { contact_name, company_name, questions, missing_summary } = input

  if (input.channel === 'sms') {
    const greeting = contact_name ? `Hi ${contact_name.split(' ')[0]}, ` : 'Hi, '
    return {
      subject: null,
      body: `${endSentence(`${greeting}this is Sol at Solstice Hotels about your group inquiry for ${company_name}`)} Before I can put a quote together I need your ${missing_summary}. Reply here with those and I will come straight back with the rate and the block.`,
    }
  }

  const numbered = questions.map((q, i) => `${i + 1}. ${q}`).join('\n')
  return {
    subject: `A couple of quick questions about your group inquiry for ${company_name}`,
    body: [
      `Hello ${contact_name || 'there'},`,
      '',
      `${endSentence(`Thank you for getting in touch about ${company_name}`)} I would love to put a proposal together for you, and there are just a few things I need before I can quote properly and hold the rooms:`,
      '',
      numbered,
      '',
      'As soon as I have those I will come straight back with the rate and the block.',
      '',
      'With best wishes,',
      'Sol',
      'Solstice Group Sales',
    ].join('\n'),
  }
}

// ---------------------------------------------------------------- persistence

interface FollowUpRow {
  id: string
  inquiry_id: string
  follow_up_code: string
  channel: FollowUpChannel
  subject: string | null
  body: string
  missing_fields: string[]
  status: FollowUpStatus
  approved_by: string | null
  approved_at: string | null
  sent_to: string | null
  sent_at: string | null
  created_at: string
}

function fromRow(row: FollowUpRow, inquiryCode: string): FollowUp {
  return {
    follow_up_id: row.follow_up_code,
    row_id: row.id,
    inquiry_id: inquiryCode,
    inquiry_row_id: row.inquiry_id,
    channel: row.channel,
    subject: row.subject,
    body: row.body,
    missing_fields: row.missing_fields ?? [],
    status: row.status,
    approved_by: row.approved_by,
    approved_at: row.approved_at,
    sent_to: row.sent_to,
    sent_at: row.sent_at,
    created_at: row.created_at,
    persisted: true,
  }
}

async function inquiryCodesByRowId(): Promise<Map<string, string>> {
  const db = tryGetDb()
  const out = new Map<string, string>()
  if (!db) return out
  const { data, error } = await db.from('inquiries').select('id, inquiry_code')
  if (error || !data) return out
  for (const row of data as { id: string; inquiry_code: string }[]) out.set(row.id, row.inquiry_code)
  return out
}

export async function listFollowUps(): Promise<FollowUp[]> {
  const db = tryGetDb()
  if (!db) return [...memory.values()].sort((a, b) => b.created_at.localeCompare(a.created_at))

  const { data, error } = await db
    .from('follow_ups')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) {
    console.warn(`[solstice] follow_ups read failed, falling back to memory: ${error.message}`)
    return [...memory.values()]
  }
  const codes = await inquiryCodesByRowId()
  const rows = (data as FollowUpRow[]).map((row) =>
    fromRow(row, codes.get(row.inquiry_id) ?? row.inquiry_id),
  )
  for (const row of rows) memory.set(row.follow_up_id, row)
  return rows
}

export async function getFollowUp(code: string): Promise<FollowUp | null> {
  if (!code) return null
  const all = await listFollowUps()
  return all.find((f) => f.follow_up_id === code || f.row_id === code) ?? memory.get(code) ?? null
}

/** The live follow-up on an inquiry: the most recent one nobody has sent or discarded. */
export async function findFollowUpByInquiry(inquiryCode: string): Promise<FollowUp | null> {
  const all = await listFollowUps()
  const mine = all.filter((f) => f.inquiry_id === inquiryCode)
  return mine.find((f) => f.status === 'draft' || f.status === 'approved') ?? mine[0] ?? null
}

async function persist(followUp: FollowUp): Promise<void> {
  const db = tryGetDb()
  if (!db) {
    followUp.persisted = false
    memory.set(followUp.follow_up_id, followUp)
    return
  }
  if (!followUp.inquiry_row_id) {
    followUp.inquiry_row_id = await resolveInquiryRowId(followUp.inquiry_id)
  }
  if (!followUp.inquiry_row_id) {
    followUp.persisted = false
    memory.set(followUp.follow_up_id, followUp)
    await auditLog('follow_up.persist_failed', `follow_up:${followUp.follow_up_id}`, {
      inquiry_id: followUp.inquiry_id,
      error: `No row in \`inquiries\` has inquiry_code ${followUp.inquiry_id}. Run scripts/data/seed.mjs.`,
    })
    return
  }

  const payload = {
    inquiry_id: followUp.inquiry_row_id,
    follow_up_code: followUp.follow_up_id,
    channel: followUp.channel,
    subject: followUp.subject,
    body: followUp.body,
    missing_fields: followUp.missing_fields,
    status: followUp.status,
    approved_by: followUp.approved_by,
    approved_at: followUp.approved_at,
    sent_to: followUp.sent_to,
    sent_at: followUp.sent_at,
    updated_at: new Date().toISOString(),
  }

  try {
    if (followUp.row_id) {
      const { error } = await db.from('follow_ups').update(payload).eq('id', followUp.row_id)
      if (error) throw new Error(error.message)
    } else {
      const { data, error } = await db.from('follow_ups').insert(payload).select('id, created_at')
      if (error) throw new Error(error.message)
      const row = (data?.[0] as { id: string; created_at: string } | undefined) ?? null
      if (row) {
        followUp.row_id = row.id
        followUp.created_at = row.created_at
      }
    }
    followUp.persisted = true
  } catch (err) {
    followUp.persisted = false
    await auditLog('follow_up.persist_failed', `follow_up:${followUp.follow_up_id}`, {
      inquiry_id: followUp.inquiry_id,
      error: describeError(err),
    })
  }
  memory.set(followUp.follow_up_id, followUp)
}

export function durabilityNote(followUp: FollowUp): string {
  return followUp.persisted
    ? ''
    : ' Note that this follow-up is only held in memory on this server, because the database is not reachable, so it will disappear if the process restarts.'
}

// ---------------------------------------------------------------- draft

export interface DraftFollowUpResult {
  ok: boolean
  error?: string
  follow_up?: FollowUp
  human_summary?: string
}

/** Idempotent per inquiry, like a proposal: a rep clicking twice edits one draft. */
export async function draftFollowUp(inquiryCode: string): Promise<DraftFollowUpResult> {
  const inquiry = await loadInquiry(inquiryCode)
  if (!inquiry) {
    return { ok: false, error: `We have no record of an inquiry with the reference ${inquiryCode}.` }
  }

  const contact = await loadInquiryContact(inquiryCode)
  const context = await loadInquiryContext(inquiryCode)
  const completeness = assessCompleteness(
    inquiry,
    { rooms_requested: context?.raw_rooms },
    {
      contact_present: Boolean(
        contact?.email || contact?.phone || contact?.email_masked || contact?.phone_masked,
      ),
    },
  )

  const missing = [...completeness.blocking_missing, ...completeness.advisory_missing]
  if (missing.length === 0) {
    return {
      ok: false,
      error: `Inquiry ${inquiryCode} has everything we need on it, so there is nothing to ask for. Generate the proposal instead.`,
    }
  }

  const route: Route = routeFor({ email: contact?.email, phone: contact?.phone })
  const channel: FollowUpChannel = route === 'human' ? 'needs_human' : route
  const { subject, body } = composeFollowUp({
    channel,
    contact_name: inquiry.contact_name,
    company_name: inquiry.company_name,
    questions: completeness.questions,
    missing_summary: describeMissing(missing),
  })

  const existing = await findFollowUpByInquiry(inquiryCode)
  const reusable = existing && (existing.status === 'draft' || existing.status === 'approved') ? existing : null

  const followUp: FollowUp = {
    follow_up_id: reusable?.follow_up_id ?? newCode(inquiryCode),
    row_id: reusable?.row_id ?? null,
    inquiry_id: inquiryCode,
    inquiry_row_id: reusable?.inquiry_row_id ?? null,
    channel,
    subject,
    body,
    missing_fields: missing,
    // A redraft goes back to draft: an approval was for the words that were approved.
    status: channel === 'needs_human' ? 'needs_human' : 'draft',
    approved_by: null,
    approved_at: null,
    sent_to: null,
    sent_at: null,
    created_at: reusable?.created_at ?? new Date().toISOString(),
    persisted: false,
  }

  await persist(followUp)
  await auditLog('follow_up.drafted', `follow_up:${followUp.follow_up_id}`, {
    inquiry_id: inquiryCode,
    channel,
    missing_fields: missing,
    replaced_existing: Boolean(reusable),
    persisted: followUp.persisted,
  })

  return {
    ok: true,
    follow_up: followUp,
    human_summary:
      channel === 'needs_human'
        ? `We have drafted the questions for ${inquiry.company_name}, but this inquiry has neither an email address nor a phone number on it, so there is nowhere to send them. Somebody needs to find a contact detail first.${durabilityNote(followUp)}`
        : `Follow-up ${followUp.follow_up_id} is drafted, asking for the ${describeMissing(missing)}. It goes by ${channel === 'sms' ? 'text message' : 'email'} once somebody approves it.${durabilityNote(followUp)}`,
  }
}

// ---------------------------------------------------------------- actions

export type FollowUpAction = 'approve' | 'send' | 'discard'

export interface FollowUpActionResult {
  ok: boolean
  status?: FollowUpStatus
  follow_up_id?: string
  error?: string
  human_summary?: string
}

export async function actOnFollowUp(args: {
  follow_up_id: string
  action: FollowUpAction
  actor: string
  edited_body?: string
  justification?: string | null
}): Promise<FollowUpActionResult> {
  const followUp = await getFollowUp(args.follow_up_id)
  if (!followUp) {
    return { ok: false, error: `We have no record of a follow-up with the reference ${args.follow_up_id}.` }
  }

  if (followUp.status === 'sent') {
    return {
      ok: false,
      status: followUp.status,
      follow_up_id: followUp.follow_up_id,
      error: `Follow-up ${followUp.follow_up_id} has already gone to the customer. Draft a new one rather than sending this one again.`,
    }
  }
  if (followUp.status === 'discarded') {
    return {
      ok: false,
      status: followUp.status,
      follow_up_id: followUp.follow_up_id,
      error: `Follow-up ${followUp.follow_up_id} was discarded. Draft a new one if the inquiry still needs chasing.`,
    }
  }

  // A rep's own words replace ours, on either action, and the edit is audited with them.
  const edited = args.edited_body?.trim()
  if (edited && edited !== followUp.body) {
    const previous = followUp.body
    followUp.body = edited
    await auditLog('follow_up.edited', `follow_up:${followUp.follow_up_id}`, {
      inquiry_id: followUp.inquiry_id,
      actor: args.actor,
      justification: args.justification ?? null,
      previous_length: previous.length,
      new_length: edited.length,
    })
  }

  switch (args.action) {
    case 'discard': {
      followUp.status = 'discarded'
      await persist(followUp)
      await auditLog('follow_up.discarded', `follow_up:${followUp.follow_up_id}`, {
        inquiry_id: followUp.inquiry_id,
        actor: args.actor,
        justification: args.justification ?? null,
        persisted: followUp.persisted,
      })
      return {
        ok: true,
        status: followUp.status,
        follow_up_id: followUp.follow_up_id,
        human_summary: `Follow-up ${followUp.follow_up_id} was discarded and will not be sent.`,
      }
    }

    case 'approve': {
      if (followUp.channel === 'needs_human') {
        return {
          ok: false,
          status: followUp.status,
          follow_up_id: followUp.follow_up_id,
          error:
            'There is no email address or phone number on this inquiry, so approving the wording would not achieve anything. Somebody has to find a contact detail first.',
        }
      }
      followUp.status = 'approved'
      followUp.approved_by = args.actor
      followUp.approved_at = new Date().toISOString()
      await persist(followUp)
      await auditLog('follow_up.approved', `follow_up:${followUp.follow_up_id}`, {
        inquiry_id: followUp.inquiry_id,
        actor: args.actor,
        justification: args.justification ?? null,
        channel: followUp.channel,
        missing_fields: followUp.missing_fields,
        persisted: followUp.persisted,
      })
      return {
        ok: true,
        status: followUp.status,
        follow_up_id: followUp.follow_up_id,
        human_summary: `${args.actor} approved follow-up ${followUp.follow_up_id}. It can go out now.${durabilityNote(followUp)}`,
      }
    }

    case 'send': {
      if (followUp.channel === 'needs_human') {
        return {
          ok: false,
          status: followUp.status,
          follow_up_id: followUp.follow_up_id,
          error:
            'This inquiry has neither an email address nor a phone number on it, so there is nowhere to send the follow-up. We have not guessed one.',
        }
      }
      if (followUp.status !== 'approved') {
        await auditLog('follow_up.send_blocked', `follow_up:${followUp.follow_up_id}`, {
          inquiry_id: followUp.inquiry_id,
          actor: args.actor,
          status: followUp.status,
        })
        return {
          ok: false,
          status: followUp.status,
          follow_up_id: followUp.follow_up_id,
          error: `Follow-up ${followUp.follow_up_id} has not been approved yet. Somebody reads what we are about to say to a customer before we say it.`,
        }
      }

      const inquiry = await loadInquiry(followUp.inquiry_id)
      const contact = await loadInquiryContact(followUp.inquiry_id)
      const outcome = await deliver({
        kind: 'follow_up',
        proposal_id: followUp.follow_up_id,
        inquiry_id: followUp.inquiry_id,
        contact: {
          name: inquiry?.contact_name ?? null,
          email: contact?.email ?? null,
          phone: contact?.phone ?? null,
        },
        subject: followUp.subject ?? `Your group inquiry with Solstice Hotels`,
        html: followUpHtml(followUp),
        text: followUp.body,
        sms_body: followUp.channel === 'sms' ? followUp.body : undefined,
        actor: args.actor,
      })

      if (outcome.ok) {
        followUp.status = 'sent'
        followUp.sent_to = outcome.displayed_to
        followUp.sent_at = new Date().toISOString()
        await persist(followUp)
      }

      return {
        ok: outcome.ok,
        status: followUp.status,
        follow_up_id: followUp.follow_up_id,
        error: outcome.ok ? undefined : outcome.human_reason,
        human_summary: outcome.ok
          ? `Follow-up ${followUp.follow_up_id} went out by ${outcome.channel} to ${outcome.displayed_to}${outcome.demo_mode ? ', routed to the demo inbox for this run' : ''}.${durabilityNote(followUp)}`
          : (outcome.human_reason ?? 'The follow-up was not sent.'),
      }
    }

    default:
      return { ok: false, error: `Unknown action "${String(args.action)}".` }
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Plain, unbranded-but-tidy HTML. A follow-up is a short note, not a proposal, and dressing it
 *  up as one would overstate where the inquiry has actually got to. */
export function followUpHtml(followUp: FollowUp): string {
  const paragraphs = followUp.body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 14px;">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('')

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(followUp.subject ?? 'Your group inquiry')}</title></head>
<body style="margin:0;padding:24px;background:#F7F3EC;font-family:Inter,Helvetica,Arial,sans-serif;color:#2E2A26;font-size:15px;line-height:24px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:92%;background:#ffffff;border:1px solid #E8E1D7;">
      <tr><td style="background:#141210;padding:20px 28px;color:#F7F3EC;font-family:Georgia,serif;font-size:18px;letter-spacing:.14em;text-transform:uppercase;">Solstice</td></tr>
      <tr><td style="padding:26px 28px;">${paragraphs}</td></tr>
    </table>
  </td></tr></table>
</body></html>`
}
