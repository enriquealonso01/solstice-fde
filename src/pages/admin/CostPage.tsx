// What this costs. Admin only.
//
// Built for the question a hotel CFO actually asks: not "what is a token", but "what is the bill
// at 140 properties, and which part of it grows when we get busier". Measured figures and
// assumptions are visually distinct, because a cost page that cannot tell you which is which is
// worse than no cost page.
import { useEffect, useMemo, useState } from 'react'
import AdminShell from '@/components/admin/AdminShell'
import { CollapsiblePanel, EmptyState, Panel, PanelHeader } from '@/components/admin/ui'
import { accessToken } from '@/components/admin/useAdminData'
import { CACHE_MULTIPLIERS, RATES_VERIFIED_ON, type Rate } from '../../../shared/costRates'

interface ModelRow {
  model: string
  turns: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  usd: number | null
  cache_hit_ratio: number
  rate: { input: number; output: number } | null
}

interface CostResponse {
  ok: boolean
  measured_since: string | null
  models: ModelRow[]
  totals: { model_usd: number; telephony_usd: number; email_usd: number; all_usd: number }
  traffic: {
    voice_sessions: number
    chat_sessions: number
    conversations: number
    call_minutes: number
    proposals_sent: number
    cost_per_conversation: number
  }
  telnyx: { balance: number; currency: string } | null
  projection: {
    properties: number
    conversations_per_property_per_day: number
    conversations_per_month: number
    variable_usd: number
    fixed_usd: number
    total_usd: number
    per_property_usd: number
  }
  rate_card: {
    telnyx: Record<string, Rate>
    platform: Record<string, Rate>
    models: Record<string, { input: number; output: number }>
  }
  error?: string
}

const usd = (n: number, dp = 2) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: dp, maximumFractionDigits: dp })
const num = (n: number) => n.toLocaleString('en-US')

function Basis({ basis }: { basis: 'verified' | 'assumption' }) {
  return basis === 'verified' ? (
    <span className="chip bg-emerald-50 text-emerald-800">published price</span>
  ) : (
    <span className="chip bg-amber-50 text-amber-900">our estimate</span>
  )
}

