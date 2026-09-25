/**
 * Types for the two pure exports of `provision.mjs`.
 *
 * The script itself stays plain ESM — it is an operational tool Enrique runs by hand, and it should
 * not need a build step to work. Only the compile is imported by tests, so only the compile is
 * declared here. Keep these signatures in step with the implementation; there is no checker that
 * will do it for you.
 */
export declare function compileInstructions(markdown: string): {
  instructions: string
  truncated: boolean
}

/** The hard ceiling the voice runtime enforces on assistant instructions. */
export declare const MAX_INSTRUCTION_CHARS: number
