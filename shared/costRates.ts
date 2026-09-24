/**
 * THE RATE CARD. One file, so a client can audit every number this system quotes.
 *
 * Two kinds of entry, and the difference is stated on the page rather than buried:
 *  - VERIFIED: published list price, with the source and the date it was checked.
 *  - ASSUMPTION: our own estimate, because the vendor prices it per-account, per-usage tier, or
 *    does not publish it. These are labelled in the UI and are the first thing to correct with
 *    real invoice data.
 *
 * Nothing here is inferred at runtime. If a number is wrong, it is wrong in one place.
 */

export type RateBasis = 'verified' | 'assumption'

export interface Rate {
  label: string
  /** Dollars. Unit is named in `per`. */
  usd: number
  per: string
  basis: RateBasis
  note?: string
}

export const RATES_VERIFIED_ON = '2026-09-24'

/** Anthropic list prices, per million tokens. */
export const MODEL_RATES: Record<string, { input: number; output: number; basis: RateBasis }> = {
  'claude-sonnet-5': { input: 2.0, output: 10.0, basis: 'verified' },
  'claude-haiku-4-5': { input: 1.0, output: 5.0, basis: 'verified' },
  'claude-opus-5': { input: 5.0, output: 25.0, basis: 'verified' },
}

/**
 * Cache multipliers against the model's input rate. Anthropic's standard prompt-caching pricing
 * is a premium to write and a large discount to read. Marked as an assumption because we have
 * not verified the exact multiplier for every model in the table above, and cache reads are a
 * large share of our spend, so this is the number most worth confirming against an invoice.
 */
export const CACHE_MULTIPLIERS = { write: 1.25, read: 0.1, basis: 'assumption' as RateBasis }

/**
 * Telephony and messaging. Telnyx prices per account and per destination, so these are our
 * working figures rather than quotes. The Telnyx BALANCE shown on the page is live and exact;
 * these rates are only used to attribute that spend across call minutes, texts and email.
 */
export const TELNYX_RATES: Record<string, Rate> = {
  number: { label: 'Phone number rental', usd: 1.0, per: 'number per month', basis: 'assumption' },
  voice_ai: {
    label: 'Voice AI assistant',
    usd: 0.1,
    per: 'minute',
    basis: 'assumption',
    note: 'Speech recognition, turn-taking and speech synthesis. The model is billed separately above.',
  },
  pstn: { label: 'Inbound PSTN', usd: 0.0085, per: 'minute', basis: 'assumption' },
  sms: { label: 'SMS', usd: 0.004, per: 'message segment', basis: 'assumption' },
  email: { label: 'Email', usd: 0.0003, per: 'email', basis: 'verified', note: 'From $0.30 per 1,000.' },
}

/** Everything that is a flat platform cost rather than per-use. */
export const PLATFORM_RATES: Record<string, Rate> = {
  netlify: {
    label: 'Netlify',
    usd: 0,
    per: 'month',
    basis: 'assumption',
    note: 'Free tier today. A production chain would sit on a paid plan, roughly $19 to $99 per month.',
  },
  supabase: {
    label: 'Supabase',
    usd: 0,
    per: 'month',
    basis: 'assumption',
    note: 'Free tier today. Production Postgres with backups and no project pausing starts around $25 per month.',
  },
}

export interface TokenUsage {
  input: number
  output: number
  cache_read: number
  cache_write: number
}

/** Cost in dollars for one model's token usage. Unknown models are charged at zero and reported
 *  separately rather than silently guessed at another model's rate. */
export function modelCost(model: string, usage: TokenUsage): number | null {
  const rate = MODEL_RATES[model]
  if (!rate) return null
  const perToken = (millions: number) => millions / 1_000_000
  return (
    usage.input * perToken(rate.input) +
    usage.output * perToken(rate.output) +
    usage.cache_read * perToken(rate.input * CACHE_MULTIPLIERS.read) +
    usage.cache_write * perToken(rate.input * CACHE_MULTIPLIERS.write)
  )
}

/**
 * The projection a hotel group actually cares about: what does this cost per property per month.
 * Deliberately driven by two inputs a stakeholder can argue with, rather than one opaque total.
 */
export interface ProjectionInput {
  properties: number
  conversations_per_property_per_day: number
  cost_per_conversation: number
  voice_share: number
}

export function projectMonthly(input: ProjectionInput) {
  const conversations = input.properties * input.conversations_per_property_per_day * 30
  const variable = conversations * input.cost_per_conversation
  const fixed =
    TELNYX_RATES.number.usd + PLATFORM_RATES.netlify.usd + PLATFORM_RATES.supabase.usd
  return {
    conversations_per_month: Math.round(conversations),
    variable_usd: variable,
    fixed_usd: fixed,
    total_usd: variable + fixed,
    per_property_usd: (variable + fixed) / Math.max(input.properties, 1),
  }
}
