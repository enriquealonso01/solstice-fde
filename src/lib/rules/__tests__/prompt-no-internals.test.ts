// Sol must never tell a guest about its own plumbing ("I don't have a create_inquiry tool
// available"). The prompt forbids it, and chat is told what its channel has, because the chat
// runtime really does not register the inquiry tools the shared prompt mentions.

import { describe, expect, it } from 'vitest'
import { SOL_SYSTEM_PROMPT } from '../../../../netlify/functions/tools/solPrompt'
import { toolDefinitions } from '../../../../netlify/functions/tools/registry'

describe('the prompt forbids naming tools to a guest', () => {
  it('carries the rule, the failing sentence as its example, and what to say instead', () => {
    expect(SOL_SYSTEM_PROMPT).toMatch(/Never name a tool to a guest/)
    expect(SOL_SYSTEM_PROMPT).toMatch(/I don't have a\s+create_inquiry tool available/)
    expect(SOL_SYSTEM_PROMPT).toMatch(/noting it for the team|getting a person onto it/)
  })

  it('chat really does not have create_inquiry, which is why chat.ts adds a channel note', () => {
    const names = toolDefinitions().map((t) => t.name)
    expect(names).not.toContain('create_inquiry')
    expect(names).not.toContain('update_inquiry')
    expect(names).toContain('create_escalation')
    expect(names).toContain('classify_intent')
  })
})
