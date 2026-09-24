// Month / weekday vocabulary used when parsing seasonal windows out of free text.
// Months are 1-12 (calendar months, not JS month indexes).
// Weekdays are the three-letter names below; `WEEKDAYS.indexOf(name)` is the JS getDay() value.

export const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** 'June' | 'Jun' | 'jun' -> 6. Unknown -> null. @param {string} name */
export function monthNumber(name) {
  const key = String(name).trim().slice(0, 3).toLowerCase()
  const idx = MONTH_NAMES.findIndex((m) => m.toLowerCase() === key)
  return idx === -1 ? null : idx + 1
}

/** 'Thu' | 'Thursday' -> 4 (JS getDay). Unknown -> null. @param {string} name */
export function weekdayNumber(name) {
  const key = String(name).trim().slice(0, 3).toLowerCase()
  const idx = WEEKDAYS.findIndex((d) => d.toLowerCase() === key)
  return idx === -1 ? null : idx
}

/** Inclusive, wrapping. ('Dec','Feb') -> [12,1,2]. @param {string} a @param {string} b */
export function expandMonthRange(a, b) {
  const start = monthNumber(a)
  const end = monthNumber(b)
  if (start === null || end === null) return null
  const out = []
  let m = start
  for (let guard = 0; guard < 12; guard += 1) {
    out.push(m)
    if (m === end) return out
    m = m === 12 ? 1 : m + 1
  }
  return out
}

/** Inclusive, wrapping. ('Thu','Sun') -> ['Thu','Fri','Sat','Sun']. @param {string} a @param {string} b */
export function expandWeekdayRange(a, b) {
  const start = weekdayNumber(a)
  const end = weekdayNumber(b)
  if (start === null || end === null) return null
  const out = []
  let d = start
  for (let guard = 0; guard < 7; guard += 1) {
    out.push(WEEKDAYS[d])
    if (d === end) return out
    d = (d + 1) % 7
  }
  return out
}

export const WEEKDAY_SETS = {
  weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  weekday: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  weekends: ['Sat', 'Sun'],
  weekend: ['Sat', 'Sun'],
}

/** Parses the parenthetical of a seasonal note: 'Dec-Feb, Thu-Sun' or 'Jan-May, weekdays'.
 *  @param {string} inner @returns {{months: number[]|null, weekdays: string[]|null}} */
export function parseSeasonWindow(inner) {
  let months = null
  let weekdays = null
  for (const rawPart of String(inner).split(',')) {
    const part = rawPart.trim()
    if (part === '') continue
    const lower = part.toLowerCase()
    if (WEEKDAY_SETS[lower]) {
      weekdays = WEEKDAY_SETS[lower]
      continue
    }
    const range = part.match(/^([A-Za-z]+)\s*[-–]\s*([A-Za-z]+)$/)
    if (range) {
      const asMonths = expandMonthRange(range[1], range[2])
      const asWeekdays = expandWeekdayRange(range[1], range[2])
      // A three-letter token can be both a month and a weekday only for none of the real
      // names, so whichever parses is unambiguous. Months win if both somehow parse.
      if (asMonths && monthNumber(range[1]) !== null && weekdayNumber(range[1]) === null) {
        months = asMonths
        continue
      }
      if (asWeekdays && weekdayNumber(range[1]) !== null) {
        weekdays = asWeekdays
        continue
      }
      if (asMonths) months = asMonths
      continue
    }
    const single = monthNumber(part)
    if (single !== null && part.length >= 3) months = [single]
  }
  return { months, weekdays }
}

/** '2026-07-02 to 2026-07-06; 2026-12-28 to 2027-01-02' -> [{start,end},{start,end}].
 *  'none scheduled' -> []. Returns `unparsed` for anything we could not read, so the caller
 *  can raise a data-quality flag instead of silently dropping a blackout.
 *  @param {string|null} raw */
export function parseDateRanges(raw) {
  const text = (raw ?? '').trim()
  if (text === '' || /^none(\s+scheduled)?$/i.test(text)) return { ranges: [], unparsed: [] }
  const ranges = []
  const unparsed = []
  for (const chunk of text.split(/[;]/)) {
    const part = chunk.trim()
    if (part === '') continue
    const m = part.match(/^(\d{4}-\d{2}-\d{2})\s*(?:to|through|-|–)\s*(\d{4}-\d{2}-\d{2})$/i)
    if (m) {
      ranges.push({ start: m[1], end: m[2] })
      continue
    }
    const single = part.match(/^(\d{4}-\d{2}-\d{2})$/)
    if (single) {
      ranges.push({ start: single[1], end: single[1] })
      continue
    }
    unparsed.push(part)
  }
  return { ranges, unparsed }
}
