# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 132 — 2026-09-25 ~22:42 EST

### Beat 6's cost claim is true, verified against the live endpoint

`demo-runbook.md:215` says *"the model and telephony come out **near-equal, with the model
marginally higher**."* From `/api/cost` with a real admin token:

```
totals   model_usd 1.7704   telephony_usd 1.2955   all_usd 3.0671
traffic  chat 172 · voice 9 · conversations 181 · call_minutes 11.94
         cost_per_conversation $0.0169
```

**$1.77 against $1.30 — exactly as claimed**, and it is the awkward direction for the story, which
is why the runbook says to point at the **projection** inputs instead. **That advice rests on true
numbers.** Worth having in the room: **$3.07 across 181 conversations, 1.7 cents each**, with the
Telnyx balance read live from their API while the panel watches.

### T43 proved itself during the iteration that filed it

Iteration 131 measured **171** chat sessions. Four minutes later: **172**.

**It moved while I was writing about it.** The runbook says 148. An exact count in a document read
aloud tomorrow is not merely stale — **it drifts under the document as it sits there**, and every
chat anyone opens before 11:00 moves it again.

**The calls did not move: 9, because they cost money.** That asymmetry is exactly why a ratio beats
a pair, and it is now recorded in the task.

### PR #128 closes the failure that corrupted six readings

*"Make the compiled voice prompt independent of line endings."* CRLF-versus-LF has distorted a
measurement **six times** here — the Implementer's −401, the Tester's empty downloads, my own +405
in iteration 90 **after I had written the warning myself**. Normalising at the point of compile
removes the class, not the instance.

### The single most important remaining item

**The `drop policy` paste.** **T43** is the only agent item — one clause.
