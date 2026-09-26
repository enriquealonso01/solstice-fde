/**
 * The files that ship: `git ls-files` in a clone, a `.gitignore`-filtered walk in a ZIP download
 * (which has no `.git`, so a bare git call would throw while the test file is being collected).
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/** Patterns from `.gitignore`, reduced to the shapes this repo uses: directories, globbed directories, suffixes, names. */
interface Ignore {
  dirs: string[]
  dirPatterns: RegExp[]
  names: string[]
  suffixes: string[]
}

function readIgnore(repoRoot: string): Ignore {
  let lines: string[] = []
  try {
    lines = readFileSync(join(repoRoot, '.gitignore'), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
  } catch {
    // No .gitignore: the hardcoded directories below are the ones that matter.
  }

  const ignore: Ignore = { dirs: ['.git', 'node_modules', 'dist', '.netlify'], dirPatterns: [], names: [], suffixes: [] }
  for (const line of lines) {
    if (line.endsWith('/')) {
      const name = line.slice(0, -1)
      if (name.includes('*')) {
        const escaped = name.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')
        ignore.dirPatterns.push(new RegExp(`^${escaped}$`))
      } else ignore.dirs.push(name)
    } else if (line.startsWith('*.')) ignore.suffixes.push(line.slice(1))
    else ignore.names.push(line)
  }
  return ignore
}

function walk(repoRoot: string, ignore: Ignore): string[] {
  const out: string[] = []
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (ignore.dirs.includes(entry.name) || ignore.dirPatterns.some((p) => p.test(entry.name))) continue
        visit(full)
      } else if (entry.isFile()) {
        if (ignore.names.includes(entry.name) || ignore.suffixes.some((s) => entry.name.endsWith(s))) continue
        out.push(relative(repoRoot, full).split('\\').join('/'))
      }
    }
  }
  visit(repoRoot)
  return out.sort()
}

/** Every file that ships, as repo-relative paths with forward slashes. */
export function shippedFiles(repoRoot: string): string[] {
  const root = resolve(repoRoot)
  try {
    const out = execFileSync('git', ['ls-files', '-z'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const files = out.split('\0').filter(Boolean).sort()
    if (files.length > 0) return files
  } catch {
    // Not a clone, or git is not installed.
  }
  return walk(root, readIgnore(root))
}
