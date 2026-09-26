# Response latency: the target, the measurements, and what we traded

The brief asks for a latency target we can justify rather than guess. Here is the honest version,
including the part where our first target was wrong.

## What we set before measuring

During planning we set **p50 ≤ 800ms, p95 ≤ 1.5s to first audio**, reasoning from human turn-taking:
conversational gaps beyond roughly 1.2s make callers repeat themselves or talk over the agent.

That reasoning is still sound. The number was set before a single call had been made, which is
exactly the kind of target that survives a planning document and dies in production.

## What we actually measured

Medians across four scenarios per configuration, chat channel, run against the live API.
Deployed serverless adds roughly 0.2s on a warm function and **1.0–1.9s on a cold one** — measured,
not estimated; see the cold-start note below. The figures in this table are warm.

| Configuration | First event (tool chip) | First prose token | Behavioural violations |
|---|---|---|---|
| Sonnet 5, adaptive thinking | 1626ms | 3312ms | 2 of 4 |
| **Sonnet 5, thinking disabled** | **1332ms** | **4168ms** | **0 of 4** |
| Sonnet 5, disabled, narration on | 1179ms | 2749ms | 1 of 4 |
| Haiku 4.5 | 679ms | 1235ms | 2 of 4 |

We missed the 800ms target. Not by a little.

### Re-measured against production on 2026-09-25

The numbers above were captured while building. Six fresh turns against the deployed site, each a
new session, four scenario shapes:

| Turn | First signal (tool chip) | First prose token | Tools |
|---|---|---|---|
| Policy lookup | 2032ms | 2999ms | `get_policy` |
| Identified stay | 1545ms | 5040ms | `identify_guest`, `check_late_checkout` |
| Service recovery | **none** | 870ms | none |
| Group routing | 927ms | 2850ms | `create_escalation` |
| Policy lookup 2 | 3132ms | 4664ms | `get_policy` |
| Identified stay 2 | 1018ms | 3603ms | `identify_guest`, `check_late_checkout` |

**First token p50 3301ms, inside the 4s target. First signal p50 1545ms, 45ms over the 1.5s
target.** The spread is wider than the 2.4–4.5s we first reported: **870ms to 5040ms**. Fastest and
slowest both moved, and the fast end is a turn that called no tool at all.

Two things we are stating rather than smoothing over:

- **The signal target is currently missed, narrowly.** 1545ms against 1.5s, on six turns. We are
  not moving the target to match the measurement; the target was reasoned from turn-taking, not
  from what we happened to score.
- **One turn in six ran no tool, so there was no chip to render.** The argument below depends on a
  tool chip covering the wait, and on that turn there was nothing to cover it with. It did not
  matter there — prose arrived at 870ms, faster than any chip — but the general claim needs the
  qualifier: when Sol answers from the conversation alone, the guest waits for prose with no
  intermediate signal.

### Re-measured at 2026-09-26, after three prompt changes — the signal target is now met

The prompt grew by about 650 characters that night (three edits to `agent/sol.md`), and every one of
them adds input tokens to **every** chat turn, so these numbers were re-run rather than assumed. Same
six scenarios, fresh sessions, twice:

| | pass 1 | pass 2 | committed |
|---|---|---|---|
| First signal p50 | **905ms** | **1009ms** | ≤ 1500ms |
| First prose token p50 | **2589ms** | **2246ms** | ≤ 4000ms |
| First token range | 723–4056ms | 612–6086ms | — |

**The signal target is met, on both passes, with about 40% of margin** — so the confession above, that
we miss it by 45ms, describes a build that no longer exists. It is left standing because it was true
when written and the reasoning behind it is the part worth keeping.

**And the slow tail is slower than we published.** One turn reached 6086ms to first prose, against the
870–5040ms range stated above. Six turns is not a p95 and neither pass claims to be one; what two
passes do establish is that the *median* is comfortably inside both targets while the *worst case* is
outside anything we have written down. If a reviewer sees one slow answer, that is the honest
explanation, not a fluke.

**The voice-side commitment holds, and this one is properly sampled.** `POST /api/tools/get_policy`,
60 warm calls: **p50 102ms, p90 122ms, p95 135ms, max 164ms, and nothing over 300ms.**

