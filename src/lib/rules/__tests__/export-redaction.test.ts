/**
 * The public Telnyx export must not carry anything addressable.
 *
 * `exports/telnyx-assistant.json` is tracked in a public repository. It checks the committed artefact
 * rather than the export script, because the artefact is what ships and a regenerated file has to
 * pass this too. It asserts the rule (no SIP URI with a real local part, no credential-shaped string)
 * rather than a list of known values, so a second credential under a new key is caught as well.
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
        `sip:REDACTED_TRANSFER_TARGET@sip.telnyx.com.`,
    ).toEqual([])
  })

  it('still redacts the shared webhook secret', () => {
    expect(raw).toContain('REDACTED_INJECTED_FROM_TOOL_WEBHOOK_SECRET')
  })

  it('carries no credential-shaped strings', () => {
    const suspicious = raw.match(/\b(?:gencred|cred)[A-Za-z0-9]{30,}\b/g) ?? []
    expect(suspicious, `Credential-shaped strings in the export: ${suspicious.join(', ')}`).toEqual([])
  })

  it('is parseable and still describes the assistant, so this cannot pass on an empty file', () => {
    const parsed = JSON.parse(raw) as { instructions?: string; tools?: unknown[] }
    expect(parsed.instructions?.length ?? 0).toBeGreaterThan(1000)
    expect(parsed.tools?.length ?? 0).toBeGreaterThan(20)
  })
})
