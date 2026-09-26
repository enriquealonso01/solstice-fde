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
  // Added at iteration 161. `no-committed-credentials.test.ts` justifies its shape-based checks with
  // "vitest.setup.ts strips credentials from the environment, so no test here can know the password's
  // value" -- and DEMO_PASSWORD, the working admin password in DEMO_LOGINS.md, was not on this list. A
  // test could have read it and compared directly. Nothing did; the sentence was simply not true.
  //
  // Verified unread before stripping, comments excluded: DEMO_PASSWORD is read only by
  // `scripts/seed-users.mjs` and NETLIFY_AUTH_TOKEN by nothing at all -- neither runs inside vitest.
  // TELNYX_SIP_PASSWORD is read inside `stepSipConnection()` in `scripts/telnyx/provision.mjs`, off a
  // passed-in `env` object rather than process.env, and the two tests that import that module take
  // `compileInstructions` and never call it.
  'DEMO_PASSWORD',
  'NETLIFY_AUTH_TOKEN',
  'TELNYX_SIP_PASSWORD',
  // NOT stripped, deliberately: TELNYX_TELEPHONY_CREDENTIAL_ID is read by
  // `netlify/functions/voice/credentials.ts` at call time, it is an identifier rather than a secret,
  // and no claim anywhere depends on a test being unable to see it.
]

beforeAll(() => {
  for (const key of STRIPPED) delete process.env[key]
  // Make the intent explicit to anything that checks, rather than relying on absence alone.
  process.env.NODE_ENV = 'test'
  process.env.DEMO_MODE = 'true'
})
