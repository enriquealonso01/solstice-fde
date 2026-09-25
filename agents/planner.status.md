# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 93 — 2026-09-25 ~19:38 EST

### Inbox empty. No lock held. `SUBMISSION.md` count fixed (PR #87).

### Two agents fixed the voice leg on the chat branch. The provisioner settles it

**What they got right, and I had wrong twice:** `configured` is TRUE because `DEMO_PHONE` is the
`??` fallback and is set on the deploy, so the **announce** path is live. The Tester also retracted
a twelve-hour-old request asking Enrique to unset a variable that was already unset, and recorded
the rule: **read the expression, where it runs.**

**Their evidence:** `POST /api/tools/transfer_to_human {"channel":"voice"}` → `escalation_id: None`,
"Announce the handoff before it happens." From which both concluded *G16 on the voice leg*.

**`provision.mjs:586-603` performs the conversion, it does not just describe it:**

```js
if (name === 'transfer_to_human') { …
  tools.push({ type: 'transfer', timeout_ms: 25000, transfer: { targets: […],
    warm_transfer_instructions: 'Summarise the guest, the reservation, what has been tried,
    and the exact ask. Then hand over.' } })
  continue }
```

**No webhook is registered under that name for voice.** `registry.ts:42,153` keeps it for **chat**.
The export's 25 tools agree: native `transfer`, no `transfer_to_human`.

So their instrument was right and **answered a different question than the one asked of it** — a
`POST` to the endpoint, with `channel` as a payload field, says nothing about whether the voice
assistant calls it. The provisioner says it cannot.

### The gap they found is real; it is not where the fix went

On voice the only guidance is `warm_transfer_instructions`, and it contains **no escalation
requirement**. The announce-before-connect window is still open on the leg G16 names, while #85
closed the same window on chat — where PR #7 had already closed it.

**Remedy: one sentence in `warm_transfer_instructions` + a `--refresh`.** It does not touch
`agent/sol.md` and does not spend the 681-character margin.

### On being the one to say this

I have no standing on this branch from past accuracy — I was wrong about it twice. What I have is
an artefact that answers the **routing** question where theirs answers an **endpoint** question,
and it is checkable in a minute without spending anything. That is the form a disagreement should
take when the person raising it has a bad record on the topic.

**Still unobserved by anyone:** whether a real call reaches the native transfer. Gated on $3.09.

### The plan is accurate and correctly ordered

**Enrique:** the SQL paste · Telnyx top-up · T34 rotation · T21.
**Agents:** **T36** (one sentence, precisely located) · **T35**'s two lines.

### The single most important remaining item

**The `drop policy` paste** — still the only open item with a live security consequence.
