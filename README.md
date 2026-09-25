# Solstice Hotel Group — agentic proof of concept

Built for the phData FDE candidate challenge by Enrique Alonso.

**Live:** https://solstice-hotel-group.netlify.app
**Phone:** call Sol directly at **+1 (305) 786-6217**

One deployed application. A guest-facing hotel site with a chat bubble and a phone number, and a
staff console behind three scoped logins. Same agent on both channels, same tool layer underneath.

---

## Where each deliverable lives

| The brief asks for | Here |
|---|---|
| Agent configuration: prompts, tool definitions, guardrails | [`agent/sol.md`](agent/sol.md) |
| Sample transcripts | [`transcripts/`](transcripts/) — captured from production, not written by hand |
| Architecture diagram, future-state production | [`docs/architecture.drawio`](docs/architecture.drawio), [`docs/architecture.svg`](docs/architecture.svg), guide in [`docs/README-diagram.md`](docs/README-diagram.md) |
| Integration recommendation | [`docs/integration-recommendation.md`](docs/integration-recommendation.md) |
| Latency target and its justification | [`docs/latency-target.md`](docs/latency-target.md) |
| How this was built, and what the agents caught in each other's work | [`docs/how-this-was-built.md`](docs/how-this-was-built.md) |
| Where this goes next, in business outcomes | [`docs/where-this-goes.md`](docs/where-this-goes.md) |
| Demo runbook, beat by beat | [`docs/demo-runbook.md`](docs/demo-runbook.md) |
| At least one net-new tool | `sameDayAvailability()` in [`netlify/functions/tools/availability.ts`](netlify/functions/tools/availability.ts), reached by the `check_late_checkout` and `check_upgrade_eligibility` guest tools and by `check_availability` on the group side — see Assumptions below |
| Native platform export | [`exports/telnyx-assistant.json`](exports/telnyx-assistant.json) — the live assistant, 25 tools, secret redacted. Provisioned from source by [`scripts/telnyx/provision.mjs`](scripts/telnyx/provision.mjs) |

## Try it

**As a guest:** open the site, use the chat bubble, or call the number. Ask about the cancellation
window, a late checkout, whether you can bring a dog, or what parking costs.

**As staff:** sign in at `/login`. Three scoped roles exist; credentials are in `DEMO_LOGINS.md`,
which is deliberately not committed.

- **Concierge supervisor** — live sessions, streaming transcripts, the tool trace, and the
  supervisor ladder (listen → whisper → barge → take over)
- **Group sales** — the ten inquiries, rule verdicts, pricing, proposals, approvals
- **Super admin** — both, plus member invites and the **Backend** map used to present the system

## How it is built

```
Guest: chat bubble ──> /api/chat (Claude Sonnet 5, streaming SSE) ──┐
Guest: phone ───────> Telnyx AI Assistant "Sol" (Claude Haiku 4.5) ─┤
                                                                     ├─> one tool layer
Staff: 3 scoped logins ──> admin surfaces                            │   (Netlify Functions)
                                                                     v
                                          Supabase: Postgres + RLS, Realtime, Storage
```

The design decision everything else follows from: **business logic lives in typed tools, not in the
prompt.** Discount ceilings, comp authority, cancellation windows and tier benefits are code and
data with tests. The model decides what to say and which tool to call; it never decides what the
policy is. That is why a threshold can be changed live during a conversation, and why two different
models can run the two channels without the rules drifting apart.

Thresholds are one table in `src/lib/rules/thresholds.ts`. A test mutates it and asserts the verdict,
the human-readable sentence and all three regenerated options move with it.

## What this cost to build

The Cost page inside the app measures what the system costs to *run*. This is what it cost to
*build*, which is the more relevant number if you are deciding whether to work this way.

**Elapsed: about 24 hours, of which under 5 were active.** First commit 2026-09-24 12:35 EDT.
Git puts the committed work in two windows — 12:35 to 16:21 on day one, and a second session on
day two. The gap between them is a night's sleep, not work.

**Two different shapes of agent, in two phases.**

| Phase | Shape | Output |
|---|---|---|
| Day one | **six agents in parallel**, disjoint file ownership, one orchestrator holding git | 25 commits: the system itself |
| Day two | **three agents in a loop** — a planner, an implementer and a tester, coordinating only through single-writer files and one `mkdir` mutex | every change reviewed and merged as its own PR: hardening, proof and documentation |

The two phases answer different questions. Parallel agents are how you get a system built in an
afternoon. The day-two loop is how you find out which parts of it were not true — and it did.
The browser mic had never once worked. A deliverable named a tool that does not exist. The group
refusal promised an approver the schema cannot enforce. And on chat, a guest in distress was told
"a colleague is joining" when nothing in the system guarantees anyone is watching — a failed
handoff described as a successful one, which is the exact thing the guardrails forbid.

All four were found by an agent whose only job is to disbelieve the other two, and all four are
fixed. None of them would have been caught by the tests that were already passing.
`docs/how-this-was-built.md` has the detail, including what the agents got wrong.

**The result:** roughly 210 files, about 125 of them TypeScript, near enough 28,700 lines, and a
test suite in the low 300s. Those are deliberately rounded: the day-two loop was still merging
while this paragraph was being written, and three precise counts went stale inside an hour.
`git rev-list --count HEAD`, `git ls-files | wc -l` and `npx vitest run` are the live answers and
they do not rot.

