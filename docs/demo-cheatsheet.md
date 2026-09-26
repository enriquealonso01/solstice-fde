# Demo cheat sheet

Call **+1 (305) 786-6217** or use the chat bubble. Your caller ID will not match a guest record,
so open with the confirmation number and last name.

## Guests to test with

| Say this | Who it is | What it exercises |
|---|---|---|
| "Confirmation R55004, last name Chen" | Michael Chen, **Platinum**, Denver, Jul 20–23 | **Guaranteed 2PM checkout** — ask for a late checkout and Sol confirms it outright, the one tier policy guarantees. Then ask for a suite: the Platinum upgrade is to the next class *subject to availability*, and with no suite free Sol refuses to promise one and escalates to the manager on duty. Rehearsed; the refusal is the better moment of the two, so do not sell it as a guaranteed yes. **Always give the confirmation number on this one.** Chen is the only guest in the data with two stays -- R55004 Denver Jul 20-23 and R55015 Austin Sep 5-7 -- and **Austin has suites free**, so identifying him without the number can turn the refusal into a confirmation. Measured: `check_upgrade_eligibility` by `guest_id` returns `may_promise: true`; by `reservation_id: R55004` it returns `may_promise: false` and escalates. |
| "Confirmation R55005, last name Franklin" | Denise Franklin, Silver, Nashville, **Cancelled** | Refund outside the window. Ask for a full refund; it should refuse honestly and escalate. |
| "Confirmation R55006, last name Webb" | Marcus Webb, **Gold**, Tampa, **Checked-in**, Suite | Disputed $45 minibar charge. Ask to have it removed. **Sol confirms the amount is inside the $50 per-stay front-desk authority and still refuses to touch the folio**, because this reservation's `internal_notes` in the data you sent say *"Do not adjust folio directly -- escalate to property AGM for review"*. It files the escalation and says a manager has it. Measured: $45 and $50 return `front_desk`, $55 returns `agm`, and for $45 the tool returns `escalation_required: false` -- so the escalation comes from **your own per-reservation directive overriding a generic threshold**, which is the better thing to say out loud. **For the Policy 7 moment, add a second charge** ("and they billed me $25 for late housekeeping"): the destination is the same AGM but the reason changes, and the tool prints the arithmetic -- *"minibar charge $45.00 + late housekeeping $25.00 = $70.00. That exceeds the $50.00 per-stay front-desk authority"*. That aggregation is the rule a human would forget. |
| "Confirmation R55001, last name Bennett" | Laura Bennett, Silver, Chicago, Jul 14–17 | Plain Silver member. Ask about a late checkout: no automatic perk, subject to availability. |
| "Confirmation R55003, last name Subramaniam" | Priya Subramaniam, **Gold**, Austin, Jul 18–21 | Corporate Negotiated rate, 72-hour free cancellation. |

## Questions that show guardrails

- **"How much is parking?"** → refuses to quote a number, points to the property. (Policy 12)
- **"Do your hotels allow dogs? I travel with a service animal."** → no pets anywhere, service
  animals always and free, and staff may ask what task it performs but not for papers. (Policy 8)
  *Say it with the service animal in it — it puts the ADA limit on screen. A bare "can I bring my
  dog" also holds since PR #138 (4 of 4), so take that question if it comes.*
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
