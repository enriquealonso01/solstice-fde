/**
 * A tool call, visible to the guest while it runs.
 *
 * This is the "not a black box" surface: the chip appears the moment the agent
 * starts a tool, and resolves in place when the tool returns. What the panel
 * sees is that every claim downstream of it came from somewhere.
 */
import { CheckIcon } from './glyphs'
import { toolLabel } from './toolLabels'
import type { ToolActivity } from './types'

export function ToolChip({ tool }: { tool: ToolActivity }) {
  const running = tool.status === 'running'
  const label = toolLabel(tool.name, tool.summary)
  const elapsed = tool.endedAt ? tool.endedAt - tool.startedAt : undefined

  return (
    <li
      className={[
        'sol-rise flex items-center gap-2 rounded-full border py-1 pl-1.5 pr-3 text-[11px] leading-none transition-colors duration-300',
        running
          ? 'border-accent/45 bg-accent/10 text-muted'
          : 'border-line bg-card text-muted',
      ].join(' ')}
    >
      <span
        className={[
          'grid h-4 w-4 shrink-0 place-items-center rounded-full',
          running ? 'bg-accent/25 text-accent' : 'bg-line/70 text-muted',
        ].join(' ')}
      >
        {running ? <Spinner /> : <CheckIcon className="h-2.5 w-2.5" />}
      </span>

      <span className={running ? 'font-medium' : ''}>{label}</span>

      {elapsed !== undefined && elapsed > 0 ? (
        <span className="tabular-nums text-[10px] text-muted/60">
          {formatElapsed(elapsed)}
        </span>
      ) : null}
    </li>
  )
}

function Spinner() {
  return (
    <svg viewBox="0 0 16 16" className="h-2.5 w-2.5 animate-spin motion-reduce:animate-none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path
        d="M8 2a6 6 0 0 1 6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

function formatElapsed(ms: number): string {
  if (ms < 950) return String(Math.round(ms / 10) / 100).replace(/^0/, '') + 's'
  return (ms / 1000).toFixed(1) + 's'
}

/** The tool trace for one agent turn. */
export function ToolTrace({ tools }: { tools: ToolActivity[] }) {
  if (tools.length === 0) return null
  const running = tools.filter((tool) => tool.status === 'running').length

  return (
    <ul
      className="mb-2 flex flex-wrap gap-1.5"
      aria-label={
        running > 0
          ? 'Sol is running ' + String(running) + ' step' + (running === 1 ? '' : 's')
          : 'Steps Sol ran for this answer'
      }
    >
      {tools.map((tool) => (
        <ToolChip key={tool.key} tool={tool} />
      ))}
    </ul>
  )
}
