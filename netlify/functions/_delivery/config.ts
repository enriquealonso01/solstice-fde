// Delivery configuration. Swapping a channel or a provider is an edit HERE, never in the
// sending code. That is the honest answer when the panel asks what happens if Telnyx goes down:
// point at this file, change one value, redeploy.

export type ChannelName = 'email' | 'sms'
export type ProviderId = 'telnyx_email' | 'telnyx_sms' | 'resend_email' | 'none'

export interface ProviderConfig {
  id: ProviderId
  /** Human name for the UI and the backend map. */
  label: string
  /** Full URL. Kept here so a version bump or a region move is one line. */
  endpoint: string
  /** Which env var holds the credential. */
  api_key_env: string
}

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  telnyx_email: {
    id: 'telnyx_email',
    label: 'Telnyx Email API',
    endpoint: 'https://api.telnyx.com/v2/email_messages',
    api_key_env: 'TELNYX_API_KEY',
  },
  telnyx_sms: {
    id: 'telnyx_sms',
    label: 'Telnyx Messaging API',
    endpoint: 'https://api.telnyx.com/v2/messages',
    api_key_env: 'TELNYX_API_KEY',
  },
  // Documented drop-in fallback. Nothing calls it today; it exists so that "we can swap
  // providers" is a demonstrable claim rather than an assertion.
  resend_email: {
    id: 'resend_email',
    label: 'Resend',
    endpoint: 'https://api.resend.com/emails',
    api_key_env: 'RESEND_API_KEY',
  },
  none: { id: 'none', label: 'not configured', endpoint: '', api_key_env: '' },
}

/** THE CHANNEL MAP. One line per channel. Change the right-hand side to change provider. */
export const CHANNEL_PROVIDER: Record<ChannelName, ProviderId> = {
  email: 'telnyx_email',
  sms: 'telnyx_sms',
}

/** Attachment policy per channel.
 *  SMS deliberately carries a link, never a file: Telnyx lists PDF over MMS as
 *  "limited carrier support" and the safe cross-carrier ceiling is 600 KB, so a PDF
 *  attachment is a silent delivery failure waiting to happen. See plans/03-messaging.md. */
export const CHANNEL_ATTACHMENT_POLICY: Record<ChannelName, 'attach_pdf' | 'link_only'> = {
  email: 'attach_pdf',
  sms: 'link_only',
}

export interface DeliveryEnv {
  demo_mode: boolean
  demo_email: string | null
  demo_phone: string | null
  telnyx_api_key: string | null
  email_from: string | null
  sms_from: string | null
  /** Public origin used to build the https link to the hosted PDF for SMS. */
  public_base_url: string | null
}

function env(name: string): string | null {
  const value = typeof process !== 'undefined' ? process.env?.[name] : undefined
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function readDeliveryEnv(): DeliveryEnv {
  return {
    demo_mode: (env('DEMO_MODE') ?? 'true').toLowerCase() !== 'false',
    demo_email: env('DEMO_EMAIL'),
    demo_phone: env('DEMO_PHONE'),
    telnyx_api_key: env('TELNYX_API_KEY'),
    email_from: env('TELNYX_EMAIL_FROM'),
    sms_from: env('TELNYX_PHONE_NUMBER'),
    public_base_url: env('PUBLIC_BASE_URL') ?? env('URL'),
  }
}

/** THE ROUTING RULE, as data rather than a chain of ifs in the sending path.
 *  Email wins when we have one: it carries the branded proposal and the PDF itself.
 *  Phone-only gets SMS with an https link. Neither gets a human. */
export const ROUTING_RULE = [
  { when: 'email_present', route: 'email' as const },
  { when: 'phone_only', route: 'sms' as const },
  { when: 'neither', route: 'human' as const },
]

export type Route = 'email' | 'sms' | 'human'

export function routeFor(contact: { email?: string | null; phone?: string | null }): Route {
  if (contact.email?.trim()) return 'email'
  if (contact.phone?.trim()) return 'sms'
  return 'human'
}
