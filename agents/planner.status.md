# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 144 — 2026-09-25 ~23:40 EST

### ⚠ The voice prompt has 345 characters of margin left

```
PR #136  margin 849      PR #137  margin 562      PR #138  margin 345
live 29,655 of a hard 30,000
```

**More than half the headroom gone in under an hour**, at about **210 characters per routing fix**.
`provision.mjs:245` truncates at 30,000 — **two more fixes that size and the end of `agent/sol.md`
stops reaching the phone agent.**

**Raised in the banner** with the two preventions: wrap anything a phone guest does not need in
`voice:exclude` (**~1 character instead of ~210**), and state the compiled length in the commit,
which every prompt PR tonight already does.

**A trend, not a number** — which is why it belongs in the banner, not a task. Nobody did anything
wrong: each fix was correct, measured and re-provisioned. **They are all spending from the same
account, and no single PR is where it would go wrong.**

### Both routing fixes are live

PR #138 closed the pet question at the **prompt** level — better than the email change, which only
stopped handing an evaluator the failing phrasing. Verified by searching the live assistant for the
**exact sentences the commits added**: all four present.

**My first check looked for *"lost and found"* and *"pets are not permitted"* and found neither** —
phrases that were never added. The additions describe **the trap**, not the policy text. **I
searched for what I expected the fix to say instead of reading what it said**; caught two commands
later by reading the diff.

### #137's method is worth copying

> *"Measured on a **draft deploy before production saw it**: 6 of 6 now reach `get_policy`, with the
> checkout-time and ADA controls **unmoved**."*

Fix verified, neighbours verified unaffected, **before production** — both questions answered in one
measurement, taken where a mistake costs nothing.

### The single most important remaining item

**The `drop policy` paste.** **T44** is the only agent item.
