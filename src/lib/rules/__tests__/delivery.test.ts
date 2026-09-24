// Delivery: routing, demo redirection, and the $0-balance failure.
//
// No test here touches the network. The transport is injected, which is the same seam that
// makes "swap the provider" a config change rather than a rewrite.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildSmsBody,
  deliver,
  routeFor,
  type DeliveryRequest,
  type Transport,
} from '../../../../netlify/functions/_delivery'
import {
  CHANNEL_ATTACHMENT_POLICY,
  CHANNEL_PROVIDER,
  PROVIDERS,
  type DeliveryEnv,
} from '../../../../netlify/functions/_delivery/config'
import { classifyFailure, type TransportResult } from '../../../../netlify/functions/_delivery/telnyx'
import {
  clearAuditMemory,
  recentAudit,
} from '../../../../netlify/functions/_delivery/audit'

const DEMO_ENV: DeliveryEnv = {
  demo_mode: true,
  demo_email: 'enrique@example.com',
  demo_phone: '+13055550000',
  telnyx_api_key: 'test-key',
  email_from: 'sol@solsticehotels.example',
  sms_from: '+18005551234',
  public_base_url: 'https://solstice.example',
}

const LIVE_ENV: DeliveryEnv = { ...DEMO_ENV, demo_mode: false }

interface Captured {
  email: { to: string; subject: string; attachments?: unknown[] }[]
  sms: { to: string; text: string }[]
}

function stubTransport(result: Partial<TransportResult> = {}): { transport: Transport; captured: Captured } {
  const captured: Captured = { email: [], sms: [] }
  const transport: Transport = {
    email: async (payload) => {
      captured.email.push({
        to: payload.to,
        subject: payload.subject,
        attachments: payload.attachments,
      })
      return { ok: true, provider: 'telnyx_email', provider_message_id: 'msg_email', ...result }
    },
    sms: async (payload) => {
      captured.sms.push({ to: payload.to, text: payload.text })
      return { ok: true, provider: 'telnyx_sms', provider_message_id: 'msg_sms', ...result }
    },
  }
  return { transport, captured }
}

function request(overrides: Partial<DeliveryRequest> = {}): DeliveryRequest {
  return {
    proposal_id: 'PRP-TEST',
    inquiry_id: 'INQ-TEST',
    contact: { name: 'Bethany Cruz', email: 'bcruz@harlowvance.com', phone: '312-555-2211' },
    subject: 'Your group proposal',
    html: '<p>proposal</p>',
    text: 'proposal',
    pdf_url: 'https://solstice.example/api/group/pdf/PRP-TEST.pdf',
    attachment: {
      filename: 'proposal.pdf',
      content_base64: 'JVBERi0=',
      content_type: 'application/pdf',
    },
    ...overrides,
  }
}

beforeEach(() => {
  clearAuditMemory()
})

describe('routing is decided by the contact details we hold', () => {
  it('sends by email when an email address is present', () => {
    expect(routeFor({ email: 'a@b.com', phone: '555' })).toBe('email')
  })

  it('sends by SMS when only a phone number is present', () => {
    expect(routeFor({ email: null, phone: '555' })).toBe('sms')
    expect(routeFor({ email: '   ', phone: '555' })).toBe('sms')
  })

  it('flags for a human when neither is present', () => {
    expect(routeFor({ email: null, phone: null })).toBe('human')
  })
})

describe('email path', () => {
  it('attaches the PDF and routes to the demo inbox while showing the real contact', async () => {
    const { transport, captured } = stubTransport()
    const outcome = await deliver(request(), { env: DEMO_ENV, transport })

    expect(outcome.ok).toBe(true)
    expect(outcome.channel).toBe('email')
    expect(captured.email).toHaveLength(1)
    expect(captured.email[0].attachments).toHaveLength(1)

    // The message goes to the demo inbox...
    expect(captured.email[0].to).toBe('enrique@example.com')
    // ...while the screen still shows the customer's own address, masked.
    expect(outcome.displayed_to).toBe('b***@harlowvance.com')
    expect(outcome.actually_sent_to).toBe('e***@example.com')
    expect(outcome.demo_mode).toBe(true)
  })

  it('goes to the real customer when demo mode is off', async () => {
    const { transport, captured } = stubTransport()
    const outcome = await deliver(request(), { env: LIVE_ENV, transport })
    expect(captured.email[0].to).toBe('bcruz@harlowvance.com')
    expect(outcome.displayed_to).toBe('b***@harlowvance.com')
  })

  it('never leaks a full address into the audit trail', async () => {
    const { transport } = stubTransport()
    await deliver(request(), { env: LIVE_ENV, transport })
    const dump = JSON.stringify(recentAudit())
    expect(dump).not.toContain('bcruz@harlowvance.com')
    expect(dump).toContain('b***@harlowvance.com')
  })
})

