// Minimal RFC-4180 CSV reader. No dependency, because package.json is not ours to edit
// and the four source files are small and well formed.

/** @param {string} text @returns {string[][]} */
export function parseCsvRows(text) {
  const src = text.replace(/^﻿/, '')
  /** @type {string[][]} */
  const rows = []
  /** @type {string[]} */
  let row = []
  let field = ''
  let inQuotes = false
  let i = 0

  while (i < src.length) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += ch
      i += 1
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (ch === ',') {
      row.push(field)
      field = ''
      i += 1
      continue
    }
    if (ch === '\r') {
      i += 1
      continue
    }
    if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i += 1
      continue
    }
    field += ch
    i += 1
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

/** Header row becomes object keys; every value is trimmed.
 *  @param {string} text @returns {Record<string,string>[]} */
export function parseCsvObjects(text) {
  const rows = parseCsvRows(text)
  if (rows.length === 0) return []
  const header = rows[0].map((h) => h.trim())
  return rows.slice(1).map((r) => {
    /** @type {Record<string,string>} */
    const obj = {}
    header.forEach((h, idx) => {
      obj[h] = (r[idx] ?? '').trim()
    })
    return obj
  })
}

/** '' -> null, otherwise the trimmed string. @param {string|undefined} v */
export function str(v) {
  const t = (v ?? '').trim()
  return t === '' ? null : t
}

/** '' or non-numeric -> null. @param {string|undefined} v */
export function num(v) {
  const t = (v ?? '').trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** 'Y'/'Yes'/'true' -> true. @param {string|undefined} v */
export function bool(v) {
  const t = (v ?? '').trim().toLowerCase()
  return t === 'y' || t === 'yes' || t === 'true' || t === '1'
}
