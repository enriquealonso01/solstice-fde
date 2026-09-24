// The channel adapter.
//
// One function, `deliver()`, decides HOW a finished proposal reaches the customer and records
// that it tried. The decision itself is config (see config.ts), so "swap the channel" and
// "swap the provider" are both edits to a table rather than to this file.
//
// Three behaviours the panel will ask about, all handled here:
//   1. Email present  -> Telnyx Email, branded HTML plus the PDF as a real attachment.
//   2. Phone only     -> Telnyx SMS carrying an https link to the hosted PDF. Never an MMS
//                        attachment: PDF over MMS has limited carrier support and would fail
//                        silently on a subset of handsets (plans/03-messaging.md).
//   3. Neither        -> no send at all. It is flagged for a human, which is an outcome, not
//                        an error.
//
// DEMO_MODE redirects every real send to DEMO_EMAIL / DEMO_PHONE, while `displayed_to` still
// carries the customer's real (masked) contact so the admin screen shows the truth.

import { maskEmail, maskPhone } from '../_lib/mask'
import { auditLog, describeError } from './audit'
import {
  CHANNEL_ATTACHMENT_POLICY,
  CHANNEL_PROVIDER,
  PROVIDERS,
  readDeliveryEnv,
  routeFor,
  type ChannelName,
  type DeliveryEnv,
  type Route,
} from './config'
import { sendEmail, sendSms, type FailureKind, type TransportResult } from './telnyx'

export interface DeliveryContact {
  name?: string | null
  email?: string | null
  phone?: string | null
}

export interface DeliveryAttachment {
  filename: string
  content_base64: string
  content_type: string
}

export type DeliveryKind = 'proposal' | 'follow_up'

export interface DeliveryRequest {
  /** What is being sent. Drives the audit action and the default SMS wording; the routing
   *  rule itself is the same for both, which is the point of an adapter. */
  kind?: DeliveryKind
  /** The artifact's own reference: a proposal code or a follow-up code. */
  proposal_id: string
  inquiry_id: string
  contact: DeliveryContact
  subject: string
  html: string
  text: string
  /** Public https link to the hosted PDF. Required for the SMS path. */
  pdf_url?: string | null
  /** Optional PDF bytes for the email path. */
  attachment?: DeliveryAttachment | null
  /** Overrides the generated SMS body. */
  sms_body?: string
  /** Who pressed send, for the audit row. */
  actor?: string | null
}

export interface DeliveryOutcome {
  ok: boolean
  /** What we actually attempted. null when we deliberately sent nothing. */
  channel: ChannelName | null
  route: Route
  provider_label: string
  demo_mode: boolean
  /** The customer's own contact, masked. This is what the admin screen shows. */
  displayed_to: string
  /** Where the message really went, masked. Differs from `displayed_to` in demo mode. */
  actually_sent_to: string | null
  provider_message_id?: string
  /** Set whenever `ok` is false. Safe to put in front of a salesperson. */
  human_reason?: string
  failure_kind?: FailureKind
  error?: string
  attempted_at: string
  /** True when a human has to pick this up. */
  needs_human: boolean
}

/** Test seam: swap the transport without touching the routing logic. */
export interface Transport {
  email: typeof sendEmail
  sms: typeof sendSms
}

const REAL_TRANSPORT: Transport = { email: sendEmail, sms: sendSms }

export function buildSmsBody(request: DeliveryRequest, companyOrName: string): string {
  const who = companyOrName ? `${companyOrName}, ` : ''
  if (request.kind === 'follow_up') {
    // A follow-up has no attachment and no link; the whole message is the question, so the
    // caller supplies the body and this is only the fallback wrapper.
    return `Hi ${who}this is Sol at Solstice Hotels about your group enquiry. ${request.text}`.trim()
  }
  const link = request.pdf_url
    ? ` Your full proposal is here: ${request.pdf_url}`
    : ' Your full proposal is on its way by email.'
  return `Hi ${who}this is Sol at Solstice Hotels with the group proposal you asked for.${link} Reply to this message if anything needs changing.`.trim()
}

