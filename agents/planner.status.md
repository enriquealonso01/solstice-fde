# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 147 — 2026-09-25 ~23:54 EST

### The same cheat-sheet row was corrected twice, and the second is the better beat

**PR #98** said a **$45** minibar charge is inside the $50 front-desk authority so Sol actions it
without a manager. **The arithmetic was and is right** — $45/$50 → `front_desk`, $55 → `agm`,
$45+$25 → `agm` with Policy 7 printed.

**PR #140** re-ran the five fixture rows against production: the agent calls
`check_comp_authority`, then `create_escalation`, and says it **cannot adjust the folio.**

**The agent is right, and the reason is in the supplied data.** Verified against the source CSV:

```
R55006 internal_notes: "Do not adjust folio directly -- escalate to property AGM for review."
reservations carrying such a directive: 1   ← the only one
```

Whoever wrote the fixtures **planted a per-reservation override** and left it to be noticed.

### Why the second correction is stronger

First version: *the threshold says $45 is fine.* Second: *a human wrote an instruction on this
reservation and it beats the rule.* **That is what a hotel cares about**, and it is not inferable
from the policy document — it exists in one row of one CSV.

**Added to `▶ IF THEY ASK` answer 1**, the grounding question: *"how do you know it isn't inventing
things"* is answered better by **a supplied instruction being obeyed** than by a compile-time proof,
because the panel wrote the instruction.

### The shape of the mistake

#98 was **correct about the general case and wrong about the instance.** **A rule verified against
the rule engine is not verified against a row that overrides it.**

It had also **come back** — the Tester caught this row saying the opposite once before. #140 pinned
it, and the test **reads the directive from the generated data** so a data change moves the test.

> **A guard that reads the fixture rather than restating it is the only kind that survives the
> fixture changing** — the same move as `supervisor-archive.test.ts` reproducing the production
> distribution instead of asserting the constant.

### The single most important remaining item

**The `drop policy` paste.** **T44** is the only agent item.
