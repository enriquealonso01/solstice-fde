// Writes netlify/functions/tools/solPrompt.ts from the SOL:SYSTEM block in agent/sol.md.
//
//   node scripts/gen-sol-prompt.mjs        (runs as `prebuild`, so every build and deploy does it)
//
// The generated file is committed so a fresh clone typechecks and tests without a build.
// scripts/telnyx/provision.mjs compiles the voice assistant's instructions from the same block.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOL_MD = join(ROOT, 'agent', 'sol.md')
const OUT = join(ROOT, 'netlify', 'functions', 'tools', 'solPrompt.ts')

const BEGIN = '<!-- SOL:SYSTEM:BEGIN -->'
const END = '<!-- SOL:SYSTEM:END -->'

/** The runtime system prompt: the text between the markers, trimmed, with LF line endings. */
export function extractSolSystem(markdown) {
  const md = markdown.replace(/\r\n?/g, '\n')
  const start = md.indexOf(BEGIN)
  const end = md.indexOf(END)
  if (start < 0 || end < start) throw new Error(`agent/sol.md has no ${BEGIN} ... ${END} block.`)
  const block = md.slice(start + BEGIN.length, end).trim()
  if (!block) throw new Error('The SOL:SYSTEM block in agent/sol.md is empty.')
  return block
}

function render(block) {
  const literal = block.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
  return [
    '// GENERATED from agent/sol.md by scripts/gen-sol-prompt.mjs — do not edit.',
    '// Change the SOL:SYSTEM block in agent/sol.md; `npm run build` regenerates this file.',
    '',
    `export const SOL_SYSTEM_PROMPT = \`${literal}\``,
    '',
  ].join('\n')
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const block = extractSolSystem(readFileSync(SOL_MD, 'utf8'))
  writeFileSync(OUT, render(block))
  console.log(`netlify/functions/tools/solPrompt.ts: ${block.length} chars from agent/sol.md`)
}
