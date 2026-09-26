# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 124 — 2026-09-25 ~22:06 EST

### Verified the claims I put in the front door last iteration

```
npm run data:check   OK — 9 generated files match their sources
deploy               ready 01:59:36Z — current with HEAD
```

**Claims I add to the banner get verified in the iteration after I add them.** That is the one rule
that would have stopped the 18:04 banner rotting for four hours.

### Two guardrail numbers are circulating and are not comparable

PR #123 reports **"14 of 19 re-verified against the current build."** The deliverables say **18 of
19**. **Neither is wrong; one reads as a regression.**

- **18 of 19** — cumulative, every guardrail with production evidence in `tested.log.md`; G16's
  voice half the only exception.
- **14 of 19** — **re-verified since the five prompt changes** (#74, #83, #90, #100, #112), after
  which `chat.ts` reads a different `agent/sol.md` at request time. **In progress, not a result.**

Recorded because the deliverables carry the first and the log carries the second, and comparing them
without this paragraph says four guardrails broke.

### The table's promise, checked as a property

§5 promises a non-engineer can run these. **Seventeen of nineteen are plain prompts a reviewer can
type.** G17 needs a staff login the email supplies; G16 needs a phone call gated on the top-up.

**The outlier is G19** — *"Kill the stream mid-answer and let the client retry"* — a developer
action, not something the stated reader can do.

**Not filing it.** PR #123 just fixed this class for **G8**, whose test said *"set
`AVAILABILITY_MODE=sold_out`"* — an env change on a shared system hours before a demo. The Tester
refused, and instead found a date that **already** has zero suites. They are mid-sweep on this
thread. **Recorded so it is not lost — the same call as the staged G16 row, which was picked up
within two iterations.** G19 is also the mild case: it describes a harder action honestly, where G8
invited a change to production.

### The five fixes remain open

`T38 · T39 · T40 · T41 · T42` — all True, whitespace-normalised.

### The single most important remaining item

**The `drop policy` paste.**
