// A relative link in a shipped Markdown file must resolve, the way GitHub resolves it: from the
// linking document's own directory.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { shippedFiles } from './shippedFiles'

const repoRoot = resolve(__dirname, '../../../..')

// plans/ holds build-time working notes, not reader-facing documents.
const docs = shippedFiles(repoRoot).filter((f) => f.endsWith('.md') && !f.startsWith('plans/') && existsSync(join(repoRoot, f)))

/** `[text](target)` outside code, minus absolute URLs and in-page anchors. */
function relativeLinks(markdown: string): string[] {
  const prose = markdown.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
  return [...prose.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)]
    .map((m) => m[1])
    .filter((t) => !/^(https?:|mailto:|tel:|#)/.test(t))
}

describe('relative links in shipped Markdown', () => {
  it('resolve to files that exist', () => {
    expect(docs.length, 'no Markdown files found, so this would pass vacuously').toBeGreaterThan(5)
    const broken: string[] = []
    for (const doc of docs) {
      for (const target of relativeLinks(readFileSync(join(repoRoot, doc), 'utf8'))) {
        const path = decodeURIComponent(target.split('#')[0])
        if (path && !existsSync(resolve(dirname(join(repoRoot, doc)), path))) broken.push(`${doc} -> ${target}`)
      }
    }
    expect(broken, `Broken relative links:\n${broken.join('\n')}`).toEqual([])
  })
})
