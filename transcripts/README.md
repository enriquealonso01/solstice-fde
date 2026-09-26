# Sample transcripts

Six captures from the deployed system — five chat, one real phone call. **Every tool call, id and
timing in these files is real.** Nothing here was written by hand to read well.

**Start with `honest-handoff.md`.** Asked point blank whether a human is joining the chat, Sol answers
*"No"* and then says precisely what it did instead. That is the guardrail easiest to fail and hardest
to notice, because the polite fiction is what almost every chatbot says.

| Capture | What it shows | Channel |
|---|---|---|
| [`honest-handoff.md`](honest-handoff.md) | An agent declining to claim a handoff it cannot deliver — and, in a dated note, **two defects this build found in itself and fixed the same day** | chat |
| [`refund-outside-window.md`](refund-outside-window.md) | Honest refusal with no false promise, and an escalation carrying full context to a named authority | chat |
| [`parking-rate-refusal.md`](parking-rate-refusal.md) | Policy 12: there is no chain-wide parking rate, so no number is invented — the refusal that proves the design | chat |
| [`platinum-late-checkout.md`](platinum-late-checkout.md) | Identity verified before anything is released, then a tier benefit that is **guaranteed** rather than offered | chat |
| [`service-animal.md`](service-animal.md) | Policy 8 encoded precisely, including the ADA limits on what staff may ask | chat |
| [`voice-call.md`](voice-call.md) | The same agent, the same tools and the same rules, reached by telephone | **voice** |

**Why two captures cite `R55015` for a guest the cheat sheet calls "Denver".** `G10004` is the only guest in the supplied data with more than one reservation -- Denver 20-23 July and Austin 5-7 September -- so when a capture identifies him without a confirmation number, `identify_guest` returns both and marks the nearer one, Austin, as most relevant. Nothing is wrong in either file: a late checkout is a **tier** guarantee, so both stays give the same answer, which is what those two captures show. It matters on the *upgrade* question instead, where the two stays differ because Austin has suite inventory and Denver does not -- which is why the cheat sheet tells the presenter to give the confirmation number on that beat.

## These were re-verified against production on 2026-09-26

The captures are dated records, so they are **not** edited to track later changes — when behaviour
moves, a dated note is added instead, which is what happened in `honest-handoff.md`. But the claims
they make were re-checked against the live tools, because a transcript nobody can reproduce is an
assertion rather than evidence:

| Claim in the capture | Live result |
|---|---|
| Chicago parking rate is unavailable | `get_property_info` → `rate_available: false` |
| R55005 is outside the service-recovery window | `check_service_recovery_eligibility` → `eligible: false` |
| Michael Chen is Platinum and 2pm is guaranteed | `identify_guest` → Platinum; `check_late_checkout` → `guaranteed`, `may_promise: true` |
| Pets never, service animals always and free | `get_policy` → *"Pets are not permitted at any Solstice property, with no exceptions… Service animals as defined under the ADA are always…"* |

**`voice-call.md` is the exception**, and deliberately so: reproducing it means placing a real call,
which costs money on a balance held for the demo. It is the one capture here taken on trust from its
own timestamps rather than re-run.
