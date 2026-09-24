// Env access for the Telnyx + voice functions.
// Lives under netlify/functions/telnyx/_lib/ because that directory is bundled as part of the
// `telnyx` function; netlify/functions/voice/* imports from here so the two functions cannot
// drift on API base URLs, header names, or SIP identity.

/** Read an env var, returning null instead of undefined so `strict` callers must handle it. */
export function envOrNull(key: string): string | null {
  const v = process.env[key]
  return v && v.trim().length > 0 ? v.trim() : null
}

/** Read an env var or throw a message that names the key and the script that sets it. */
export function envOrThrow(key: string): string {
  const v = envOrNull(key)
  if (!v) {
    throw new Error(
      `Missing env var ${key}. Run \`node scripts/telnyx/provision.mjs\` (writes it to .env), ` +
        `then mirror .env into the Netlify site environment.`,
    )
  }
  return v
}

export const TELNYX_API_BASE = 'https://api.telnyx.com/v2'

/** SIP domain every Telnyx credential registers under. */
export const TELNYX_SIP_DOMAIN = 'sip.telnyx.com'

/** The SIP URI the browser supervisor is reachable at once it registers via @telnyx/webrtc. */
export function supervisorSipUri(): string {
  const explicit = envOrNull('TELNYX_SIP_URI')
  if (explicit) return explicit
  return `sip:${envOrThrow('TELNYX_SIP_USERNAME')}@${TELNYX_SIP_DOMAIN}`
}

/** Public origin of the deployed site, used to build webhook URLs. */
export function publicBaseUrl(): string {
  return (
    envOrNull('PUBLIC_BASE_URL') ??
    envOrNull('URL') ?? // Netlify sets this on deploys
    envOrNull('DEPLOY_PRIME_URL') ??
    'http://localhost:8888'
  )
}

export function isDemoMode(): boolean {
  return (envOrNull('DEMO_MODE') ?? 'false').toLowerCase() === 'true'
}
