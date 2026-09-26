# Demo cheat sheet

Call **+1 (305) 786-6217** or use the chat bubble. Your caller ID will not match a guest record,
so open with the confirmation number and last name.

## Guests to test with

| Say this | Who it is | What it exercises |
|---|---|---|
| "Confirmation R55004, last name Chen" | Michael Chen, **Platinum**, Denver, Jul 20–23 | **Guaranteed 2PM checkout** — ask for a late checkout and Sol confirms it outright, the one tier policy guarantees. Then ask for a suite: the Platinum upgrade is to the next class *subject to availability*, and with no suite free Sol refuses to promise one and escalates to the manager on duty. Rehearsed; the refusal is the better moment of the two, so do not sell it as a guaranteed yes. |
| "Confirmation R55005, last name Franklin" | Denise Franklin, Silver, Nashville, **Cancelled** | Refund outside the window. Ask for a full refund; it should refuse honestly and escalate. |
| "Confirmation R55006, last name Webb" | Marcus Webb, **Gold**, Tampa, **Checked-in**, Suite | Disputed $45 minibar charge. Ask to have it removed: $45 is **inside** the $50 per-stay front-desk authority, so Sol actions it without a manager and says why. Measured, not assumed — $45 and $50 return `front_desk`, $55 returns `agm`. **If you want the escalation on screen, mention a second charge** ("and they billed me $25 for late housekeeping"): Policy 7 makes authority a per-stay total, $70 crosses the line, and it goes to the AGM. That aggregation is the better moment — it is the rule a human would forget. |
| "Confirmation R55001, last name Bennett" | Laura Bennett, Silver, Chicago, Jul 14–17 | Plain Silver member. Ask about a late checkout: no automatic perk, subject to availability. |
| "Confirmation R55003, last name Subramaniam" | Priya Subramaniam, **Gold**, Austin, Jul 18–21 | Corporate Negotiated rate, 72-hour free cancellation. |

## Questions that show guardrails

- **"How much is parking?"** → refuses to quote a number, points to the property. (Policy 12)
- **"Do your hotels allow dogs? I travel with a service animal."** → no pets anywhere, service
  animals always and free, and staff may ask what task it performs but not for papers. (Policy 8)
  *Say it with the service animal in it: a bare "can I bring my dog" asks which hotel first about
  three times in four.*
- **"I booked Advance Purchase and my flight got cancelled, can I get a refund?"** → non-refundable,
  honestly, with travel insurance as the only real recourse. (Policy 3)
- **"I need 40 rooms in Tampa in October at 22% off."** → routes to Sales and **refuses to price or
  discount it**, then asks for an email so Sales can follow up. Rehearsed; chat calls
  `classify_intent` and nothing else. The room cap and the discount ceiling are *not* shown to the
  guest — those are rule verdicts, and they appear on the group sales dashboard, which is the
  INQ-2009 beat in the runbook. Say it as the boundary it is: the front-desk lane never quotes a
  group rate.
- **"My room was noisy, I checked out last week, I want a refund."** → 72-hour service recovery
  window has closed; points offered, not a refund. (Policy 5)

## Group booking by phone

Say: *"I'd like to book a block of rooms for a company offsite."* Sol gathers requirements and
creates an inquiry that appears in the Group sales inbox.

## Staff logins

See `DEMO_LOGINS.md` (not committed). Password is shared across all three accounts.
