/**
 * The set of files that ship, resolved with or without git.
 *
 * Three guards asked git for that set: the credential scan, the repo-floor counts and the suite-integrity
 * check. That is correct here and wrong for a reviewer, because **GitHub's "Download ZIP" produces a tree
 * with no `.git`**, and `execFileSync('git', …)` then throws while the test file is still being collected.
 * Measured at iteration 137 in a copy of the 262 tracked files with `.git` removed: three files failed to
 * collect and vitest reported `Tests no tests`. The credential guard lost all twelve of its assertions and
 * printed a git error in place of a credential result.
 *
 * `README.md` tells a reviewer to run `npx vitest run` for the live test count, and the floors exist so
 * they can check the README's own numbers. A suite that goes red because they did not use `git clone` is a
 * bad answer to an invitation we issued.
 *
 * So: prefer git, because in a clone it is the exact answer and it excludes untracked scratch files. Fall
 * back to walking the tree with `.gitignore` applied, which in a ZIP is the same set by construction — the
 * archive contains what was tracked. `filesAreFromGit` is exported so a caller can say which it used, and
 * so one test can assert the two agree wherever both are available.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/** Patterns from `.gitignore`, reduced to the three shapes this repo actually uses. */
interface Ignore {
  dirs: string[]
  /** Directory patterns containing a `*`, compiled. `.gitignore` may glob; git honours it, so must we. */
  dirPatterns: RegExp[]
  names: string[]
  suffixes: string[]
}

/** `.scratch-*` -> /^\.scratch-[^/]*$/ . Only `*` is supported, which is all this .gitignore uses. */
function dirPattern(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')
  return new RegExp(`^${escaped}$`)
}

function readIgnore(repoRoot: string): Ignore {
  let lines: string[] = []
  try {
    lines = readFileSync(join(repoRoot, '.gitignore'), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
  } catch {
    // No .gitignore is survivable: the hardcoded directories below are the ones that matter.
  }

  const dirs = ['.git', 'node_modules', 'dist', '.netlify']
  const dirPatterns: RegExp[] = []
  const names: string[] = []
  const suffixes: string[] = []

  for (const line of lines) {
    if (line.endsWith('/')) {
      const name = line.slice(0, -1)
      // A trailing-slash line may be a glob. Reading it as a literal name was silently wrong: the
      // walk kept descending into `.scratch-it160/` while git ignored it, so the two disagreed about
      // what ships -- the one thing this module exists to prevent. Found at iteration 160, by the
      // .gitignore line added that iteration failing to take effect in the walk.
      if (name.includes('*')) dirPatterns.push(dirPattern(name))
      else dirs.push(name)
    } else if (line.startsWith('*.')) suffixes.push(line.slice(1))
    else names.push(line)
  }
  return { dirs: [...new Set(dirs)], dirPatterns, names, suffixes }
}

function walk(repoRoot: string, ignore: Ignore): string[] {
  const out: string[] = []

  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (ignore.dirs.includes(entry.name)) continue
        if (ignore.dirPatterns.some((p) => p.test(entry.name))) continue
        visit(full)
        continue
      }
      if (!entry.isFile()) continue
      if (ignore.names.includes(entry.name)) continue
      if (ignore.suffixes.some((s) => entry.name.endsWith(s))) continue
      out.push(relative(repoRoot, full).split('\\').join('/'))
    }
  }

  visit(repoRoot)
  return out.sort()
}

export interface ShippedFiles {
  files: string[]
  /** True when git answered. False means the tree is not a clone -- a ZIP download, most likely. */
  fromGit: boolean
}

/** Every file that ships, newest answer first: git if it can, a filtered walk if it cannot. */
export function shippedFiles(repoRoot: string): ShippedFiles {
  const root = resolve(repoRoot)
  try {
    const out = execFileSync('git', ['ls-files', '-z'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const files = out.split('\0').filter(Boolean).sort()
    // An empty answer from a successful git call would be a silent hole, so treat it as a failure.
    if (files.length > 0) return { files, fromGit: true }
  } catch {
    // Not a clone, or git is not installed. Both are ordinary for someone reviewing a ZIP.
  }
  return { files: walk(root, readIgnore(root)), fromGit: false }
}

/** The walk on its own, so a test can compare it against git where both are available. */
export function walkedFiles(repoRoot: string): string[] {
  const root = resolve(repoRoot)
  return walk(root, readIgnore(root))
}

/** True when this tree is a git clone, which is what suite-integrity needs to know. */
export function isGitClone(repoRoot: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: resolve(repoRoot),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return true
  } catch {
    return false
  }
}
