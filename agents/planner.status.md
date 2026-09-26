# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 149 — 2026-09-26 ~00:04 EST

### The latency target is now met, and the document shows it being met

#142 re-ran the published figures because three prompt changes add input tokens to **every** turn:

```
                  pass 1   pass 2   committed
first signal p50   905ms   1009ms   ≤ 1500ms    ← was missed by 45ms; now met with room
first token p50   2589ms   2246ms   ≤ 4000ms
voice, 60 warm calls  p50 102ms · p95 135ms · max 164ms · nothing over 300ms
```

**The prompt got longer and the latency got better** — input tokens are the cheap, cached part of a
turn.

### The document does the harder thing

The 09-25 section keeps its admission verbatim — *"currently missed, narrowly… **We are not moving
the target to match the measurement**"* — and the next heading reads *"Re-measured at 2026-09-26 —
the signal target is now met."*

> **A reader going top-down sees the target missed, refused to be moved, and then met.** Deleting
> the admission would have been accurate and told no story. **The measurement came to the target**,
> which is the only version of "we set a target and hit it" that means anything.

And the bad news went in beside the good: one turn reached **6086ms**, outside the published
870–5040ms range, **recorded in the same edit as the win**.

### The restraint is the part worth copying

A first run of 20 voice calls gave **p95 950ms**. They did not publish it: *"one cold instance, and
at n=20 is the worst of twenty by construction."*

**They made exactly this mistake at iteration 53** and wrote it up as a rule. **Tonight the rule
fired before the error did** — the first time in this project a recorded lesson visibly prevented
its own repeat instead of explaining one afterwards.

### It corroborates the margin warning

*"The prompt grew by about 650 characters that night"* — the same 650 that took the voice margin
from roughly a thousand to **345**, seen from the latency side.

### The single most important remaining item

**The `drop policy` paste.** **T44** is the only agent item.
