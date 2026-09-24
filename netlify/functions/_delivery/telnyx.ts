// Telnyx transport. One provider for voice, SMS and email, which is the whole reason it was
// chosen over adding a second vendor just for mail (plans/03-messaging.md).
//
// KNOWN STATE: the Telnyx account balance is $0.00, so every live send below will be rejected
// upstream. That is expected and handled. `sendEmail` and `sendSms` never throw; they classify
// the failure and hand back something the UI can show a human without a stack trace.

import { PROVIDERS, type ProviderId } from './config'
import { describeError } from './audit'

export type FailureKind =
  | 'insufficient_balance'
  | 'not_configured'
  | 'unregistered_sender'
  | 'network'
  | 'provider_error'
  | 'no_contact'

export interface TransportResult {
  ok: boolean
  provider: ProviderId
  provider_message_id?: string
  status?: number
  error?: string
  failure_kind?: FailureKind
  /** What a salesperson should be told, in plain words. */
  human_reason?: string
}

export interface EmailPayload {
  from: string
  to: string
  subject: string
  html: string
  text: string
  attachments?: { filename: string; content_base64: string; content_type: string }[]
}

export interface SmsPayload {
  from: string
  to: string
  text: string
}

const TIMEOUT_MS = 12_000

/** Classifies a provider rejection into something we can act on.
 *  The $0-balance case is called out by name because it is the one we know we are in. */
export function classifyFailure(status: number, body: string): { kind: FailureKind; human: string } {
  const text = body.toLowerCase()
  if (status === 402 || /insufficient|balance|out of funds|not enough funds|payment required/.test(text)) {
    return {
      kind: 'insufficient_balance',
      human:
        'The message was not sent because the Telnyx account has no balance on it. Nothing was charged and nothing reached the customer. Top the account up and press send again; the proposal itself is saved and unchanged.',
    }
  }
  if (/10dlc|not registered|unregistered|campaign|brand|toll.?free verification/.test(text)) {
    return {
      kind: 'unregistered_sender',
      human:
        'The text message was refused because the sending number is still going through carrier registration. This is a carrier rule, not something we can bypass, and it clears on its own once registration completes. In the meantime we can send the same proposal by email.',
    }
  }
  if (status === 401 || status === 403) {
    return {
      kind: 'provider_error',
      human:
        'The messaging provider rejected our credentials, so nothing was sent. This is a configuration problem on our side, not anything to do with the customer or the proposal.',
    }
  }
  return {
    kind: 'provider_error',
    human: `The messaging provider returned an error (${status}) and nothing was sent. The proposal is saved and can be sent again once the problem is fixed.`,
  }
}

async function post(
  provider: ProviderId,
  body: unknown,
  apiKey: string | null,
): Promise<TransportResult> {
  const config = PROVIDERS[provider]
  if (!apiKey) {
    return {
      ok: false,
      provider,
      failure_kind: 'not_configured',
      error: `${config.api_key_env} is not set`,
      human_reason: `We cannot send through ${config.label} because its API key is not configured on this environment. Nothing was sent.`,
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    const raw = await response.text()
    if (!response.ok) {
      const { kind, human } = classifyFailure(response.status, raw)
      return {
        ok: false,
        provider,
        status: response.status,
        error: raw.slice(0, 600),
        failure_kind: kind,
        human_reason: human,
      }
    }

    let id: string | undefined
    try {
      const parsed = JSON.parse(raw) as { data?: { id?: string } }
      id = parsed?.data?.id
    } catch {
      // A 2xx with an unparseable body still counts as sent; we just have no id to show.
    }
    return { ok: true, provider, status: response.status, provider_message_id: id }
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    return {
      ok: false,
      provider,
      failure_kind: 'network',
      error: describeError(err),
      human_reason: aborted
        ? 'The messaging provider did not respond in time, so we stopped waiting. Nothing was sent, and the proposal is unchanged.'
        : 'We could not reach the messaging provider at all, so nothing was sent. The proposal is saved and can be sent again.',
    }
  } finally {
    clearTimeout(timer)
  }
}

export function sendEmail(payload: EmailPayload, apiKey: string | null): Promise<TransportResult> {
  return post(
    'telnyx_email',
    {
      from: payload.from,
      to: [payload.to],
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
      attachments: payload.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content_base64,
        type: a.content_type,
      })),
    },
    apiKey,
  )
}

export function sendSms(payload: SmsPayload, apiKey: string | null): Promise<TransportResult> {
  return post('telnyx_sms', { from: payload.from, to: payload.to, text: payload.text }, apiKey)
}
