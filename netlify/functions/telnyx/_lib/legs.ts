// WHICH LEG IS THIS?
//
// Pure functions, no env reads and no I/O, so the rules that caused a live outage can be pinned
// by tests instead of by a paid phone call.
//
// THE OUTAGE, for whoever reads this next: dialling the supervisor leg produces call events on
// OUR OWN webhook -- twice over, because both the outbound leg on the call control application
// and the inbound leg terminating on the browser's Credential SIP Connection report in. The
// original guard checked only `client_state` and `direction`. Neither survives on the leg that
// arrives at the credential connection, so the webhook treated the supervisor's browser as a
// brand new guest: it ran caller-ID identification against the SIP user, answered the leg, and
// started Sol on it. Our own handler hung the supervisor up within two seconds, which read as
// "supervision does not work against an assistant leg" when in fact the leg was created fine.
//
// Hence four independent signals. client_state is the cheapest and the least reliable, which is
// exactly why it is not the only one.

import { envOrNull } from './env'

export type LegKind = 'guest' | 'supervisor' | 'unknown'

export interface LegConfig {
  /** Credential SIP Connection the browser supervisor registers against. */
  sipConnectionId: string | null
  sipUsername: string | null
  sipUri: string | null
  /** The number we own. A guest call is addressed to this and nothing else. */
  phoneNumber: string | null
}

export function legConfigFromEnv(): LegConfig {
  return {
    sipConnectionId: envOrNull('TELNYX_SIP_CONNECTION_ID'),
    sipUsername: envOrNull('TELNYX_SIP_USERNAME'),
    sipUri: envOrNull('TELNYX_SIP_URI'),
    phoneNumber: envOrNull('TELNYX_PHONE_NUMBER'),
  }
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Last 10 digits, so +13057866217 and 305-786-6217 compare equal. */
export function phoneDigits(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  return digits.length >= 10 ? digits.slice(-10) : null
}

function decodeKind(clientState: string | null): string | null {
  if (!clientState) return null
  try {
    const parsed = JSON.parse(Buffer.from(clientState, 'base64').toString('utf8')) as { kind?: string }
    return typeof parsed?.kind === 'string' ? parsed.kind : null
  } catch {
    return null
  }
}

/**
 * Any ONE of these proves the leg is not a guest. They are checked cheapest-first, but the order
 * is not load-bearing: they are independent, and that redundancy is the point.
 */
export function classifyLeg(payload: Record<string, unknown>, cfg: LegConfig): LegKind {
  // 1. The marker we set at dial time. Not present on the leg that lands on the SIP connection.
  if (decodeKind(str(payload.client_state)) === 'supervisor') return 'supervisor'

  // 2. Anything on the browser's Credential SIP Connection is the supervisor, by construction.
  const connectionId = str(payload.connection_id)
  if (cfg.sipConnectionId && connectionId === cfg.sipConnectionId) return 'supervisor'

  // 3. Anything ADDRESSED to the supervisor's SIP URI is the supervisor, by definition.
  const to = (str(payload.to) ?? '').toLowerCase()
  if (to && cfg.sipUri && to.includes(cfg.sipUri.toLowerCase().replace(/^sip:/, ''))) return 'supervisor'
  if (to && cfg.sipUsername && to.includes(cfg.sipUsername.toLowerCase())) return 'supervisor'

  // 4. We only ever dial out in order to place a supervisor leg.
  if (str(payload.direction) === 'outgoing') return 'supervisor'

  return 'unknown'
}

/**
 * A guest call is an INBOUND call addressed to the number we bought. Nothing else may create a
 * session row, answer a leg, or start Sol.
 *
 * Positive allowlist on purpose. The outage came from a denylist that did not know about a leg
 * shape it had never seen; an allowlist fails closed when the next unfamiliar shape turns up.
 */
export function isGuestCall(payload: Record<string, unknown>, cfg: LegConfig): boolean {
  if (classifyLeg(payload, cfg) === 'supervisor') return false
  const ours = phoneDigits(cfg.phoneNumber)
  // Without a configured number there is nothing to allowlist against; fall back to
  // "inbound, and not one of the supervisor signals above".
  if (!ours) return str(payload.direction) !== 'outgoing'
  return phoneDigits(str(payload.to)) === ours
}
