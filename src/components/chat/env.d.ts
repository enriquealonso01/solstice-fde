// Browser-visible environment values.
//
// vite.config.ts injects exactly these four via `define`. The repo has no
// `src/vite-env.d.ts`, so without this declaration `import.meta.env` is untyped
// and every read is a TS2339. It lives in this folder only because this agent
// owns `src/components/chat/**`; it belongs in `src/vite-env.d.ts` and the
// shared-shell owner should move it there (see the final report).
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  /** E.164 support line, e.g. "+13055550142". Empty until Telnyx provisions a number. */
  readonly VITE_SUPPORT_PHONE: string
  /** Telnyx AI Assistant UUID. Empty until the assistant is created. */
  readonly VITE_TELNYX_ASSISTANT_ID: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