export async function deliver(
  request: DeliveryRequest,
  options: { env?: DeliveryEnv; transport?: Transport } = {},
): Promise<DeliveryOutcome> {
  const env = options.env ?? readDeliveryEnv()
  const transport = options.transport ?? REAL_TRANSPORT
  const attemptedAt = new Date().toISOString()
  const route = routeFor(request.contact)

  const displayedTo =
    route === 'email'
      ? maskEmail(request.contact.email)
      : route === 'sms'
        ? maskPhone(request.contact.phone)
        : ''

  // ------------------------------------------------------------------ no contact at all
  if (route === 'human') {
    const outcome: DeliveryOutcome = {
      ok: false,
      channel: null,
      route,
      provider_label: 'none',
      demo_mode: env.demo_mode,
      displayed_to: '',
      actually_sent_to: null,
      needs_human: true,
      failure_kind: 'no_contact',
      human_reason:
        'This inquiry has neither an email address nor a phone number on it, so there is nowhere for us to send the proposal. Someone needs to get a contact detail from the customer before this can go out. We have not guessed one.',
      attempted_at: attemptedAt,
    }
    await logAttempt(request, outcome, env)
    return outcome
  }

  const channel: ChannelName = route
  const providerId = CHANNEL_PROVIDER[channel]
  const providerLabel = PROVIDERS[providerId].label

  // ------------------------------------------------------------------ demo redirection
  const realEmail = request.contact.email?.trim() ?? null
  const realPhone = request.contact.phone?.trim() ?? null
  const targetEmail = env.demo_mode ? (env.demo_email ?? realEmail) : realEmail
  const targetPhone = env.demo_mode ? (env.demo_phone ?? realPhone) : realPhone

  let result: TransportResult
  try {
    if (channel === 'email') {
      if (!env.email_from) {
        result = {
          ok: false,
          provider: providerId,
          failure_kind: 'not_configured',
          error: 'TELNYX_EMAIL_FROM is not set',
          human_reason:
            'We have no verified sending address configured for this environment, so the email was not sent. The proposal is saved and can go out as soon as that is set up.',
        }
      } else {
        const attachments =
          CHANNEL_ATTACHMENT_POLICY.email === 'attach_pdf' && request.attachment
            ? [request.attachment]
            : undefined
        result = await transport.email(
          {
            from: env.email_from,
            to: targetEmail ?? '',
            subject: request.subject,
            html: request.html,
            text: request.text,
            attachments,
          },
          env.telnyx_api_key,
        )
      }
    } else {
      if (!env.sms_from) {
        result = {
          ok: false,
          provider: providerId,
          failure_kind: 'not_configured',
          error: 'TELNYX_PHONE_NUMBER is not set',
          human_reason:
            'We have no sending phone number configured for this environment, so the text message was not sent. The proposal is saved and can go out as soon as a number is attached.',
        }
      } else {
        const body =
          request.sms_body ?? buildSmsBody(request, request.contact.name?.trim() ?? '')
        result = await transport.sms(
          { from: env.sms_from, to: targetPhone ?? '', text: body },
          env.telnyx_api_key,
        )
      }
    }
  } catch (err) {
    // Belt and braces. The transport already swallows its own errors; this catches anything
    // thrown while building the payload so a send can never take the request down.
    result = {
      ok: false,
      provider: providerId,
      failure_kind: 'provider_error',
      error: describeError(err),
      human_reason:
        'Something went wrong on our side while preparing the message, so nothing was sent. The proposal itself is saved and unchanged.',
    }
  }

  const outcome: DeliveryOutcome = {
    ok: result.ok,
    channel,
    route,
    provider_label: providerLabel,
    demo_mode: env.demo_mode,
    displayed_to: displayedTo,
    actually_sent_to: channel === 'email' ? maskEmail(targetEmail) : maskPhone(targetPhone),
    provider_message_id: result.provider_message_id,
    human_reason: result.ok ? undefined : result.human_reason,
    failure_kind: result.ok ? undefined : result.failure_kind,
    error: result.ok ? undefined : result.error,
    attempted_at: attemptedAt,
    needs_human: !result.ok,
  }

  await logAttempt(request, outcome, env)
  return outcome
}

async function logAttempt(
  request: DeliveryRequest,
  outcome: DeliveryOutcome,
  env: DeliveryEnv,
): Promise<void> {
  const kind = request.kind ?? 'proposal'
  try {
    await auditLog(
      outcome.ok ? `${kind}.sent` : `${kind}.send_failed`,
      `${kind}:${request.proposal_id}`,
      {
        inquiry_id: request.inquiry_id,
        channel: outcome.channel,
        route: outcome.route,
        provider: outcome.provider_label,
        demo_mode: env.demo_mode,
        // Already masked on the outcome; passed through the masker again, which is idempotent.
        displayed_to: outcome.displayed_to,
        actually_sent_to: outcome.actually_sent_to,
        provider_message_id: outcome.provider_message_id ?? null,
        failure_kind: outcome.failure_kind ?? null,
        human_reason: outcome.human_reason ?? null,
        provider_error: outcome.error ?? null,
        pdf_link_sent: outcome.channel === 'sms' ? Boolean(request.pdf_url) : null,
        pdf_attached: outcome.channel === 'email' ? Boolean(request.attachment) : null,
        actor: request.actor ?? null,
        attempted_at: outcome.attempted_at,
      },
    )
  } catch {
    // auditLog already swallows its own failures; this is the last line of defence so that
    // a broken audit path can never stop a proposal from being sent.
  }
}

export { readDeliveryEnv, routeFor, CHANNEL_PROVIDER, PROVIDERS } from './config'
export { auditLog, recentAudit, clearAuditMemory } from './audit'
export type { ChannelName, Route, DeliveryEnv } from './config'
export type { FailureKind, TransportResult } from './telnyx'
