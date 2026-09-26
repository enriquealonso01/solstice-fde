// The technical presentation surface.
//
// Enrique narrates this live to a panel, so it optimises for being read from across a
// room: large type, thick edges, one subsystem per tab, and a "why this over the
// alternative" line on every node that had a real alternative.
//
// The model is src/components/admin/backendMapModel.ts. Changing a decision is a text
// edit in one file, which is the point: the panel can ask us to change something live.

import { useMemo, useState } from 'react'
import ReactFlow, { Background, BackgroundVariant, Controls, MiniMap, type NodeTypes } from 'reactflow'
import 'reactflow/dist/style.css'
import AdminShell from '@/components/admin/AdminShell'
import BackendNode, { type MapLayer } from '@/components/admin/BackendNode'
import { MAP_TABS } from '@/components/admin/backendMapModel'
import FailureInjection from '@/components/admin/FailureInjection'

const LEGEND: { layer: MapLayer; label: string; dot: string }[] = [
  { layer: 'guest', label: 'Guest surface', dot: 'bg-info' },
  { layer: 'runtime', label: 'Agent runtime', dot: 'bg-accent' },
  { layer: 'tools', label: 'Tool layer', dot: 'bg-agent' },
  { layer: 'data', label: 'Data', dot: 'bg-good-soft' },
  { layer: 'delivery', label: 'Delivery', dot: 'bg-warn-soft0' },
  { layer: 'staff', label: 'Staff surface', dot: 'bg-accent' },
  { layer: 'deploy', label: 'Deploy', dot: 'bg-faint' },
]

export default function BackendMap() {
  const [tabId, setTabId] = useState(MAP_TABS[0].id)
  const [tall, setTall] = useState(false)
  const tab = useMemo(() => MAP_TABS.find((t) => t.id === tabId) ?? MAP_TABS[0], [tabId])

  // React Flow re-registers node types on every identity change; memoise it once.
  const nodeTypes = useMemo<NodeTypes>(() => ({ backend: BackendNode }), [])

  const providers = useMemo(() => {
    const seen = new Set<string>()
    for (const t of MAP_TABS) for (const n of t.nodes) seen.add(n.data.provider)
    return [...seen].sort()
  }, [])

  return (
    <AdminShell
      title="How it works"
      subtitle="Every box names the real provider. Every choice with a plausible alternative says why we did not take it."
      actions={
        <button type="button" className="btn-ghost" onClick={() => setTall((v) => !v)}>
          {tall ? 'Normal height' : 'Presentation height'}
        </button>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {MAP_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTabId(t.id)}
            className={`rounded-md px-3.5 py-2 text-sm font-medium transition ${
              t.id === tabId
                ? 'bg-hero text-on-accent'
                : 'border border-line bg-card text-muted hover:bg-line/40'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <p className="mb-3 max-w-4xl text-[15px] leading-relaxed text-muted">{tab.blurb}</p>

      <div
        className="panel overflow-hidden"
        style={{ height: tall ? 'calc(100vh - 13rem)' : 'calc(100vh - 22rem)', minHeight: '32rem' }}
      >
        <ReactFlow
          key={tab.id}
          nodes={tab.nodes}
          edges={tab.edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.12 }}
          minZoom={0.15}
          maxZoom={2}
          nodesDraggable={false}
          nodesConnectable={false}
          proOptions={{ hideAttribution: false }}
          className="bg-canvas"
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} color="#D8CFC2" />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            nodeColor={(node) => MINIMAP_COLOR[(node.data as { layer: MapLayer }).layer] ?? '#6B625A'}
            maskColor="rgba(120, 110, 95, 0.2)"
            className="!border !border-line"
          />
        </ReactFlow>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted">
        {LEGEND.map((l) => (
          <span key={l.layer} className="inline-flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${l.dot}`} />
            {l.label}
          </span>
        ))}
        <span className="ml-auto text-xs">
          Providers on this map: {providers.join(' · ')}
        </span>
      </div>
          <FailureInjection />
    </AdminShell>
  )
}

const MINIMAP_COLOR: Record<MapLayer, string> = {
  guest: '#7DD3FC',
  runtime: '#B4541F',
  tools: '#A78BFA',
  data: '#34D399',
  delivery: '#F59E0B',
  staff: '#C8973F',
  deploy: '#94A3B8',
}
