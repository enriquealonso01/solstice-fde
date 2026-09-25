/**
 * The public export must not carry anything addressable.
 *
 * `exports/telnyx-assistant.json` is tracked in a public repository, and `SUBMISSION.md` makes an
 * explicit claim about it: *"Nothing secret is in it … the Telnyx export has its shared secret
 * redacted."* That was true of the shared secret, redacted 23 times, and not true of the SIP
 * transfer target, which shipped as `sip:gencred<49 chars>@sip.telnyx.com`.
 *
 * Two things let that through, and both are the same mistake:
 *
 *  1. The export script redacted one **value** it was told about (`TOOL_WEBHOOK_SECRET`) rather than
 *     enforcing a **rule** about what may leave.
 *  2. A scan I ran over this very file an iteration earlier reported "no leaks". It looked for API
 *     key prefixes, JWTs and `service_role` — things I predicted. A SIP URI is none of them.
 *
 * So this asserts the property rather than the list: no `sip:` URI in the export may have a local
 * part other than the redaction marker. It checks the committed artefact, not the script, because the
 * artefact is what ships and a regenerated file has to pass this too.
 *
 * A SIP credential username is not a password — registering as that connection needs a secret that
 * is not in this file. The exposure is that a stranger can address traffic at a named connection:
 * low, not zero, and not something to ship knowingly.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(__dirname, '../../../..')
const exportPath = resolve(repoRoot, 'exports/telnyx-assistant.json')
const raw = readFileSync(exportPath, 'utf8')

describe('exports/telnyx-assistant.json', () => {
  it('contains no SIP URI with a real local part', () => {
    const leaks = raw.match(/sip:(?!REDACTED_TRANSFER_TARGET)[^@"\s]+@sip\.telnyx\.com/g) ?? []
    expect(
      leaks,
      `The export carries an addressable SIP credential: ${leaks.join(', ')}. Redact it to ` +
        `sip:REDACTED_TRANSFER_TARGET@sip.telnyx.com — the adjacent "name" already tells a reviewer ` +
        `everything useful, and SUBMISSION.md claims this file has no secrets in it.`,
    ).toEqual([])
  })

  it('still redacts the shared webhook secret, which was never the broken part', () => {
    expect(raw).toContain('REDACTED_INJECTED_FROM_TOOL_WEBHOOK_SECRET')
  })

  it('carries no credential-shaped strings of the length the SIP username had', () => {
    // The live username was `gencred` + 42 characters. Catching the prefix is narrow; catching the
    // shape is what stops the next one appearing under a key nobody thought to check.
    const suspicious = raw.match(/\b(?:gencred|cred)[A-Za-z0-9]{30,}\b/g) ?? []
    expect(suspicious, `Credential-shaped strings in the export: ${suspicious.join(', ')}`).toEqual([])
  })

  it('is parseable and still describes the assistant, so this cannot pass on an empty file', () => {
    const parsed = JSON.parse(raw) as { instructions?: string; tools?: unknown[] }
    expect(parsed.instructions?.length ?? 0).toBeGreaterThan(20000)
    expect(parsed.tools?.length ?? 0).toBeGreaterThan(20)
  })
})
