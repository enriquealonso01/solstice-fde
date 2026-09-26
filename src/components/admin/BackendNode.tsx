// A node on the backend map. Every one names a real provider and carries the
// "why this over the alternative" line, because this surface is narrated live to a
// technical panel and the follow-up question is always "why not X".
//
// Sized and weighted for a projector: no text under 12px, no low-contrast greys.

import { Handle, Position, type NodeProps } from 'reactflow'

export type MapLayer = 'guest' | 'runtime' | 'tools' | 'data' | 'delivery' | 'staff' | 'deploy'
export type MapStatus = 'live' | 'pending' | 'blocked'

export interface BackendNodeData {
  provider: string
  title: string
  detail: string
  why?: string
  layer: MapLayer
  status?: MapStatus
}

const LAYER: Record<MapLayer, { ring: string; chip: string; bar: string }> = {
  guest: { ring: 'border-info-ring', chip: 'bg-info-soft text-info', bar: 'bg-info' },
  runtime: { ring: 'border-accent/50', chip: 'bg-accent/15 text-accent', bar: 'bg-accent' },
  tools: { ring: 'border-agent-ring', chip: 'bg-agent-soft text-agent', bar: 'bg-agent' },
  data: { ring: 'border-good-ring', chip: 'bg-good-soft text-good', bar: 'bg-good-soft' },
  delivery: { ring: 'border-warn-ring', chip: 'bg-warn-soft text-warn', bar: 'bg-warn-soft0' },
  staff: { ring: 'border-accent/60', chip: 'bg-accent/20 text-ink', bar: 'bg-accent' },
  deploy: { ring: 'border-line', chip: 'bg-line text-ink', bar: 'bg-faint' },
}

const STATUS: Record<MapStatus, { label: string; cls: string }> = {
  live: { label: 'live', cls: 'bg-good-soft text-good' },
  pending: { label: 'pending', cls: 'bg-warn-soft text-warn' },
  blocked: { label: 'blocked', cls: 'bg-bad-soft text-bad' },
}

export default function BackendNode({ data }: NodeProps<BackendNodeData>) {
  const l = LAYER[data.layer]
  return (
    <div className={`w-[300px] overflow-hidden rounded-lg border-2 bg-card shadow-sm ${l.ring}`}>
      <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-2 !border-card !bg-faint" />
      <div className={`h-1.5 w-full ${l.bar}`} />
      <div className="px-3.5 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className={`inline-flex rounded-full px-2 py-0.5 text-[12px] font-semibold uppercase tracking-wide ${l.chip}`}>
            {data.provider}
          </span>
          {data.status ? (
            <span className={`inline-flex rounded-full px-2 py-0.5 text-[12px] font-medium ${STATUS[data.status].cls}`}>
              {STATUS[data.status].label}
            </span>
          ) : null}
        </div>

        <h3 className="mt-2 font-display text-[19px] leading-tight text-ink">{data.title}</h3>
        <p className="mt-1 text-[13px] leading-snug text-muted">{data.detail}</p>

        {data.why ? (
          <p className="mt-2.5 rounded border-l-[3px] border-accent/70 bg-canvas px-2.5 py-1.5 text-[13px] leading-snug text-ink">
            <span className="font-semibold">Why: </span>
            {data.why}
          </p>
        ) : null}
      </div>
      <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-2 !border-card !bg-faint" />
    </div>
  )
}
