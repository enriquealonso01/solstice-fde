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
| Changing the system live, rehearsed | [`docs/live-modification.md`](docs/live-modification.md) — the Phoenix discount ceiling, 15% to 12%, with the command and the real captured output |
| The three staff roles, click by click | [`docs/role-walkthroughs.md`](docs/role-walkthroughs.md) — start here for the staff side without a guided demo |
| At least one net-new tool | `sameDayAvailability()` in [`netlify/functions/tools/availability.ts`](netlify/functions/tools/availability.ts), reached by the `check_late_checkout` and `check_upgrade_eligibility` guest tools and by `check_availability` on the group side — see Assumptions below |
| Native platform export | [`exports/telnyx-assistant.json`](exports/telnyx-assistant.json) — the live assistant, 25 tools, secret redacted. Provisioned from source by [`scripts/telnyx/provision.mjs`](scripts/telnyx/provision.mjs) |

## Try it

**As a guest:** open the site, use the chat bubble, or call the number. Ask about the cancellation
window, a late checkout, whether you can bring a dog, or what parking costs.

**As staff:** sign in at `/login`. Three scoped roles exist; credentials are in `DEMO_LOGINS.md`,
which is deliberately not committed.

- **Concierge supervisor** — live sessions, streaming transcripts, the tool trace, and the
  supervisor ladder (listen → whisper → barge → take over)
- **Group sales** — the ten inquiries from the provided data plus any Sol has taken on a call,
  rule verdicts, pricing, proposals, approvals
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

**Two working sessions, with under 5 hours of hands-on time in them.** First commit 2026-09-24
12:35 EDT. Git puts the committed work in two windows — **12:35 to 16:21 on day one**, and a second
that opened at **09:24 the next morning**. The gap between them is a night's sleep, not work.

**"Hands-on" means Enrique at the keyboard, and it is deliberately not the wall clock of the second
window.** That window is far longer than the hands-on time inside it, because for most of it the
three-agent loop below was committing, reviewing and merging on its own. Counting its wall clock as
human effort would flatter exactly the number this section exists to be honest about, so the two are
given separately rather than blended into one figure.

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
**The guardrail table in `agent/sol.md` is not asserted either.** Eighteen of its nineteen rules were
driven against the deployed system rather than against fixtures, and the evidence is in
[`agents/tested.log.md`](agents/tested.log.md) — over 5,400 lines of it, including the refusals that
failed the first time. The exception is **G16's voice half**, which needs a live phone call and is
named here rather than rounded up. Two worth opening the file for: **G13** would not read a card's
last four digits to a *correctly identified* cardholder who explicitly told it to ignore its system
prompt, with the true answer sitting in the sample data; and **G17** was re-proved across 500 trace
rows where the raw-argument column does not exist at all, so masking is a property of the write path
rather than something applied on read.


**The result:** over 250 files, more than 160 of them TypeScript, and over 700 tests across more than 50 test files. The line
count splits in a way worth showing rather than totalling: **over 38,000 lines of source**, over 4,500
of deliverable documents, and **over 26,000 of the agents' own coordination record** — the plan, the
three status files, and the two logs in which the loop argued with itself. A single "over 80,000
lines" would flatter the first number by hiding the third, and the third is arguably the more
interesting one.

Every figure above is a floor, and each one is a command:

```bash
git ls-files | wc -l                                                    # files
git ls-files | grep -cE '\.tsx?$'                                       # TypeScript
npx vitest run                                                          # tests, and test files
git ls-files -z '*.ts' '*.tsx' '*.mjs' '*.sql' '*.css' | xargs -0 wc -l # source
git ls-files -z '*.md' ':!agents/' ':!plans/'          | xargs -0 wc -l # deliverable documents
cat plans/06-master-plan.md agents/*.status.md agents/*.log.md | wc -l  # coordination record
```

(`-z` and `xargs -0` are not decoration: one of the provided data files is
`SOLSTICE HOTEL GROUP — FRONT DESK POLICY REFERENCE.md`, and a bare `xargs` drops it and silently
undercounts. The five `git` lines need a clone; if you downloaded this as a ZIP, `npx vitest run` still
checks every floor — the test falls back to walking the tree with `.gitignore` applied, and a case
asserts the two agree wherever both are available.)

