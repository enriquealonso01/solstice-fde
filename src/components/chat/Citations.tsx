/**
 * Inline references under an answer.
 *
 * Deliberately quiet: a guest reads the answer, not the footnotes. But the
 * sources are one glance away, which is the difference between an assistant
 * that knows the cancellation policy and one that sounds like it does.
 */
import { CitationIcon } from './glyphs'
import type { Citation } from './types'

const SOURCE_WORD: Record<Citation['source'], string> = {
  policy: 'Policy',
  property: 'Property',
  reservation: 'Reservation',
  guest: 'Profile',
  inquiry: 'Inquiry',
}

export function Citations({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return null

  return (
    <div className="mt-2.5 border-t border-line/70 pt-2">
      <p className="mb-1 text-[10px] uppercase tracking-[0.14em] text-muted/70">Sources</p>
      <ul className="flex flex-col gap-1">
        {citations.map((citation) => (
          <li key={citation.ref}>
            <span
              className="group inline-flex max-w-full items-start gap-1.5 text-[11px] leading-snug text-muted"
              title={citation.ref}
            >
              <CitationIcon className="mt-[2px] h-3 w-3 shrink-0 text-accent" />
              <span className="min-w-0">
                <span className="font-medium text-muted">{SOURCE_WORD[citation.source]}</span>
                <span className="mx-1 text-muted/50">&middot;</span>
                <span className="break-words">{citation.label}</span>
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
