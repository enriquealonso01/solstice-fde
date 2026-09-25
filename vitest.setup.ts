/**
 * Makes the test run hermetic.
 *
 * Nothing under test calls `fetch` directly, but plenty of it calls `tryGetDb()`, which reaches
 * for Supabase whenever the environment happens to be configured. Run from a shell that has
 * sourced `.env` — which is most of the time on this project — those tests quietly start talking
 * to the live database. That makes them slow, occasionally flaky, and capable of writing to the
 * same data the demo runs on.
 *
 * A test run must mean the same thing on a laptop, in CI, and thirty seconds before a panel call.
 * So: strip every credential before any test file loads. A test that genuinely needs a backend
 * should stub it, not inherit one by accident.
 */
import { beforeAll } from 'vitest'

const STRIPPED = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',
  'TELNYX_API_KEY',
  'TELNYX_ASSISTANT_ID',
  'TELNYX_PUBLIC_KEY',
  'ANTHROPIC_API_KEY',
  'TOOL_WEBHOOK_SECRET',
  'PROPOSAL_LINK_SECRET',
]

beforeAll(() => {
  for (const key of STRIPPED) delete process.env[key]
  // Make the intent explicit to anything that checks, rather than relying on absence alone.
  process.env.NODE_ENV = 'test'
  process.env.DEMO_MODE = 'true'
})
