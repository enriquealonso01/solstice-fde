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
  guest: { ring: 'border-sky-300', chip: 'bg-sky-100 text-sky-900', bar: 'bg-sky-400' },
  runtime: { ring: 'border-solstice-ember/50', chip: 'bg-solstice-ember/15 text-solstice-ember', bar: 'bg-solstice-ember' },
  tools: { ring: 'border-violet-300', chip: 'bg-violet-100 text-violet-900', bar: 'bg-violet-400' },
  data: { ring: 'border-emerald-300', chip: 'bg-emerald-100 text-emerald-900', bar: 'bg-emerald-500' },
  delivery: { ring: 'border-amber-300', chip: 'bg-amber-100 text-amber-900', bar: 'bg-amber-500' },
  staff: { ring: 'border-solstice-gold/60', chip: 'bg-solstice-gold/20 text-solstice-ink', bar: 'bg-solstice-gold' },
  deploy: { ring: 'border-slate-300', chip: 'bg-slate-100 text-slate-800', bar: 'bg-slate-400' },
}

const STATUS: Record<MapStatus, { label: string; cls: string }> = {
  live: { label: 'live', cls: 'bg-emerald-100 text-emerald-900' },
  pending: { label: 'pending', cls: 'bg-amber-100 text-amber-900' },
  blocked: { label: 'blocked', cls: 'bg-rose-100 text-rose-900' },
}

export default function BackendNode({ data }: NodeProps<BackendNodeData>) {
  const l = LAYER[data.layer]
  return (
    <div className={`w-[300px] overflow-hidden rounded-lg border-2 bg-white shadow-sm ${l.ring}`}>
      <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-2 !border-white !bg-solstice-stone" />
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

        <h3 className="mt-2 font-display text-[19px] leading-tight text-solstice-ink">{data.title}</h3>
        <p className="mt-1 text-[13px] leading-snug text-solstice-slate">{data.detail}</p>

        {data.why ? (
          <p className="mt-2.5 rounded border-l-[3px] border-solstice-ember/70 bg-solstice-cream px-2.5 py-1.5 text-[13px] leading-snug text-solstice-ink">
            <span className="font-semibold">Why: </span>
            {data.why}
          </p>
        ) : null}
      </div>
      <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-2 !border-white !bg-solstice-stone" />
    </div>
  )
}
