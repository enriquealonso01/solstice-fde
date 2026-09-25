/**
 * The mic used to fail with the Telnyx SDK's catch-all "An unexpected error
 * occurred" because the call was pinned to a hand-written opus descriptor.
 * `setCodecPreferences` only accepts entries the browser itself advertised, so
 * the fix is to forward the real capability, and to forward nothing at all when
 * opus is absent. These tests hold that line.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { preferredAudioCodecs } from '../useTelnyxVoice'

type Capabilities = { codecs: RTCRtpCodec[] } | null

const OPUS: RTCRtpCodec = {
  mimeType: 'audio/opus',
  clockRate: 48000,
  channels: 2,
  sdpFmtpLine: 'minptime=10;useinbandfec=1',
}
const PCMU: RTCRtpCodec = { mimeType: 'audio/PCMU', clockRate: 8000, channels: 1 }

/** Stands in for the browser's RTCRtpReceiver, which node does not have. */
function stubReceiver(getCapabilities: unknown): void {
  Object.defineProperty(globalThis, 'RTCRtpReceiver', {
    value: getCapabilities === undefined ? undefined : { getCapabilities },
    configurable: true,
    writable: true,
  })
}

afterEach(() => {
  stubReceiver(undefined)
})

describe('preferredAudioCodecs', () => {
  it('returns the browser capability object untouched, sdpFmtpLine and all', () => {
    stubReceiver((): Capabilities => ({ codecs: [PCMU, OPUS] }))

    const codecs = preferredAudioCodecs()

    expect(codecs).toEqual([OPUS])
    // Identity matters: setCodecPreferences compares against what it advertised.
    expect(codecs?.[0]).toBe(OPUS)
  })

  it('keeps every opus variant rather than picking one arbitrarily', () => {
    const redundancy: RTCRtpCodec = { ...OPUS, sdpFmtpLine: 'minptime=20' }
    stubReceiver((): Capabilities => ({ codecs: [OPUS, PCMU, redundancy] }))

    expect(preferredAudioCodecs()).toEqual([OPUS, redundancy])
  })

  it('falls back to SDK defaults when opus is not advertised', () => {
    stubReceiver((): Capabilities => ({ codecs: [PCMU] }))

    expect(preferredAudioCodecs()).toBeUndefined()
  })

  it('falls back to SDK defaults when the browser has no RTCRtpReceiver', () => {
    stubReceiver(undefined)

    expect(preferredAudioCodecs()).toBeUndefined()
  })

  it('falls back to SDK defaults when capabilities come back null', () => {
    stubReceiver((): Capabilities => null)

    expect(preferredAudioCodecs()).toBeUndefined()
  })

  it('never lets a throwing getCapabilities take the call down', () => {
    stubReceiver(() => {
      throw new Error('not allowed in this context')
    })

    expect(preferredAudioCodecs()).toBeUndefined()
  })
})
