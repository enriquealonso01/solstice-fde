# Where this goes

The proof of concept answers two questions the brief asked. This is what the same foundation is
worth over the following year, written in outcomes rather than features, because a hotel group does
not buy agents, it buys shorter queues and faster quotes.

Everything here rests on one property of what already exists: **the business rules are typed tools
with tests, not prompt text.** That is what makes each step below an addition rather than a rebuild.

---

## Now: what the proof of concept already proves

- A guest gets a correct, cited answer on the phone or in chat at any hour, or a human gets a
  handoff with the full context attached.
- A group inquiry is priced against real thresholds in seconds, and anything outside the rules is
  visibly locked until a person decides.
- Every answer is traceable: which tool ran, what it read, whether it was grounded.

---

## Next quarter: make it load-bearing

**Connect the real systems.** The tool layer already speaks in `getReservation` and
`getPropertyRate`, not vendor field names, so the work is an adapter, not a rewrite. Read-only
first, at three to five pilot properties.
*Outcome: the agent answers about real stays instead of a sample export.*

**Let it finish the job, not just answer.** Today it can request a late checkout; next it writes
it back to the PMS through a queue with an approval gate.
*Outcome: the guest stops being told "someone will confirm that".*

**Turn escalations into a worklist.** Escalations are already structured packets. Route them to
the right desk, with an SLA and a visible queue.
*Outcome: the front desk stops rediscovering context that the agent already gathered.*

**Group quoting end to end.** The rules, pricing and proposal exist. What is missing is the
contract and the rooming list.
*Outcome: the two-day quote becomes twenty minutes, which is the number in their own brief.*

---

## Six to twelve months: the compounding part

**The agent learns the estate's own exceptions.** Every override is already written to the audit
log with the rules it overrode and the person who approved it — `overrode_rules:
["GRP-DISCOUNT-CEILING"]` and an actor, today, on every one. That is a data point about where the
written policy and the real one disagree, and surfacing it is a product in itself:
*here are the eleven rules your managers override most often, and what it costs you.*
*Outcome: policy improves from evidence rather than from anecdote.*

**Demand-aware group pricing.** Today the discount ceiling is a static threshold per property.
With occupancy history the same engine recommends a ceiling per date.
*Outcome: sales stops discounting into sold-out weekends and stops refusing business on empty
Tuesdays.*

**Proactive service recovery.** The 72-hour window is already encoded. Watching for the signals
that predict a complaint, and acting inside the window, is the same machinery pointed earlier.
*Outcome: fewer disputes, because the recovery happens before the guest writes the review.*

**One agent, more doors.** Voice and chat share a definition today. WhatsApp, SMS and the booking
confirmation email are the same agent behind a different transport.
*Outcome: guests use the channel they already use.*

**A staff-facing agent.** The concierge already answers policy questions correctly with citations.
Pointed at the front desk instead of the guest, it becomes the fastest way for a new associate to
get a right answer.
*Outcome: onboarding stops depending on who happens to be on shift.*

---

## What we would not do, and why

Saying no is part of the recommendation.

- **Not autonomous sending.** Nothing reaches a customer without a person, and that stays true as
  volume grows. The approval gate is the reason the sales team will trust an empty inbox.
- **Not policy in the model.** Every new rule is a typed tool with a test. The day a discount
  ceiling lives in a prompt is the day nobody can answer why a quote was wrong.
- **Not one model for everything.** Voice and chat already run different models for different
  latency budgets. Route by difficulty, not by fashion.
- **Not a rebuild to add a channel.** If adding WhatsApp means touching the rules engine, the
  architecture was wrong.

---

## What it costs to be wrong

The honest framing for a nervous executive: the failure mode of this system is **an escalation**,
not a bad answer. It refuses rather than guesses, it cannot send without a person, and every
refusal is logged with the reason. That is a deliberate design choice, and it is why the scaling
story above is a matter of adding tools rather than adding supervision.
