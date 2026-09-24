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
Deployed serverless adds roughly 0.3–1s on top.

| Configuration | First event (tool chip) | First prose token | Behavioural violations |
|---|---|---|---|
| Sonnet 5, adaptive thinking | 1626ms | 3312ms | 2 of 4 |
| **Sonnet 5, thinking disabled** | **1332ms** | **4168ms** | **0 of 4** |
| Sonnet 5, disabled, narration on | 1179ms | 2749ms | 1 of 4 |
| Haiku 4.5 | 679ms | 1235ms | 2 of 4 |

Six real turns captured end to end against the deployed site landed between **2.4s and 4.5s to first
token**, consistent with the table plus serverless overhead.

We missed the 800ms target. Not by a little.

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
is happening. The tool chip renders at ~1.3s saying "Checking the service recovery window", which is
grounded, specific, and arrives well before prose. A guest watching a named tool run does not
experience four seconds of silence.

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
2. **Warm compute.** Serverless cold starts contribute the 0.3–1s gap between local and deployed.
   A container with a warm pool removes it.
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
