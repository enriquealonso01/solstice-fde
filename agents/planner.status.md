# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 106 — 2026-09-25 ~20:38 EST

### The plan is accurate and correctly ordered. T38 and T39 remain open, one sentence each.

Inbox empty. No lock held.

### Drove the README's "Try it" — the first thing a reviewer executes

It claims the group console holds *"the ten inquiries from the provided data plus any Sol has taken
on a call."*

```
data/solstice-group-inquiries.csv   10 rows   INQ-2001 … INQ-2010
live database                       13 rows   { portal: 10, voice: 3 }
```

**Exactly right**, and it **stays** right after T21: removing `INQ-2012`/`INQ-2013` leaves 10 portal
plus `INQ-2011`, which `README.md:127` calls *"the live example, captured on a real call."* The two
deleted rows are `source: voice` as well — **test calls, not junk**, which is why T21 keeps the one
with a real conversation behind it.

### Three agents, three routes, one lesson

PR #107 redid the walkthrough quote sweep and explained why version one was weak: *"it was a
**predicted enumeration** and could only ever have found rewordings I remembered."*

Third independent arrival at the same failure:

- **PR #81** (Implementer): *"the scan looked for a list of things I predicted, and a SIP URI is
  none of them."*
- **Iteration 89** (**me**): I bounded a credential sweep with five hand-picked `.env` variables;
  `TELNYX_SIP_USERNAME` was not among them.
- **PR #107** (Implementer): a sweep that could only find rewordings its author remembered.

Redone as a property: **all 55 backticked spans → the 24 that look like on-screen prose → each
checked against source.** Document correct, including five that looked wrong and are assembled at
runtime.

**The subtler half, which I would also have got wrong:** *"my sweep assumed on-screen text lives in
`src/`."* `Unknown caller +*******2646` is written **server-side** into `guest_label`. A front-end
sweep would have called a correct document wrong.

> A predicted enumeration finds what you already suspect. **It cannot distinguish "nothing is wrong"
> from "I did not think of it"** — and it returns clean either way.

### The single most important remaining item

**The `drop policy` paste.** Among agent work, **T38 and T39** — both on the beat the panel watches.
