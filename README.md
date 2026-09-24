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
| At least one net-new tool | `availability_service` — see Assumptions below |
| Native platform export | Telnyx assistant provisioned from source by [`scripts/telnyx/provision.mjs`](scripts/telnyx/provision.mjs) |

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

## Stated assumptions

The brief invites assumptions, so these are explicit rather than buried:

1. **No inventory-by-date exists in the exports.** Policies 1 and 6 both hinge on "subject to
   same-day availability", so `availability_service` is the net-new tool: deterministic, bounded by
   real room counts, and labelled `provenance: "simulated_inventory_service"` on every result. In
   production this is where the PMS plugs in.
2. **A guest is identified by caller ID or a confirmation number, never by claiming a name.** Two
   guest pairs in the data share the same last four digits, so lookup returns found / ambiguous /
   not_found and refuses to guess.
3. **Payment data is last-four only** in the export; a real PMS would hold a token. Card digits are
   never returned to the model and never spoken.
4. **`SOL-PVD.base_rate_suite = -395` is a data error, not a price.** It is quarantined at the
   access layer, visible in the admin UI, and never used for pricing.
5. **Providence's "Boston-area sister property" does not exist in the directory.** The agent surfaces
   the referral and states plainly that it cannot quote there.
6. **The `notes` column of the inquiries CSV is the challenge author's answer key.** It is stripped
   before anything reaches the database or the model.
7. **INQ-2010 is also inside a blackout**, not only over the seasonal discount cap, which the sample
   data's own note does not mention. Both are reported.

## What is real, and what is not

Worth being precise about, because a demo that overstates itself is worse than a smaller honest one.

**Real:** the deployed site and API; Postgres with row-level security enforcing role scoping;
Sol answering on chat and on a real phone number; live transcripts streaming to the supervisor
console; the rules engine and all ten inquiry verdicts; proposal generation with PDFs; 241 passing
tests.

**Not yet exercised on a live call:** the supervisor ladder. The mechanism is built from documented
Telnyx primitives, but whether a supervisor leg attaches to an `ai_assistant_start` leg is not
documented either way, and a conference-based fallback is written down for if it does not.

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

`npm run typecheck` · `npx vitest run` (241 tests) · `npm run data:check` verifies the generated
data still matches its sources.
