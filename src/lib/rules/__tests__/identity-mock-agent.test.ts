/**
 * The offline chat fallback follows the same identity rule as the real agent: no booking detail
 * without a confirmation number and the last name, and never a card's digits.
 */
import { describe, expect, it } from 'vitest'
import { mockAgentStream } from '../../../components/chat/mockAgent'

/** The done chip of each tool, and the reply text, of one scripted turn. */
async function turn(message: string): Promise<{ chips: Record<string, string>; reply: string }> {
  const chips: Record<string, string> = {}
  let reply = ''
  for await (const event of mockAgentStream({ message }, { speed: 0 })) {
    if (event.type === 'tool' && event.status === 'done') chips[event.name] = event.summary
    if (event.type === 'delta') reply += event.text
  }
  return { chips, reply }
}

describe('the offline mock agent', () => {
  it.each(['R55012', 'Can I get a late checkout?', 'What is on my reservation?'])(
    'asks for the second factor instead of reading a booking: %s',
    async (message) => {
      const { chips, reply } = await turn(message)
      expect(chips.identify_guest).toBe('Not verified')
      expect(chips.get_reservation).toBeUndefined()
      expect(reply).toMatch(/last name/i)
      expect(reply).not.toMatch(/Found you|Gold|Denver/)
    },
  )

  it('reads the booking once the message carries the number and the last name, with no card digits', async () => {
    const { chips, reply } = await turn('R55012, last name Kalinski')
    expect(chips.get_reservation).toBeDefined()
    expect(reply).toMatch(/Found you/)
    expect(reply).not.toMatch(/ending\s*(in\s*)?\d{4}/i)
  })
})
