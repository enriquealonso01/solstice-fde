/**
 * Runtime failure injection.
 *
 * Reads `demo_flags` so an administrator can take a dependency offline mid-conversation and the
 * panel can watch the agent degrade rather than take our word for it.
 *
 * Two deliberate choices:
 *
 *  - CACHED FOR 3 SECONDS. Long enough that a chatty turn does not hit Postgres once per tool,
 *    short enough that flipping a switch on screen visibly changes the next answer. A demo beat
 *    that needs a redeploy, or even a page refresh, is not a demo beat.
 *  - FAILS CLOSED TO "HEALTHY". If the flags table is unreachable we assume nothing is injected.
 *    The alternative, treating a database blip as "the PMS is down", would make a real outage
 *    look like a staged one and vice versa.
 */
import { tryGetDb } from './db'

export type FlagKey = 'pms_offline' | 'reservations_offline' | 'policy_source_offline'

interface CacheEntry {
  at: number
  flags: Record<string, boolean>
}

const TTL_MS = 3000
let cache: CacheEntry | null = null

/** Human-readable reason per dependency, spoken to the guest and shown in the trace. */
export const OUTAGE_REASON: Record<FlagKey, string> = {
  pms_offline:
    'The property management system is unreachable, so live room availability cannot be confirmed right now.',
  reservations_offline:
    'Central reservations is unreachable, so existing bookings cannot be looked up right now.',
  policy_source_offline:
    'The policy reference is unreachable, so no policy can be quoted right now.',
}

export async function readFlags(): Promise<Record<string, boolean>> {
  const now = Date.now()
  if (cache && now - cache.at < TTL_MS) return cache.flags

  const db = tryGetDb()
  if (!db) {
    cache = { at: now, flags: {} }
    return cache.flags
  }

  try {
    const { data, error } = await db.from('demo_flags').select('key, enabled')
    if (error || !data) {
      cache = { at: now, flags: {} }
      return cache.flags
    }
    const flags: Record<string, boolean> = {}
    for (const row of data as { key: string; enabled: boolean }[]) flags[row.key] = row.enabled === true
    cache = { at: now, flags }
    return flags
  } catch {
    cache = { at: now, flags: {} }
    return cache.flags
  }
}

export async function isOffline(key: FlagKey): Promise<boolean> {
  const flags = await readFlags()
  return flags[key] === true
}

/** Drops the cache so a freshly flipped switch takes effect on the very next call. */
export function invalidateFlagCache(): void {
  cache = null
}
