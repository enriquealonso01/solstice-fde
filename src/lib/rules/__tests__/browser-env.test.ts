/**
 * The list in `vite.config.ts` is the boundary between the server's secrets and the browser.
 *
 * `docs/architecture.svg` tells a reviewer, under "Secrets and keys": *"Today: Netlify env vars; only
 * the Supabase anon key reaches the browser."* That is currently true — the shipped bundle's only JWT
 * is `role: anon`, verified against production.
 *
 * What makes it fragile is how it is achieved. The `.env` is shared with the serverless functions,
 * which use unprefixed names, so `vite.config.ts` injects selected values through `define` instead of
 * relying on Vite's `VITE_` prefix. **That prefix is normally the thing that stops an unprefixed
 * secret reaching the browser.** Bypassing it is reasonable here and it moves the whole boundary into
 * one hand-maintained list, guarded by a comment reading "Service-role keys must never appear here".
 *
 * A comment is not a boundary. Adding one line — `JSON.stringify(env.SUPABASE_SERVICE_ROLE_KEY)` —
 * would ship a key that bypasses every RLS policy in the system to every visitor, and the build would
 * succeed, the tests would pass and the diagram would quietly become false.
 *
 * So this asserts the list, twice over: every exposed value must be named in ALLOWED, and no exposed
 * name may look like a credential. The second check is the one that catches a variable nobody thought
 * to add here.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(__dirname, '../../../..')
const config = readFileSync(join(repoRoot, 'vite.config.ts'), 'utf8')

/** Env values that may reach the browser, each safe for a stated reason. */
const ALLOWED: Record<string, string> = {
  SUPABASE_URL: 'public project URL; useless without a key',
  SUPABASE_ANON_KEY: 'the anon role, which is exactly what RLS is written against',
  TELNYX_PHONE_NUMBER: 'the published DID — it is printed on the site',
  TELNYX_ASSISTANT_ID: 'an identifier, not a credential; changing the assistant needs the API key',
}

/** Words that mean "this is a credential", regardless of which service it belongs to. */
const CREDENTIAL_ISH = /SERVICE_ROLE|SECRET|PASSWORD|PRIVATE|_TOKEN|API_KEY|ANTHROPIC|WEBHOOK/

function exposedEnvNames(): string[] {
  const block = config.slice(config.indexOf('define:'))
  // The SOURCE value, not the browser-side alias. A looser /env[.]NAME/ also matches the
  // 'import.meta.env.VITE_...' key on the left of each line, which reports the aliases and tells you
  // nothing about what was read from .env -- it failed that way first.
  return [...block.matchAll(/JSON\.stringify\(\s*env\.([A-Z0-9_]+)/g)].map((m) => m[1])
}

describe('what vite.config.ts lets into the browser', () => {
  it('exposes something, so this cannot pass by matching an empty define block', () => {
    expect(exposedEnvNames().length).toBeGreaterThan(0)
  })

  it('exposes only values that are named and justified here', () => {
    const unlisted = exposedEnvNames().filter((n) => !(n in ALLOWED))
    expect(
      unlisted,
      `vite.config.ts injects ${unlisted.join(', ')} into the browser bundle, and this test does not ` +
        `know why that is safe. Add it to ALLOWED with a reason, or stop exposing it. ` +
        `docs/architecture.svg tells a reviewer only the Supabase anon key reaches the browser.`,
    ).toEqual([])
  })

  it('exposes nothing whose name says it is a credential', () => {
    const secrets = exposedEnvNames().filter((n) => CREDENTIAL_ISH.test(n))
    expect(
      secrets,
      `vite.config.ts would ship ${secrets.join(', ')} to every visitor. A service-role key bypasses ` +
        `every RLS policy in this system. The build would succeed and nothing else would notice.`,
    ).toEqual([])
  })

  it('keeps the warning that explains why the list is the boundary', () => {
    expect(config).toContain('Service-role keys must never appear here')
  })
})
