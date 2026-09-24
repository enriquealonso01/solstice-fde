/** Inline marks and icons for the chat surface. No icon dependency, no sprite sheet. */

interface GlyphProps {
  className?: string
}

/**
 * The Sol mark: a low sun over a horizon line. Used at three sizes, so it is
 * drawn on a 24-unit grid with stroke widths that survive scaling down to 16px.
 */
export function SolMark({ className = 'h-5 w-5' }: GlyphProps) {
  const gradientId = 'sol-mark-gradient'
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#E8B75C" />
          <stop offset="55%" stopColor="#C8973F" />
          <stop offset="100%" stopColor="#B4541F" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="13" r="4.4" fill={`url(#${gradientId})`} />
      <g stroke={`url(#${gradientId})`} strokeWidth="1.5" strokeLinecap="round">
        <path d="M12 2.6v2.2" />
        <path d="M4.6 5.6 6.2 7.2" />
        <path d="M19.4 5.6 17.8 7.2" />
        <path d="M2.2 13h2.2" />
        <path d="M19.6 13h2.2" />
      </g>
      <path
        d="M2.2 20.4h19.6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.35"
      />
    </svg>
  )
}

export function ChevronDownIcon({ className = 'h-4 w-4' }: GlyphProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true" focusable="false">
      <path
        d="M4 6.5 8 10.5l4-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function CloseIcon({ className = 'h-4 w-4' }: GlyphProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true" focusable="false">
      <path
        d="M4 4l8 8M12 4l-8 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function SendIcon({ className = 'h-4 w-4' }: GlyphProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true" focusable="false">
      <path
        d="M8 13.5V3M8 3 3.75 7.25M8 3l4.25 4.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function MicIcon({ className = 'h-4 w-4' }: GlyphProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true" focusable="false">
      <rect x="6" y="1.75" width="4" height="7.5" rx="2" fill="currentColor" />
      <path
        d="M3.75 7.25a4.25 4.25 0 0 0 8.5 0M8 11.5v2.75"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function StopIcon({ className = 'h-4 w-4' }: GlyphProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true" focusable="false">
      <rect x="4.5" y="4.5" width="7" height="7" rx="1.6" fill="currentColor" />
    </svg>
  )
}

export function CheckIcon({ className = 'h-3 w-3' }: GlyphProps) {
  return (
    <svg viewBox="0 0 12 12" className={className} aria-hidden="true" focusable="false">
      <path
        d="M2.5 6.4 4.9 8.8 9.5 3.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function AlertIcon({ className = 'h-4 w-4' }: GlyphProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 4.8v3.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="11.1" r="0.85" fill="currentColor" />
    </svg>
  )
}

/** The small marker that precedes a policy reference. */
export function CitationIcon({ className = 'h-3 w-3' }: GlyphProps) {
  return (
    <svg viewBox="0 0 12 12" className={className} aria-hidden="true" focusable="false">
      <path
        d="M2.5 2.2h4.2l2.8 2.8v4.8a.8.8 0 0 1-.8.8H2.5a.8.8 0 0 1-.8-.8V3a.8.8 0 0 1 .8-.8Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path d="M6.6 2.3V5h2.7" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  )
}