A note on how that number was nearly reported wrongly. A first run of 20 calls gave a p95 of **950ms**
— a single cold instance, which at n=20 *is* the p95 by construction. Written up from that sample it
would have said the published target is missed by 650ms, in a deliverable a reviewer can test in one
command. The larger sample says the opposite. A tail statistic from twenty samples is the worst of
twenty, not a p95.

## Why, specifically

The time is **model generation, not our code**. Three things we checked rather than assumed:

- **Prompt caching is already working.** A 4,541-token prefix of tools and system prompt is cached
  and read on every subsequent round, logged per turn as `cache_read_tokens`. There is no win left
  there.
- **Trimming the system prompt would not help.** It is about 1,000 of those cached tokens. Ingestion
  is not the cost.
- **Disabling extended thinking made first token *worse***, 3312ms → 4168ms. At low effort, adaptive
  thinking barely fires, so there was little to remove.

The only configuration that meaningfully cut latency was switching model, and that cost us something
we were not willing to pay (below).

## The target we now hold ourselves to

We split it, because the two channels have genuinely different budgets.

**Chat: first *signal* p50 ≤ 1.5s, first prose token p50 ≤ 4s.**
The signal that matters in a chat interface is not the first word, it is visible evidence that work
is happening. On a turn that calls a tool, the chip renders at a p50 of about a second — 905ms and
1009ms on the two re-measured passes above — saying something grounded and specific such as
"Checking the service recovery window", and arrives well before prose. A guest watching a named tool run does not experience four seconds of silence.

The caveat, measured rather than assumed: **on a turn that calls no tool there is no chip**, and
the guest waits for prose. In our sample that turn was also the fastest to first token, so the gap
did not bite, but the mechanism is not a guarantee and we would rather say so than let the target
read as covering every turn.

**Voice: tool webhooks p95 ≤ 300ms, which is the part we own.**
On a call, Telnyx owns speech recognition, turn-taking, barge-in and speech synthesis. Our
contribution to the turn is the webhook round trip, and that is where our target belongs. End-to-end
first-audio on a live call is **not yet measured**; it needs a funded call against the provisioned
number, and we will not quote a number we have not seen.

## What we traded, deliberately

`SOL_THINKING=disabled` is set in production. It is **slower on first token and the only
configuration that produced zero behavioural violations** across the four adversarial scenarios
(quoting a parking figure, promising a refund, promising a sold-out suite, leaking identity).

With adaptive thinking on, Sol created a real escalation and then failed to tell the guest it had
done so. That is a worse failure than two seconds of latency, and a hotel would agree.

We also declined to move chat to Haiku 4.5, despite it being nearly three times faster to first
token. In the refund scenario it derived the 72-hour service-recovery arithmetic itself from the
policy text instead of calling `check_service_recovery_eligibility`. It got the right answer, which
is the dangerous kind of wrong: model-side policy reasoning is precisely what this architecture
exists to prevent. Voice runs Haiku, so keeping Sonnet on chat also preserves a second opinion
across two different models.

## What we would do in production

In rough order of expected return:

1. **Keep the first signal, spend the prose.** Narration before a tool call cuts first token to
   2749ms, but it is a stock phrase, a perception trick rather than a real gain. It is one env var
   (`SOL_NARRATION=on`) if a room turns out to be unforgiving.
2. **Warm compute.** Serverless cold starts contribute the gap between local and deployed, and it
   is larger than this document first claimed. Three independent measurements of the first request
   after an idle period: **1.31s** (24-call run), **1.86s**, and **1.299s** on `/api/chat`. Warm
   requests immediately after: 0.285s, 0.229s, 0.207s. So a cold start is roughly **6× the warm
   figure and 6× the ≤300ms p95 published above** — not the 0.3–1s originally written here.
   A container with a warm pool removes it. Until then it is a checklist line: the pre-demo
   checklist in `docs/demo-runbook.md` warms both functions with a `curl` that writes no session.
3. **Route by difficulty.** A fast model for identification and simple lookups, Sonnet for anything
   touching policy authority. The tool layer makes this safe because the rules do not live in the
   model.
4. **Speculative tool prefetch.** Caller ID is known before the first word; `identify_guest` and
   `get_reservation` can run while the guest is still speaking.

## The honest summary for a stakeholder

We set a target from first principles, measured against it, missed it, and found the cause was model
generation time rather than anything we could engineer away. Given a forced choice between a faster
agent that occasionally promises a refund it cannot honour and a slower one that never does, we took
the slower one, and made the interface show its work so the wait is legible rather than dead air.
