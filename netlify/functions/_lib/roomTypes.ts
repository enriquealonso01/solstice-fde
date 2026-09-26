// Canonical room-type vocabulary. The properties CSV names inventory columns
// (`standard_king_rooms`, ...) while reservations and inquiries use display labels
// (`Standard King`, ...). We normalise on the display labels so that
// `property.inventory[reservation.room_type]` is a direct lookup.
//
// Imported by BOTH `scripts/data/build.mjs` (Node strips the types) and the runtime
// accessors in `data.ts`, so the generated keys and the runtime lookup cannot drift.

export const ROOM_TYPES = [
  'Standard King',
  'Standard Double',
  'Deluxe King',
  'Suite',
  'Accessible King',
] as const

export type RoomType = (typeof ROOM_TYPES)[number]

/** CSV inventory column -> canonical label.
 *  ASSUMPTION: the CSV's generic `accessible_rooms` column is surfaced as `Accessible King`,
 *  because that is the only accessible room type that appears anywhere in the reservation
 *  data (R55016). */
export const INVENTORY_COLUMNS: Record<string, RoomType> = {
  standard_king_rooms: 'Standard King',
  standard_double_rooms: 'Standard Double',
  deluxe_king_rooms: 'Deluxe King',
  suite_rooms: 'Suite',
  accessible_rooms: 'Accessible King',
}

/** Which base_rate_* column prices a given room type. `Accessible King` is priced as a
 *  standard room: the CSV carries no separate accessible rate. */
export const RATE_COLUMN_FOR_ROOM: Record<RoomType, 'standard' | 'deluxe' | 'suite'> = {
  'Standard King': 'standard',
  'Standard Double': 'standard',
  'Deluxe King': 'deluxe',
  Suite: 'suite',
  'Accessible King': 'standard',
}

const ALIASES: Record<string, RoomType> = {
  standard: 'Standard King',
  'standard king': 'Standard King',
  king: 'Standard King',
  'standard double': 'Standard Double',
  double: 'Standard Double',
  'double queen': 'Standard Double',
  deluxe: 'Deluxe King',
  'deluxe king': 'Deluxe King',
  suite: 'Suite',
  suites: 'Suite',
  accessible: 'Accessible King',
  'accessible king': 'Accessible King',
  ada: 'Accessible King',
}

/** Free text -> canonical room type, or null when we genuinely cannot tell.
 *  Returning null is correct behaviour: the agent must ask, not guess. */
export function normalizeRoomType(input: string | null | undefined): RoomType | null {
  if (!input) return null
  const key = input.trim().toLowerCase().replace(/\s+/g, ' ')
  if (ALIASES[key]) return ALIASES[key]
  const hit = ROOM_TYPES.find((rt) => rt.toLowerCase() === key)
  return hit ?? null
}
