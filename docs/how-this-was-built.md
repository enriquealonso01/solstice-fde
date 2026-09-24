# How this was built

The brief says to use AI tools to build fast, and to be able to open the hood afterwards. This is
the honest account of how that went, including the parts that went wrong, because the failures are
the part worth reading.

The short version: **six agents built this in parallel, and the most valuable thing they produced
was not code. It was the bugs they found in each other's work.**

---

## The setup

Six agents, each owning a disjoint set of files, working simultaneously:

| Agent | Owned | Built |
|---|---|---|
| A1 | `scripts/data/`, `netlify/functions/_lib/` | Data layer, PII masking, rule extraction from free text |
| A2 | `src/pages/Landing.tsx`, `src/components/chat/` | Landing page and the guest chat bubble |
| A3 | `netlify/functions/chat.ts`, `tools/`, `agent/sol.md` | Sol's brain, eleven concierge tools, the agent definition |
| A4 | `src/lib/rules/`, `netlify/functions/group/` | Group rules engine, proposals, delivery |
| A5 | `src/pages/admin/`, `src/components/admin/` | Three scoped dashboards and the backend map |
| A6 | `scripts/telnyx/`, `netlify/functions/telnyx/`, `voice/` | Provisioning, webhooks, the supervisor ladder |

Three rules made it work, and all three were learned the hard way:

1. **Disjoint file ownership.** An agent may not edit a file it does not own. Where it needs a
   change elsewhere, it reports it instead. Two agents editing one file concurrently is how you
   get a repository that typechecks and does not run.
2. **A written shared contract, first.** `shared/types.ts` and `shared/toolContracts.ts` were
   written before any agent started, so the chat client and the chat server were built against
   the same SSE event names without ever talking to each other.
3. **No agent runs git.** One orchestrator commits. Six agents committing concurrently is a merge
   conflict generator with no upside.

---

## What the agents caught in each other's work

This is the part that justifies the approach.

**The 401 that would have killed the voice demo.** Securing `/api/tools` broke every tool call Sol
makes on a live phone call, because the provisioning script registered the assistant's webhook
tools without the new secret header. The voice agent found it, proved it with a live replay, and
fixed it. Then, while in there, it found a *second* break nobody was looking for: all eleven group
tools were registered against the concierge dispatcher and would have returned "unknown tool" on
every call. Fixing only the first bug would have converted 24 silent 401s into 11 working calls and
11 confusing ones.

**The proposals that were never saved.** The group engine kept proposals in a module-level `Map`,
which is honest on a laptop and a lie on serverless. Three proposals generated, three PDFs in
storage, zero rows in the database, and `send_proposal` answering "no record of that proposal".
Caught by testing the send path end to end rather than trusting the unit tests.

**The dollars pretending to be cents.** The pricing table rendered a $197.10 nightly rate as $1.97.
The totals were in integer cents; the line items were in dollars. The fix was not the renderer, it
was a test that walks every numeric field in a stored proposal and asserts that anything holding
money is named `_cents` and contains an integer. That test then found two more instances nobody
had noticed, and a third in the rehydration path that would have doubled the bug the moment a
proposal was sent from a different function instance.

**The fixtures that would have lied to a signed-in user.** An RLS-protected query by an
unauthenticated caller returns zero rows, not an error. The admin UI could not tell that apart from
"not seeded yet", so an expired session would have quietly shown invented demo numbers to a real
user. Now access failures suppress fixtures and say which problem it is.

**The date that was a day early.** Arrival dates rendered one day before the stored value, because
`2026-09-14` was parsed as UTC midnight and displayed in Eastern. On a hotel proposal that is the
worst possible detail to get wrong.

---

## Where the agents were wrong, and a human had to decide

Agents are good at finding bugs and bad at deciding what matters.

- **A latency investigation reversed its own premise.** Asked to make chat faster, the measurement
  showed that disabling extended thinking made first-token latency *worse*, and that what it
  actually changed was correctness: it was the only configuration that passed all four adversarial
  scenarios. The agent recommended shipping the slower configuration. That is a judgment call about
  what a hotel would rather have, and it was made by a person, not the model.
- **An unofficial iMessage relay was the obvious way to get blue bubbles.** It was also a terms-of-
  service violation whose failure mode is an account ban mid-demo. Rejected on judgment, not
  capability.
- **The group intake asked for everything at once**, because that is what a complete tool schema
  invites. Making it ask one question at a time, email first, and open the inquiry on the first
  answer, was a product decision about what happens when a caller hangs up halfway through.

---

## What we would do differently

- **Write the shared contract even earlier.** The one genuine collision was in a file whose
  ownership was ambiguous, and both agents were right to be editing it.
- **Give one agent the job of testing across boundaries.** Every cross-agent bug above was found by
  an agent that wandered outside its lane, or by the orchestrator testing end to end. None were
  found by the unit tests, which all passed throughout.
- **Never let an agent self-report "done" on something it could not execute.** The dashboards were
  reported complete before anyone had signed in, because the agent that built them could not log
  in. They were complete. But the supervisor ladder was also reported complete, and it had never
  placed a call.

---

## The honest summary

Six agents wrote most of this system in a day. They also wrote bugs that unit tests could not
catch, were confidently wrong about what mattered, and twice reported work as finished that had
never been executed once.

Both halves of that are the point. The speed is real, and so is the supervision it requires. This
project is a small argument for exactly the working model an FDE uses on a client site: move fast
with agents, verify against reality rather than against the agent's own report, and keep a human
holding the decisions that involve a tradeoff.
