# Integration recommendation

How this actually plugs into a 140-property upper-midscale chain, what we would tell an IT team
that is nervous about it, and what we would tell the front desk.

---

## What a chain like Solstice is actually running

Nobody at this scale has one system. A 140-property upper-midscale group typically runs:

- **A property management system at each property.** Oracle OPERA (increasingly OPERA Cloud) is the
  incumbent at brand scale; Mews, Cloudbeds, and Agilysys show up in newer or independent estates.
  If any properties are franchised rather than managed, assume the estate is **mixed**, and assume
  at least one property is on a version nobody wants to touch.
- **A central reservation system above it** (SynXis, Amadeus, or a brand-built CRS) holding rates and
  availability, fed by a channel manager out to OTAs and the GDS.
- **A loyalty and CRM stack off to the side** (Revinate, Cendyn, Salesforce Marketing Cloud, or
  homegrown), which is usually the system that actually knows the guest is Platinum.
- **A switch or interface layer** between them, often speaking HTNG or OpenTravel XML, and often the
  least-documented component in the building.

The practical consequence: **the guest record the agent needs is not in one place.** The reservation
lives in the PMS, the rate and inventory truth lives in the CRS, and the tier lives in loyalty. Our
sample export flattened all three into one CSV, and no production system will hand us that.

## How we would plug in

**Read before write, and read through one seam.** Everything the concierge does today is a read:
look up a reservation, check a policy, check tier benefits. Reads are where the value is and where
the risk is not. We would integrate reads first, through a single anti-corruption layer that
normalizes OPERA, the CRS, and loyalty into the internal shapes this agent already uses. That layer
is the only component that knows a vendor's field names. Everything above it, including every tool
in this proof of concept, stays unchanged when a property migrates PMS.

That seam already exists here, and it is narrower than "a directory". The tools call
`getReservation` and `getPropertyRate`, never a vendor API, and **every read of the provided data on
the request path goes through one file** — `netlify/functions/_lib/data.ts` holds all seven imports of
`data/generated/*.json`, and nothing that serves a request touches them directly. Swapping the CSVs
for OPERA's Hospitality Integration Platform is a change to that file's implementation, not a
rewrite. The group pricing path makes the same point in a comment: `getPropertyRate()` is the only
sanctioned route to a nightly rate.

**One file outside the seam reads the JSON, deliberately.** `scripts/show-verdict.ts` — the rehearsal
aid the live-modification demo runs — loads `data/generated/*.json` itself, because its whole purpose
is to print a verdict with **no network and no model** in front of an audience. It is not on the
request path, and the consequence is worth naming rather than hiding: after a PMS integration it
would still read the exported snapshot, not live inventory. Pointing it at the adapter is a small
follow-on, not part of the swap.

**Writes go through a queue with an approval gate, not straight at the PMS.** Booking an amenity or
extending a checkout is a write, and PMS writes fail in ways reads do not: the property is in night
audit, the interface is down, the rate plan has changed underneath you. Writes should be queued,
idempotent, and retried, with the agent telling the guest what it has requested rather than
what it has guaranteed. The group booking side already works this way, where a flagged proposal
cannot send until a human approves it.

**Expect the integration calendar, not just the API.** Per-property credentials, a certification
process, rate limits that assume a booking engine rather than a chatty agent, and a nightly audit
window where interfaces are unreliable. Budget for a shadow-mode phase where the agent answers
against production data and nobody sees the answers but us, then a pilot at three to five
properties across different market types, then the estate.

## What we would tell a nervous IT team

Their fears are legitimate and mostly not about AI.

- **"It will write something wrong into my PMS."** It cannot, in phase one. Read-only credentials,
  and writes arrive later behind a queue and an approval gate.
- **"Guest data will leak into a model."** Payment data never reaches the model at all; the tool
  layer masks at the boundary, and card digits are never returned to the agent or spoken aloud. We
  would run with zero-retention terms with the model provider and keep transcripts in their tenancy,
  not ours.
- **"We will not know what it did."** Every tool call is logged with its arguments, whether the
  answer was grounded, and how long it took. The supervisor console shows this live, and the same
  records are the audit trail afterwards. This is stronger observability than most chains have over
  their existing phone tree.
- **"What happens when something breaks."** The agent degrades rather than improvises: if the PMS is
  unreachable it says it cannot confirm and escalates with context. The failure mode is an honest
  handoff, never a confident guess.
- **"How do we turn it off."** A kill switch per property and per capability, and the phone number
  falls back to the existing routing. Nothing about this replaces the existing path; it sits in
  front of it.

The sequencing answer that usually settles the room: **start read-only, in shadow mode, at properties
they choose, with a rollback that is a DNS change.**

## The front desk question

"Is the AI coming for our jobs" deserves better than reassurance, so here is the honest version.

The work this absorbs is the work that makes the job worse: the fourth call this hour asking what
time checkout is, the guest on hold while an associate reads a policy PDF, the 11pm call that should
never have needed a person. None of that is the part of the job anyone trained for, and none of it
is what a guest remembers.

What it does **not** absorb is the part that requires standing: reading a guest who is upset before
they say so, deciding that this particular Platinum member gets the suite, knowing that the family
in 412 has been up since 4am. The policy reference itself admits the limit, in Policy 6: when two
Platinum guests want the same suite, that is a judgment call for the manager on duty. We did not
automate that. The agent detects it and routes it, because the document says a human decides.

There is also a concrete commitment worth making: **every escalation arrives with more context than a
transfer does today.** Not "the guest wants a refund" but the reservation, the rate plan, the policy
that applies, what the agent already tried, and why it stopped. The associate starts the conversation
already informed instead of asking the guest to repeat themselves.

And the front desk should author the policies. The guardrails in this system are a direct encoding
of their reference document, including its ambiguities. The people who know where the document is
wrong are the people at the desk, and the fastest way to make this system good is to let them say so
and change a rule file, not file a ticket.

The measurable version, for leadership: track deflection, but track **escalation quality** alongside
it. A system that deflects 70% of contacts and hands over the other 30% badly is worse than one that
deflects 50% and hands over well.