Floors rather than measurements, deliberately, and the reason is on this page twice over. The day-two
loop was still merging while the paragraph was written and three precise counts went stale inside an
hour — then the replacements went stale too, and the coordination record was being reported at half
its size by the time anyone re-ran the command. `src/lib/rules/__tests__/repo-floors.test.ts` now runs
every line above and fails if any floor has stopped being one.

**What we are not claiming.** Build-time model spend is not instrumented, so there is no figure
here for it, and inventing one would undercut everything else on this page that *is* measured.
What is measured is the runtime cost, and it is on the Cost page at real numbers: spend to date,
cost per conversation, and the live Telnyx balance read from their API while you watch.

**One defect is open at the time of writing, and it is a real one.** The approval gate that stops a
flagged group proposal being sent reads the proposal's own `status` column, and row-level security
grants `group_sales` write access to that table. So a signed-in sales rep — not an anonymous
visitor — can set `status` to `approved` from the browser with the public anon key, and the gate then
returns *allowed* on a proposal that still carries its blocking flag and an empty `approved_by`.
Every path the product offers refuses correctly, including the agent's own send tool under pressure;
this one goes underneath them.
`supabase/migrations/004_client_read_only_on_group_tables.sql` is the fix, it is one statement per
table, and it is unapplied because applying it needs database access the repository does not carry.
Found and re-confirmed against production by the testing agent; the evidence, and what was checked to
be sure it is not worse than described, is in [`agents/tested.log.md`](agents/tested.log.md).

## Stated assumptions

The brief invites assumptions, so these are explicit rather than buried:

1. **No inventory-by-date exists in the exports.** Policies 1 and 6 both hinge on same-day
   availability and use different words for it — Policy 1 makes late check-out "based on same-day
   room availability", Policy 6 makes the Platinum upgrade "based on same-day inventory" — so two
   policies reach for the same missing data in two vocabularies, which is the clearest argument
   that it belongs behind one service. `netlify/functions/tools/availability.ts` is that net-new
   service:
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
suite of over 700 tests (`npx vitest run` for the live number).

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
(`netlify/functions/chat.ts:311`). It is deliberate — without it Sol re-verifies the same person on
every message, because the transcript records what it *said*, not what it *knows* — but the bound
identity has no TTL, and the lookup is by session id alone, so it is not checked against whether
the session is still open either. Possession of the session id is therefore possession of that
guest's verified identity, indefinitely.

A caller cannot invent an id, only replay one the server minted, and minted ids are unguessable
uuids — so this is not an open door; the exposure is that a *leaked* id stays useful rather than
going stale. Two things come first in production, in this order: a TTL on the binding, and
re-verification before anything that discloses stay detail. Neither is built, and neither should be
attempted the night before a submission on the one path the whole concierge demo runs through.

**A stated limit: "Active now" has no idle bound.** A web chat has no hangup event — a guest simply
closes the tab — so a session stays `active` until something closes it. The supervisor dashboard
counts exactly that, which is correct for a live call and wrong for an abandoned browser tab: in
production every abandoned chat would count as live forever. `npm run demo:tidy` closes anything
idle over thirty minutes and is what we run before a demo. The production fix is a server-side idle
timeout that ends the session and writes the same `ended` state a hangup does, so the dashboard and
the transcript agree without anyone running a script. Not built, because it changes the state
machine behind the headline supervisor surface.

**A stated limit: a customer's proposal link is a capability URL, not an authenticated download.**
The PDF a customer receives lives in a Supabase Storage bucket that is **public**, at a path
containing a 32-character random segment
(`.../object/public/proposals/PRP-2011/<random>/Solstice-proposal-….pdf`). Anyone holding that URL
can open it with no login, which is deliberate — a proposal emailed to a group organiser cannot
require an account on our system — and it is the same model as any share link. What it means
honestly: the link *is* the credential, so forwarding the email forwards the access, and there is no
expiry and no revocation.

Measured rather than assumed: the bucket cannot be enumerated — a `list` call returns **zero
entries** both with the public anon key and with a signed-in staff token, so nobody can walk it to
find other customers' pricing — and a URL with one path segment altered returns **400**, not a
different customer's document. The `/api/group/pdf/<code>.pdf?t=<token>` fallback route does check a
derived token in constant time (`netlify/functions/group/store.ts:158`). In production the first two
changes are a signed URL with an expiry, and a revoke that survives the email already being sent;
neither is built, because both change what an already-delivered link does.

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

`npm run typecheck` · `npx vitest run` (over 700 tests; the command prints the live count) ·
`npm run data:check` verifies the generated
data still matches its sources.