export default function CostPage() {
  const [data, setData] = useState<CostResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [properties, setProperties] = useState(140)
  const [perDay, setPerDay] = useState(40)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const token = await accessToken()
        const res = await fetch(`/api/cost?properties=${properties}&per_day=${perDay}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        const body = (await res.json()) as CostResponse
        if (!alive) return
        if (!res.ok || !body.ok) return setError(body.error ?? `Request failed (${res.status})`)
        setData(body)
        setError(null)
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Could not load costs.')
      }
    })()
    return () => {
      alive = false
    }
  }, [properties, perDay])

  const biggestDriver = useMemo(() => {
    if (!data) return null
    const parts = [
      { label: 'the language model', usd: data.totals.model_usd },
      { label: 'telephony', usd: data.totals.telephony_usd },
      { label: 'email', usd: data.totals.email_usd },
    ]
    return parts.sort((a, b) => b.usd - a.usd)[0]
  }, [data])

  if (error) {
    return (
      <AdminShell title="Cost">
        <Panel>
          <EmptyState title="Cannot show costs" body={error} />
        </Panel>
      </AdminShell>
    )
  }

  if (!data) {
    return (
      <AdminShell title="Cost">
        <Panel>
          <EmptyState title="Measuring…" />
        </Panel>
      </AdminShell>
    )
  }

  const { traffic, totals, projection } = data

  return (
    <AdminShell
      title="Cost"
      subtitle={
        <span className="text-solstice-stone">
          Measured from real usage{data.measured_since ? ` since ${data.measured_since.slice(0, 10)}` : ''}. Rates
          checked {RATES_VERIFIED_ON}.
        </span>
      }
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="p-5">
          <p className="text-xs uppercase tracking-wide text-solstice-stone">Spent so far</p>
          <p className="mt-1 font-display text-4xl text-solstice-ink">{usd(totals.all_usd, 2)}</p>
          <p className="mt-2 text-sm text-solstice-slate">
            Across {num(traffic.conversations)} conversations. Mostly {biggestDriver?.label}.
          </p>
        </Panel>
        <Panel className="p-5">
          <p className="text-xs uppercase tracking-wide text-solstice-stone">Per conversation</p>
          <p className="mt-1 font-display text-4xl text-solstice-ink">{usd(traffic.cost_per_conversation, 4)}</p>
          <p className="mt-2 text-sm text-solstice-slate">
            This is the number that scales. Everything else is roughly fixed.
          </p>
        </Panel>
        <Panel className="p-5">
          <p className="text-xs uppercase tracking-wide text-solstice-stone">Telnyx balance</p>
          <p className="mt-1 font-display text-4xl text-solstice-ink">
            {data.telnyx ? usd(data.telnyx.balance) : '—'}
          </p>
          <p className="mt-2 text-sm text-solstice-slate">Live from the Telnyx API, not an estimate.</p>
        </Panel>
      </div>

      {/* projection */}
      <Panel className="mt-4">
        <PanelHeader title="What it would cost Solstice" />
        <div className="grid gap-5 p-5 lg:grid-cols-[320px_1fr]">
          <div className="space-y-4">
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-solstice-stone">Properties</span>
              <input
                type="number"
                min={1}
                value={properties}
                onChange={(e) => setProperties(Math.max(1, Number.parseInt(e.target.value || '1', 10)))}
                className="mt-1 w-full rounded-md border border-solstice-sand px-3 py-2 text-sm outline-none focus:border-solstice-ember"
              />
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-solstice-stone">
                Guest conversations per property per day
              </span>
              <input
                type="number"
                min={1}
                value={perDay}
                onChange={(e) => setPerDay(Math.max(1, Number.parseFloat(e.target.value || '1')))}
                className="mt-1 w-full rounded-md border border-solstice-sand px-3 py-2 text-sm outline-none focus:border-solstice-ember"
              />
            </label>
            <p className="text-xs leading-relaxed text-solstice-stone">
              Both inputs are yours to argue with. The cost per conversation underneath them is measured from this
              system, not modelled.
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-baseline justify-between border-b border-solstice-sand pb-2">
              <span className="text-solstice-slate">Conversations per month</span>
              <span className="font-mono tabular-nums text-solstice-ink">{num(projection.conversations_per_month)}</span>
            </div>
            <div className="flex items-baseline justify-between border-b border-solstice-sand pb-2">
              <span className="text-solstice-slate">Usage cost</span>
              <span className="font-mono tabular-nums text-solstice-ink">{usd(projection.variable_usd)}</span>
            </div>
            <div className="flex items-baseline justify-between border-b border-solstice-sand pb-2">
              <span className="text-solstice-slate">Fixed platform cost</span>
              <span className="font-mono tabular-nums text-solstice-ink">{usd(projection.fixed_usd)}</span>
            </div>
            <div className="flex items-baseline justify-between rounded-md bg-solstice-ink px-4 py-3 text-white">
              <span className="font-medium">Estimated monthly total</span>
              <span className="font-display text-2xl tabular-nums">{usd(projection.total_usd)}</span>
            </div>
            <p className="text-sm text-solstice-slate">
              {usd(projection.per_property_usd)} per property per month.
            </p>
          </div>
        </div>
      </Panel>

      {/* model usage */}
      <CollapsiblePanel
        className="mt-4"
        title="Language model usage"
        summary={`${usd(totals.model_usd, 2)} across ${num(data.models.reduce((s, m) => s + m.turns, 0))} turns`}
        defaultOpen
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-solstice-sand text-left text-xs uppercase tracking-wide text-solstice-stone">
              <th className="px-4 py-2 font-medium">Model</th>
              <th className="px-4 py-2 font-medium">Turns</th>
              <th className="px-4 py-2 font-medium">Input</th>
              <th className="px-4 py-2 font-medium">Output</th>
              <th className="px-4 py-2 font-medium">Cached read</th>
              <th className="px-4 py-2 font-medium">Cache hit</th>
              <th className="px-4 py-2 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody>
            {data.models.map((m) => (
              <tr key={m.model} className="border-b border-solstice-sand/60">
                <td className="px-4 py-2.5">
                  <span className="font-mono text-xs text-solstice-ink">{m.model}</span>
                  {m.rate ? (
                    <span className="ml-2 text-xs text-solstice-stone">
                      ${m.rate.input}/${m.rate.output} per MTok
                    </span>
                  ) : (
                    <span className="ml-2 text-xs text-amber-800">no published rate on file</span>
                  )}
                </td>
                <td className="px-4 py-2.5 tabular-nums text-solstice-slate">{num(m.turns)}</td>
                <td className="px-4 py-2.5 tabular-nums text-solstice-slate">{num(m.input_tokens)}</td>
                <td className="px-4 py-2.5 tabular-nums text-solstice-slate">{num(m.output_tokens)}</td>
                <td className="px-4 py-2.5 tabular-nums text-solstice-slate">{num(m.cache_read_tokens)}</td>
                <td className="px-4 py-2.5 tabular-nums text-solstice-slate">
                  {(m.cache_hit_ratio * 100).toFixed(0)}%
                </td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums text-solstice-ink">
                  {m.usd === null ? '—' : usd(m.usd, 4)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-4 py-3 text-xs leading-relaxed text-solstice-stone">
          Cached reads are billed at {CACHE_MULTIPLIERS.read}x the input rate and cache writes at{' '}
          {CACHE_MULTIPLIERS.write}x. A high cache hit rate is the single largest lever on this bill, which is why
          the stable part of the prompt is cached and the volatile part comes last.
        </p>
      </CollapsiblePanel>

      {/* traffic */}
      <CollapsiblePanel
        className="mt-4"
        title="Traffic behind these numbers"
        summary={`${num(traffic.conversations)} conversations, ${traffic.call_minutes.toFixed(1)} call minutes`}
      >
        <dl className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Voice calls', num(traffic.voice_sessions)],
            ['Chat conversations', num(traffic.chat_sessions)],
            ['Call minutes', traffic.call_minutes.toFixed(1)],
            ['Proposals emailed', num(traffic.proposals_sent)],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs uppercase tracking-wide text-solstice-stone">{label}</dt>
              <dd className="mt-1 font-display text-2xl text-solstice-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </CollapsiblePanel>

      {/* rate card */}
      <CollapsiblePanel className="mt-4" title="Rate card" summary={`checked ${RATES_VERIFIED_ON}`}>
        <table className="w-full text-sm">
          <tbody>
            {Object.entries({ ...data.rate_card.telnyx, ...data.rate_card.platform }).map(([key, rate]) => (
              <tr key={key} className="border-b border-solstice-sand/60">
                <td className="px-4 py-2.5 text-solstice-ink">{rate.label}</td>
                <td className="px-4 py-2.5 font-mono tabular-nums text-solstice-slate">
                  {rate.usd === 0 ? 'included' : usd(rate.usd, 4)}
                </td>
                <td className="px-4 py-2.5 text-solstice-stone">{rate.per}</td>
                <td className="px-4 py-2.5">
                  <Basis basis={rate.basis} />
                </td>
                <td className="px-4 py-2.5 text-xs text-solstice-stone">{rate.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-4 py-3 text-xs leading-relaxed text-solstice-stone">
          Anything marked as our estimate is the first thing to replace with a real invoice. The Telnyx balance above
          is exact; these per-unit rates only attribute that spend across calls, texts and email.
        </p>
      </CollapsiblePanel>
    </AdminShell>
  )
}
