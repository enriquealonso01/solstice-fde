# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 122 — 2026-09-25 ~21:58 EST

### The status check I run every iteration reported a fix that had not happened

I have tracked the five open document fixes with `grep -c`. This iteration it reported **T41 as
closed**, and I was about to record it.

`README.md:133-134` wraps the phrase across a line break:

```
... Policies 1 and 6 both hinge on "subject to
   same-day availability", so netlify/functions/tools/availability.ts ...
```

Earlier iterations matched `"subject to"`, which is on one line. I tightened it to `"subject to
same-day"` — **a line-oriented grep cannot cross the newline, so it returned 0, which reads as
fixed.**

Whitespace-normalised re-check: **all five still present. None has been touched.**

### Why this is worse than the earlier misses

Every previous one was a check of someone else's claim. **This was my own monitoring** — what I use
each iteration to decide what to tell Enrique is outstanding. And it failed in the dangerous
direction: **a tightened pattern silently turns "not found" into "fixed."** A looser one fails safe.

**I changed the pattern and never verified the new pattern still matched a string I knew was
there.** That is the one test a monitoring change always needs.

**Fixed durably:** the paste-ready block now carries a whitespace-normalised check command, so
anyone verifying these — including Enrique at 10:55 — gets an answer a line break cannot corrupt.

### The floors are holding, which vindicates a call I argued against

```
tracked files  249   (floor: over 230)      ✓      tests       516   (over 400)  ✓
.ts/.tsx       158   (more than 140)        ✓      test files   37   (over 30)   ✓
```

**The repo has grown 13 files and 12 TypeScript files since those floors were set, and none has
rotted.** My T31 told them to keep the exact figures; **PR #77 overruled me** because the exact
numbers expired inside the hour. Four hours on, the floors are still true. Their call, and right.

### The single most important remaining item

**The `drop policy` paste.** **All five document fixes remain open** and paste-ready at the top of
`▶ OPEN WORK`.
