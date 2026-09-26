// A deliberately small markdown renderer for agent replies.
//
// Sol answers in markdown: bold for the option headings, bullets for the verdicts. Rendering
// that as pre-wrapped plain text showed the reader raw ** and - characters, which reads as broken.
// A full markdown library is a lot of bytes for bold, lists and paragraphs, and every one of them
// wants to render raw HTML. This builds React elements instead, so nothing can inject markup.
import { Fragment, type ReactNode } from 'react'

/** Inline: **bold**, *italic*, `code`. Applied in one pass so nesting cannot desync. */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  const pattern = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0

  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const token = m[0]
    const key = `${keyPrefix}-i${i++}`
    if (token.startsWith('**')) {
      out.push(
        <strong key={key} className="font-semibold text-ink">
          {token.slice(2, -2)}
        </strong>,
      )
    } else if (token.startsWith('`')) {
      out.push(
        <code key={key} className="rounded bg-line/60 px-1 py-0.5 font-mono text-[0.85em]">
          {token.slice(1, -1)}
        </code>,
      )
    } else {
      out.push(
        <em key={key} className="italic">
          {token.slice(1, -1)}
        </em>,
      )
    }
    last = m.index + token.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const BULLET = /^\s*[-*•]\s+(.*)$/
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/

export default function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let para: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let k = 0

  const flushPara = () => {
    if (!para.length) return
    blocks.push(
      <p key={`p${k++}`} className="whitespace-pre-wrap">
        {inline(para.join('\n'), `p${k}`)}
      </p>,
    )
    para = []
  }

  const flushList = () => {
    if (!list) return
    const items = list.items.map((item, idx) => (
      <li key={idx} className="pl-1">
        {inline(item, `l${k}-${idx}`)}
      </li>
    ))
    blocks.push(
      list.ordered ? (
        <ol key={`l${k++}`} className="list-decimal space-y-1 pl-5">
          {items}
        </ol>
      ) : (
        <ul key={`l${k++}`} className="list-disc space-y-1 pl-5 marker:text-muted">
          {items}
        </ul>
      ),
    )
    list = null
  }

  for (const line of lines) {
    const bullet = BULLET.exec(line)
    const numbered = NUMBERED.exec(line)

    if (bullet) {
      flushPara()
      if (!list || list.ordered) {
        flushList()
        list = { ordered: false, items: [] }
      }
      list.items.push(bullet[1])
      continue
    }
    if (numbered) {
      flushPara()
      if (!list || !list.ordered) {
        flushList()
        list = { ordered: true, items: [] }
      }
      list.items.push(numbered[2])
      continue
    }
    if (!line.trim()) {
      flushPara()
      flushList()
      continue
    }
    flushList()
    para.push(line)
  }
  flushPara()
  flushList()

  return <div className="space-y-2 leading-relaxed">{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>
}
