// Loads .env for the standalone node scripts. Netlify injects env vars itself, so this is
// only for local runs. No dotenv dependency: package.json is not ours to edit.

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { repoRoot } from './paths.mjs'

let loaded = false

/** Populates process.env from .env without overwriting anything already set. */
export function loadEnv() {
  if (loaded) return
  loaded = true
  const file = resolve(repoRoot, '.env')
  if (!existsSync(file)) return
  try {
    for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim()
      if (line === '' || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq <= 0) continue
      const key = line.slice(0, eq).trim()
      let value = line.slice(eq + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (process.env[key] === undefined) process.env[key] = value
    }
  } catch (err) {
    console.warn(`[env] could not read .env: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** @param {string} name @param {string} [hint] */
export function requireEnv(name, hint) {
  loadEnv()
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}.` +
        (hint ? `\n  ${hint}` : '') +
        `\n  Set it in ${resolve(repoRoot, '.env')} (see .env.example) or export it in your shell.`,
    )
  }
  return value
}
