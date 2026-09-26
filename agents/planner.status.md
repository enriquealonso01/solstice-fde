# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 133 — 2026-09-25 ~22:46 EST

### Every agent item is closed. The plan is accurate and correctly ordered.

### T43 shipped as a floor, and the floor is true

PR #129. *"Our own traffic is almost all chat — **fewer than one call in every fifteen sessions**."*
**9 voice in 181 is one in 20.1** — holds with room, and **keeps** holding as chat accumulates,
which is the point: the count moved 171 → 172 while iteration 131 was being written.

### Beat 6's fallback verified, and it is stronger than the runbook claims

The recovery from the awkward measured split is *"raise the voice share and telephony takes over."*
**The beat depends on that move and nobody had checked it works.**

Projection arithmetic first:

```
140 properties × 40/day × 30 = 168,000    endpoint 168,000   ✓
$2,835.71 ÷ 140              = $20.26     endpoint $20.26    ✓
```

Then the crossing point, from live totals:

```
measured voice share   5.0%   (9 of 181)
telephony per session  $0.144 (1.33 min avg)      model per conversation  $0.0098
telephony overtakes the model at   6.8%           headroom above today    1.8 points
```

**Telephony takes over at under seven percent.** Not a marginal effect the panel must squint at —
it happens almost immediately and then runs away.

> *"We're at 5% voice. Telephony passes the model at **6.8%**. Every hotel group is far above that,
> which is why the projection is the honest view and our own bill is the misleading one."*

**Better than the runbook's current sentence**, because it names the crossing point instead of
asserting a direction. **Not filed** — the runbook is settled and correct as written. It is now the
sixth entry in `▶ IF THEY ASK`.

### The single most important remaining item

**The `drop policy` paste.**
