// Files a supervisor hands to a guest mid-conversation.
//
// Same hosting model as a group proposal PDF (netlify/functions/group/store.ts): a public Supabase
// Storage bucket, with an unguessable path rather than a login. A guest in a chat widget has no
// account and never will, so a signed URL would either expire while they were reading it or force
// an auth flow onto someone who is trying to collect a parking permit. The path carries 128 bits of
// randomness; guessing one is not a threat model, and the alternative is worse for the guest.
//
// WHAT THIS DELIBERATELY DOES NOT DO. It does not scan the file, and it does not let the guest send
// one back. Both are real requirements for a hotel that actually shipped this, and both are listed
// in docs/where-this-goes.md rather than half-built here: an upload path with no scanning, in both
// directions, is a malware relay with a Solstice logo on it. One direction, staff to guest, from an
// authenticated employee, is a defensible line to stop at for a proof of concept.

import type { SupabaseClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'

export const ATTACHMENT_BUCKET = 'attachments'

/**
 * 4 MB. A concierge sends a confirmation, a map, a permit, a menu; none of those is larger.
 *
 * The number is derived, not chosen. The file travels as base64 inside a JSON body, which is 4/3 of
 * its size, and Netlify's request limit is 6 MB: 4 MB encodes to about 5.5 MB and fits, 5 MB encodes
 * to about 6.9 MB and does not. This was 5 MB until attachment-safety.test.ts multiplied it out and
 * showed that the cap meant to keep failures inside this function, where they can be explained, was
 * itself large enough to fail in the platform, where they cannot.
 */
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024

/**
 * What a guest browser is allowed to be handed. An allowlist, not a denylist: the point is not to
 * enumerate what is dangerous — that list is never finished — but to name the handful of things a
 * concierge actually sends. Anything else is a conversation to have, not a default to allow.
 */
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/calendar',
])

export interface StoredAttachment {
  filename: string
  content_type: string
  bytes: number
  url: string
  /** 'storage' when Supabase Storage served it. Nothing else does today; named so a future
   *  fallback cannot be mistaken for the real thing by a reader of the transcript. */
  host: 'storage'
}

export type StoreResult =
  | { ok: true; attachment: StoredAttachment }
  | { ok: false; error: string; status: 400 | 413 | 415 | 503 }

export async function storeAttachment(
  db: SupabaseClient,
  sessionId: string,
  input: { filename?: string; contentType?: string; base64: string },
): Promise<StoreResult> {
  const filename = safeFilename(input.filename)
  if (!filename) return { ok: false, error: 'attachment.filename is required', status: 400 }

  const contentType = (input.contentType ?? '').trim().toLowerCase()
  if (!ALLOWED_TYPES.has(contentType)) {
    return {
      ok: false,
      error:
        `${contentType || 'that file type'} is not one a guest can be sent. ` +
        `Allowed: ${[...ALLOWED_TYPES].join(', ')}`,
      status: 415,
    }
  }

  let bytes: Buffer
  try {
    bytes = Buffer.from(input.base64, 'base64')
  } catch {
    return { ok: false, error: 'attachment.data_base64 is not valid base64', status: 400 }
  }
  if (bytes.length === 0) return { ok: false, error: 'the attachment decoded to zero bytes', status: 400 }
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    return {
      ok: false,
      error: `that file is ${formatBytes(bytes.length)}. The limit is ${formatBytes(MAX_ATTACHMENT_BYTES)}.`,
      status: 413,
    }
  }

  // Session id, then a random segment, then the name. The session id makes an object traceable back
  // to the conversation it belongs to without opening it; the random segment is what makes the URL
  // unguessable, so two supervisors sending "confirmation.pdf" cannot overwrite each other either.
  const path = `${sessionId}/${randomBytes(16).toString('hex')}/${filename}`

  const uploaded = await uploadWithBucketCreate(db, path, bytes, contentType)
  if (!uploaded.ok) return uploaded

  const { data } = db.storage.from(ATTACHMENT_BUCKET).getPublicUrl(path)
  if (!data?.publicUrl) {
    return { ok: false, error: 'the file uploaded but Storage returned no public URL for it', status: 503 }
  }

  return {
    ok: true,
    attachment: { filename, content_type: contentType, bytes: bytes.length, url: data.publicUrl, host: 'storage' },
  }
}

/**
 * Upload, and create the bucket if it is not there yet.
 *
 * The bucket is not in supabase/schema.sql because a bucket is not SQL, and the alternative was a
 * setup step in a README that somebody has to remember at the wrong moment. Creating it on the
 * first failed upload costs one extra round trip once, ever.
 */
async function uploadWithBucketCreate(
  db: SupabaseClient,
  path: string,
  bytes: Buffer,
  contentType: string,
): Promise<{ ok: true } | { ok: false; error: string; status: 503 }> {
  const first = await db.storage.from(ATTACHMENT_BUCKET).upload(path, bytes, { contentType, upsert: false })
  if (!first.error) return { ok: true }

  if (!isBucketMissing(first.error)) {
    return { ok: false, error: `Storage rejected the upload: ${first.error.message}`, status: 503 }
  }

  const created = await db.storage.createBucket(ATTACHMENT_BUCKET, {
    public: true,
    fileSizeLimit: MAX_ATTACHMENT_BYTES,
  })
  // A parallel request may have created it first; that is a success, not a failure.
  if (created.error && !/already exists/i.test(created.error.message)) {
    return { ok: false, error: `could not create the ${ATTACHMENT_BUCKET} bucket: ${created.error.message}`, status: 503 }
  }

  const retry = await db.storage.from(ATTACHMENT_BUCKET).upload(path, bytes, { contentType, upsert: false })
  if (retry.error) return { ok: false, error: `Storage rejected the upload: ${retry.error.message}`, status: 503 }
  return { ok: true }
}

function isBucketMissing(error: { message?: string } | null): boolean {
  return /bucket not found|not found/i.test(error?.message ?? '')
}

/**
 * A filename from a browser is untrusted input that ends up in a URL path.
 *
 * Strips any directory component, keeps one extension, and allows only characters that survive a
 * URL and a filesystem unaltered. `../../../etc/passwd` becomes `passwd` -- the last segment, with
 * the path discarded rather than flattened -- and an empty result is rejected by the caller rather
 * than silently named something. Both forms are pinned in attachment-safety.test.ts.
 */
export function safeFilename(raw: string | undefined): string | null {
  const base = (raw ?? '').split(/[/\\]/).pop() ?? ''
  const cleaned = base
    .normalize('NFKD')
    .replace(/[^\w.\- ]+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim()
  if (!cleaned) return null
  // 120 characters is longer than any real filename and short enough to stay inside path limits
  // once the session id and the random segment are in front of it.
  return cleaned.length > 120 ? `${cleaned.slice(0, 100)}${extensionOf(cleaned)}` : cleaned
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 && dot > name.length - 12 ? name.slice(dot) : ''
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
