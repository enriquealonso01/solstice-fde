import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

/* ------------------------------------------------------------------ *
 * prefers-reduced-motion                                               *
 * ------------------------------------------------------------------ */

/**
 * `.sol-rise` and `.sol-dot` already opt out of animation in CSS. This is for
 * the motion we drive in JS, above all the character-by-character reveal, which
 * no media query can reach.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return reduced
}

/* ------------------------------------------------------------------ *
 * Focus trap                                                           *
 * ------------------------------------------------------------------ */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * Keeps Tab inside the panel while it is open. Escape is the deliberate way
 * out, handled by the panel itself; focus restoration is the widget's job,
 * because the launcher it returns to is unmounted while the panel is open.
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement>, active: boolean): void {
  useEffect(() => {
    if (!active) return
    const container = containerRef.current
    if (!container) return

    const focusable = (): HTMLElement[] =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => element.offsetWidth > 0 || element.offsetHeight > 0 || element === document.activeElement,
      )

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const elements = focusable()
      if (elements.length === 0) {
        event.preventDefault()
        container.focus()
        return
      }
      const first = elements[0]
      const last = elements[elements.length - 1]
      const current = document.activeElement

      if (event.shiftKey && (current === first || current === container || !container.contains(current))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && current === last) {
        event.preventDefault()
        first.focus()
      }
    }

    container.addEventListener('keydown', onKeyDown)
    return () => container.removeEventListener('keydown', onKeyDown)
  }, [containerRef, active])
}

/* ------------------------------------------------------------------ *
 * Character-smooth reveal                                              *
 * ------------------------------------------------------------------ */

export interface Typewriter {
  /** Queue server text for reveal. */
  push(text: string): void
  /** Reveal everything queued, immediately. Call on `done`. */
  flush(): void
  /** Drop anything queued without revealing it. Call on `reconnect`. */
  reset(): void
}

/**
 * The server sends `delta` events in token-sized lumps at irregular intervals.
 * Rendering them raw looks like a stuttering ticker. This drains a buffer on
 * animation frames at a rate proportional to how far behind we are, so the text
 * arrives character-smooth and still never lags meaningfully behind the stream.
 */
export function useTypewriter(reveal: (chunk: string) => void, enabled: boolean): Typewriter {
  const bufferRef = useRef('')
  const frameRef = useRef<number | null>(null)
  const lastTickRef = useRef(0)
  const revealRef = useRef(reveal)
  revealRef.current = reveal

  const stop = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [])

  const tick = useCallback(
    (now: number) => {
      const elapsed = Math.min(64, now - lastTickRef.current || 16)
      lastTickRef.current = now

      const buffer = bufferRef.current
      if (buffer.length === 0) {
        frameRef.current = null
        return
      }

      // Floor of ~60 chars/sec so short replies still type; scales up with the
      // backlog so a fast server never leaves the reader waiting.
      const charsPerMs = Math.max(0.06, buffer.length / 400)
      const count = Math.max(1, Math.min(buffer.length, Math.round(charsPerMs * elapsed)))

      bufferRef.current = buffer.slice(count)
      revealRef.current(buffer.slice(0, count))

      frameRef.current = requestAnimationFrame(tick)
    },
    [],
  )

  const start = useCallback(() => {
    if (frameRef.current !== null) return
    lastTickRef.current = performance.now()
    frameRef.current = requestAnimationFrame(tick)
  }, [tick])

  useEffect(() => stop, [stop])

  return {
    push(text: string) {
      if (!text) return
      if (!enabled) {
        revealRef.current(text)
        return
      }
      bufferRef.current += text
      start()
    },
    flush() {
      stop()
      const rest = bufferRef.current
      bufferRef.current = ''
      if (rest) revealRef.current(rest)
    },
    reset() {
      stop()
      bufferRef.current = ''
    },
  }
}
