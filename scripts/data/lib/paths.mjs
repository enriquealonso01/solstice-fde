import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url)) // <root>/scripts/data/lib
export const repoRoot = resolve(here, '..', '..', '..')
export const dataDir = resolve(repoRoot, 'data')
export const generatedDir = resolve(dataDir, 'generated')
export const libDir = resolve(repoRoot, 'netlify', 'functions', '_lib')

export const SOURCE_FILES = {
  properties: resolve(dataDir, 'solstice-properties.csv'),
  guests: resolve(dataDir, 'solstice-guest-profiles.csv'),
  inquiries: resolve(dataDir, 'solstice-group-inquiries.csv'),
  policies: resolve(dataDir, 'SOLSTICE HOTEL GROUP — FRONT DESK POLICY REFERENCE.md'),
}
