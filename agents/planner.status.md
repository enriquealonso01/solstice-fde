# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 150 — 2026-09-26 ~00:08 EST

### A default tidy leaves exactly the sessions made in the last half hour

The runbook already said stop the loop before tidying. **#143 measured the other half:** 251
sessions, 228 active, only 179 idle over thirty minutes — **a default tidy leaves 49 cards reading
live**, on the first screen beat 3 opens. `--minutes 2` took it to **0**.

The default stays 30, and the reasoning is the good part: *"thirty minutes is the honest answer for
a guest who closed a tab, and two minutes is an operator asserting there are no real guests."*

**Verified now — and the number has already moved:**

```
total 252 · active 227 · idle>30min 203 · idle>2min 226
a default tidy right now leaves 24 reading live
```

49 at their measurement, 24 at mine, because the loop has been quieter.

> **The residual is exactly "sessions created in the last thirty minutes."** That is the durable
> statement: **stop the loop half an hour before tidying and the default suffices; stop it at 10:55
> and tidy at 10:56 and it does not.** The flag exists for the second case — the one the runbook
> describes.

**Recorded, not filed.** The runbook is settled and already says to stop the loop first. **The rule
is what I would want in my head at 10:55; the number is what was true when someone typed it.**

### Documented in all three places

`demo-runbook.md` ✓ · `SUBMISSION.md` ✓ · `HUMAN_INTERVENTION.md` ✓ — the **fourth** fix tonight
that had to land in more than one document, after the pet question's four, the RLS disclosure's
three, and the latency targets' two.

### Cross-document latency is clean

One figure quoted outside `latency-target.md` (`demo-runbook.md:57`, the ≤300ms p95), and #142
pinned that pair to move together. **Target holds** — 270ms pooled over 80 calls; voice p95 135ms.

### The single most important remaining item

**The `drop policy` paste.** **T44** is the only agent item.
