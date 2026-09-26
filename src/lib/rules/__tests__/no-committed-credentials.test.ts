// No shipped file may carry a real credential. Shape-based, because vitest.setup.ts strips the real
// values from the environment; a value that announces itself as fake is allowed.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { shippedFiles } from './shippedFiles'

const repoRoot = resolve(__dirname, '../../../..')

const SHAPES: { name: string; re: RegExp }[] = [
  { name: 'Telnyx SIP credential username', re: /\bgencred[A-Za-z0-9]{24,}/ },
  { name: 'Telnyx API key', re: /\bKEY[0-9A-F]{16,}/ },
  { name: 'JWT-shaped key', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{10,}/ },
  { name: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'filled demo password line', re: /Password for all three:[ \t]*(?![<$])\S{8,}[ \t]*$/ },
]

const announcesItselfFake = (line: string) => /EXAMPLE|FIXTURE|REDACTED|NotAReal|PLACEHOLDER|your-|xxxx|<[a-z_]+>/i.test(line)
const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|eot|mp3|wav|zip)$/i

describe('no real credential is committed', () => {
  const files = shippedFiles(repoRoot)

  it('carries no value shaped like a credential, except ones marked fake', () => {
    expect(files.length, 'the file list is empty, so the scan below would pass vacuously').toBeGreaterThan(100)
    const problems: string[] = []
    for (const file of files.filter((f) => !BINARY.test(f))) {
      let lines: string[]
      try {
        lines = readFileSync(join(repoRoot, file), 'utf8').split(/\r?\n/)
      } catch {
        continue
      }
      lines.forEach((line, i) => {
        for (const shape of SHAPES) {
          if (shape.re.test(line) && !announcesItselfFake(line)) problems.push(`${file}:${i + 1} looks like a ${shape.name}`)
        }
      })
    }
    expect(problems, problems.join('\n')).toEqual([])
  })

  it('does not ship .env or the generated demo login card', () => {
    expect(files).not.toContain('.env')
    expect(files).not.toContain('DEMO_LOGINS.md')
  })

  it("publishes no third party's PDF and no email address outside the sample data", () => {
    expect(files.filter((f) => f.toLowerCase().endsWith('.pdf'))).toEqual([])

    const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g
    const text = (f: string) => {
      try {
        return readFileSync(join(repoRoot, f), 'utf8')
      } catch {
        return ''
      }
    }
    // The supplied sample data's domains are fictional; anything else must be a known fixture or our own.
    const allowed = new Set([
      ...files.filter((f) => f.startsWith('data/')).flatMap((f) => [...text(f).matchAll(EMAIL)].map((m) => m[1].toLowerCase())),
      ...['solsticehotels.com', 'solsticehotels.demo', 'solsticehotels.example'], // the fictional hotel group
      ...['cypressridge.example.com', 'sip.example.com', 'b.com', 'northwindlogistics.com'], // test and demo fixtures
      ...['sip.telnyx.com', 'msgtelnyx.com'], // the telephony provider
      ...['provensolved.com', 'enriquecodes.com'], // the author's own
    ])
    const offenders = files
      .filter((f) => !f.startsWith('data/') && !BINARY.test(f) && !f.endsWith('.svg'))
      .flatMap((f) => [...text(f).matchAll(EMAIL)].filter((m) => !allowed.has(m[1].toLowerCase())).map((m) => `${f}: ${m[0]}`))
    expect(offenders).toEqual([])
  })
})
