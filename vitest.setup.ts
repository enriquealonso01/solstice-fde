/**
 * Makes the test run hermetic: strip every credential before any test runs, so code that reaches for
 * Supabase, Telnyx or Anthropic when configured cannot talk to production from a shell that sourced
 * `.env`. A test that needs a backend stubs it.
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
  'TELNYX_SIP_PASSWORD',
  'ANTHROPIC_API_KEY',
  'TOOL_WEBHOOK_SECRET',
  'PROPOSAL_LINK_SECRET',
  'DEMO_PASSWORD',
  'NETLIFY_AUTH_TOKEN',
]

beforeAll(() => {
  for (const key of STRIPPED) delete process.env[key]
  process.env.NODE_ENV = 'test'
  process.env.DEMO_MODE = 'true'
})