**What we are not claiming.** Build-time model spend is not instrumented, so there is no figure
here for it, and inventing one would undercut everything else on this page that *is* measured.
What is measured is the runtime cost, and it is on the Cost page at real numbers: spend to date,
cost per conversation, and the live Telnyx balance read from their API while you watch.

## Stated assumptions

The brief invites assumptions, so these are explicit rather than buried:

1. **No inventory-by-date exists in the exports.** Policies 1 and 6 both hinge on "subject to
   same-day availability", so `netlify/functions/tools/availability.ts` is the net-new service:
   deterministic, bounded by real room counts, and labelled
   `provenance: "simulated_inventory_service"` on every result. It is a service rather than a
   tool the model calls directly — `sameDayAvailability()` is consumed by the
   `check_late_checkout` and `check_upgrade_eligibility` guest tools, and the group assistant
   exposes its own `check_availability`. In production this is where the PMS plugs in.
2. **A guest is identified by caller ID or a confirmation number, never by claiming a name.** Two
   guest pairs in the data share the same last four digits, so lookup returns found / ambiguous /
   not_found and refuses to guess.
3. **Approval authority is a named human, not a role tier.** An over-ceiling proposal cannot be
   sent until someone approves it and the override is recorded in the audit log with the rules it
   overrode. Which *role* may approve is deliberately not modelled — a general-manager tier is a
   one-value enum addition in phase two. What is enforced is that an approval happened and is
   attributable, which is the part that matters for an audit.
4. **A phone-taken group inquiry is persisted and rehydrated into the inbox, contact still
   masked.** `create_inquiry` writes the row to Postgres and the group readers merge it in for any
   code the seeded dataset lacks, additively, so an unreachable database degrades to the seeded
   set rather than emptying the board. **INQ-2011** is the live example, captured on a real call.
   Only the masked contact is stored, so the rules still see a reachable customer while delivery
   finds no address and routes to a human: the inquiry can be priced and judged, never silently
   emailed to a row of asterisks.
5. **Payment data is last-four only** in the export; a real PMS would hold a token. Card digits are
   never returned to the model and never spoken.
6. **`SOL-PVD.base_rate_suite = -395` is a data error, not a price.** It is quarantined at the
   access layer, visible in the admin UI, and never used for pricing.
7. **Providence's "Boston-area sister property" does not exist in the directory.** The agent surfaces
   the referral and states plainly that it cannot quote there.
8. **The `notes` column of the inquiries CSV is the challenge author's answer key.** It is stripped
   before anything reaches the database or the model.
9. **INQ-2010 is also inside a blackout**, not only over the seasonal discount cap, which the sample
   data's own note does not mention. Both are reported.

## What is real, and what is not

Worth being precise about, because a demo that overstates itself is worse than a smaller honest one.

**Real:** the deployed site and API; Postgres with row-level security enforcing role scoping;
Sol answering on chat and on a real phone number; live transcripts streaming to the supervisor
console; the rules engine and all ten inquiry verdicts; proposal generation with PDFs, and a proposal email that has actually been delivered; a test
suite in the low 300s (`npx vitest run` for the live number).

**Partly working, and stated precisely because it matters:** the supervisor ladder. Verified on a
live call, a supervisor can attach to an in-progress assistant call, hears the GUEST, and
`ai_assistant_stop` genuinely silences Sol while leaving the call up. What does not carry is Sol's
own synthesized audio: Telnyx documents `monitor` as hearing everything, but an assistant leg
appears to inject its speech rather than stream it. The live transcript shows both sides
regardless, so the supervisor is never blind. The documented fix is to run the call in a
conference and have the supervisor join it; that is written up and not built, because it would
rework the inbound flow that currently answers the phone reliably.

**A stated limit, not a bug: a verified identity has no expiry.** Once `identify_guest` verifies a
guest, the id is bound to the session row and restored on every later turn
(`netlify/functions/chat.ts:256`). It is deliberate — without it Sol re-verifies the same person on
every message, because the transcript records what it *said*, not what it *knows* — but the bound
identity has no TTL, and the lookup is by session id alone, so it is not checked against whether
the session is still open either. Possession of the session id is therefore possession of that
guest's verified identity, indefinitely.

A caller cannot invent an id, only replay one the server minted, and minted ids are unguessable
uuids — so this is not an open door; the exposure is that a *leaked* id stays useful rather than
going stale. Two things come first in production, in this order: a TTL on the binding, and
re-verification before anything that discloses stay detail. Neither is built, and neither should be
attempted the night before a submission on the one path the whole concierge demo runs through.

**Email:** proven end to end. Telnyx's shared sending domain is a sandbox that only delivers to the
account's own verified address, so every send is routed there; verifying a real domain removes that
limit and is a DNS change, not a code change.

**Not live:** SMS delivery. US carrier registration (10DLC) takes days and was started late; the
delivery layer is complete and falls back to email, with the channel chosen by config rather than
code.

## Running it locally

```bash
npm install
cp .env.example .env     # then fill it in
npm run db:schema        # or paste supabase/schema.sql into the SQL editor
npm run db:seed
npm run seed:users
npm run dev
```

`npm run typecheck` · `npx vitest run` (308 tests) · `npm run data:check` verifies the generated
data still matches its sources.
