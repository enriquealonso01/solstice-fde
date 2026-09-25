import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// The .env is shared with the serverless functions, which use unprefixed names.
// Rather than duplicate every key with a VITE_ prefix, we expose the two
// browser-safe values explicitly. Service-role keys must never appear here.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    resolve: { alias: { '@': path.resolve(__dirname, './src') } },
    server: { port: 5173 },
    // Credentials are stripped before any test file loads: see vitest.setup.ts for why.
    test: { setupFiles: ['./vitest.setup.ts'] },
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(env.SUPABASE_URL ?? ''),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(env.SUPABASE_ANON_KEY ?? ''),
      'import.meta.env.VITE_SUPPORT_PHONE': JSON.stringify(env.TELNYX_PHONE_NUMBER ?? ''),
      'import.meta.env.VITE_TELNYX_ASSISTANT_ID': JSON.stringify(env.TELNYX_ASSISTANT_ID ?? ''),
    },
  }
})
