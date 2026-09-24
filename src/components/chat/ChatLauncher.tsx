import { forwardRef } from 'react'
import { SolMark } from './glyphs'

interface ChatLauncherProps {
  onClick: () => void
  /** An answer arrived while the panel was closed. */
  unread: boolean
  panelId: string
}

/**
 * The closed state.
 *
 * Not a bouncing speech balloon. It reads as a concierge bell pull: a dark pill
 * with a warm mark, a name, and a promise about availability. It has to survive
 * sitting on top of a hotel page for the whole demo without becoming noise.
 */
export const ChatLauncher = forwardRef<HTMLButtonElement, ChatLauncherProps>(
  function ChatLauncher({ onClick, unread, panelId }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        aria-expanded={false}
        aria-controls={panelId}
        className="group sol-rise relative flex items-center gap-2.5 rounded-full border border-solstice-gold/30 bg-solstice-ink py-2 pl-2 pr-4 text-left shadow-[0_18px_40px_-18px_rgba(20,18,16,0.7)] transition duration-200 hover:-translate-y-0.5 hover:border-solstice-gold/60 hover:shadow-[0_22px_46px_-18px_rgba(20,18,16,0.8)] focus:outline-none focus-visible:ring-2 focus-visible:ring-solstice-gold focus-visible:ring-offset-2 focus-visible:ring-offset-solstice-cream motion-reduce:hover:translate-y-0"
      >
        <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-solstice-gold/25 to-solstice-ember/25 text-solstice-cream ring-1 ring-inset ring-solstice-gold/25">
          <SolMark className="h-5 w-5" />
          {unread ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-solstice-ember opacity-70 motion-safe:animate-ping" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-solstice-ember ring-2 ring-solstice-ink" />
            </span>
          ) : null}
        </span>

        <span className="flex flex-col leading-tight">
          <span className="font-display text-[15px] tracking-tight text-solstice-cream">Ask Sol</span>
          <span className="text-[10.5px] uppercase tracking-[0.13em] text-solstice-cream/55 transition group-hover:text-solstice-gold/90">
            Concierge, any hour
          </span>
        </span>
      </button>
    )
  },
)