describe('SMS path', () => {
  const phoneOnly = request({
    contact: { name: 'Kevin Marsh', email: null, phone: '401-555-2266' },
  })

  it('sends a link to the hosted PDF and never the PDF itself', async () => {
    const { transport, captured } = stubTransport()
    const outcome = await deliver(phoneOnly, { env: DEMO_ENV, transport })

    expect(outcome.ok).toBe(true)
    expect(outcome.channel).toBe('sms')
    expect(captured.email).toHaveLength(0)
    expect(captured.sms).toHaveLength(1)
    expect(captured.sms[0].text).toContain('https://solstice.example/api/group/pdf/PRP-TEST.pdf')

    // This is the rule, and it is config, not a comment in the send path.
    expect(CHANNEL_ATTACHMENT_POLICY.sms).toBe('link_only')
    expect(CHANNEL_ATTACHMENT_POLICY.email).toBe('attach_pdf')
  })

  it('redirects to the demo handset while showing the customer number, masked', async () => {
    const { transport, captured } = stubTransport()
    const outcome = await deliver(phoneOnly, { env: DEMO_ENV, transport })
    expect(captured.sms[0].to).toBe('+13055550000')
    expect(outcome.displayed_to).toBe('***-***-2266')
  })

  it('writes a message a person would actually send', () => {
    const body = buildSmsBody(phoneOnly, 'Kevin Marsh')
    expect(body).toContain('Sol')
    expect(body).toContain('Solstice')
    expect(body).toContain('https://')
    expect(body.length).toBeLessThan(320)
  })
})

describe('no contact at all', () => {
  it('sends nothing and flags for a human', async () => {
    const { transport, captured } = stubTransport()
    const outcome = await deliver(request({ contact: { name: 'Nobody', email: null, phone: null } }), {
      env: DEMO_ENV,
      transport,
    })

    expect(outcome.ok).toBe(false)
    expect(outcome.channel).toBeNull()
    expect(outcome.route).toBe('human')
    expect(outcome.needs_human).toBe(true)
    expect(outcome.failure_kind).toBe('no_contact')
    expect(captured.email).toHaveLength(0)
    expect(captured.sms).toHaveLength(0)
    expect(outcome.human_reason).toContain('not guessed')
  })
})

describe('the $0 Telnyx balance', () => {
  it('is classified by name rather than surfacing as a stack trace', () => {
    const { kind, human } = classifyFailure(402, '{"errors":[{"detail":"Insufficient funds"}]}')
    expect(kind).toBe('insufficient_balance')
    expect(human).toContain('no balance')
    expect(human).toContain('Nothing was charged')
    expect(human).not.toMatch(/40\d|error code|null|undefined/)
  })

  it('recognises a carrier registration refusal separately', () => {
    const { kind, human } = classifyFailure(403, 'number is not registered for 10DLC traffic')
    expect(kind).toBe('unregistered_sender')
    expect(human).toContain('carrier')
    expect(human).toContain('email')
  })

  it('fails explicitly and without throwing', async () => {
    const { transport } = stubTransport({
      ok: false,
      failure_kind: 'insufficient_balance',
      human_reason: 'The message was not sent because the Telnyx account has no balance on it.',
      error: 'Insufficient funds',
    })

    const outcome = await deliver(request(), { env: DEMO_ENV, transport })
    expect(outcome.ok).toBe(false)
    expect(outcome.failure_kind).toBe('insufficient_balance')
    expect(outcome.needs_human).toBe(true)
    expect(outcome.human_reason).toBeTruthy()
  })

  it('logs the failed attempt just as loudly as a successful one', async () => {
    const { transport } = stubTransport({ ok: false, failure_kind: 'insufficient_balance' })
    await deliver(request(), { env: DEMO_ENV, transport })

    const entries = recentAudit()
    expect(entries).toHaveLength(1)
    expect(entries[0].action).toBe('proposal.send_failed')
    expect(entries[0].subject).toBe('proposal:PRP-TEST')
    expect(entries[0].detail.failure_kind).toBe('insufficient_balance')
    expect(entries[0].detail.demo_mode).toBe(true)
  })

  it('logs every attempt, successful or not', async () => {
    const { transport } = stubTransport()
    await deliver(request(), { env: DEMO_ENV, transport })
    await deliver(request({ contact: { email: null, phone: '401-555-2266' } }), {
      env: DEMO_ENV,
      transport,
    })
    await deliver(request({ contact: { email: null, phone: null } }), { env: DEMO_ENV, transport })

    const actions = recentAudit().map((e) => e.action)
    expect(actions).toHaveLength(3)
    expect(actions.filter((a) => a === 'proposal.sent')).toHaveLength(2)
    expect(actions.filter((a) => a === 'proposal.send_failed')).toHaveLength(1)
  })

  it('does not throw when the provider is simply not configured', async () => {
    const outcome = await deliver(request(), {
      env: { ...DEMO_ENV, telnyx_api_key: null, email_from: null },
    })
    expect(outcome.ok).toBe(false)
    expect(outcome.failure_kind).toBe('not_configured')
  })
})

describe('swapping a channel is configuration', () => {
  it('reads its provider from a one-line table', () => {
    expect(CHANNEL_PROVIDER.email).toBe('telnyx_email')
    expect(CHANNEL_PROVIDER.sms).toBe('telnyx_sms')
    // The documented fallback exists behind the same adapter.
    expect(PROVIDERS.resend_email.label).toBe('Resend')
    expect(PROVIDERS.resend_email.endpoint).toMatch(/^https:\/\//)
  })

  it('honours a swap without touching the sending code', async () => {
    const original = CHANNEL_PROVIDER.email
    try {
      CHANNEL_PROVIDER.email = 'resend_email'
      const { transport } = stubTransport()
      const outcome = await deliver(request(), { env: DEMO_ENV, transport })
      expect(outcome.provider_label).toBe('Resend')
    } finally {
      CHANNEL_PROVIDER.email = original
    }
  })
})
