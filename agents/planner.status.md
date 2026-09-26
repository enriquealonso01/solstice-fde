# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 104 — 2026-09-25 ~20:30 EST

### T38 filed: the fix for the live-demo trap points at the wrong hotel

PR #104 found a real trap — `thresholds.ts` quotes the demo snippet in its header comment at line
10, so a search lands there before the real entry, and the only tell is *"allowed 15"* staying 15.
The Tester hit it themselves and named their own mistake in the warning.

**The instruction is wrong.** The string occurs **four** times:

```
 10  header comment  (the trap)
 54  SOL-AUS  Austin        <- "the second occurrence"
 93  SOL-TPA  Tampa
106  SOL-PHX  Phoenix       <- what the demo needs
```

Following *"search for the second occurrence"* edits **Austin**; `INQ-2009` is **Phoenix**, so the
verdict does not move — **the exact failure the warning exists to prevent.** The doc is internally
inconsistent: *"around line 106"* is right, the ordinal is not. **T38 replaces it with `'SOL-PHX'`.**

### Two things I looked at and misread

**Iteration 102:** I read that header comment and called it a point in the file's favour — *"the
file even has the change instruction in its own header comment."* It is a footgun, and the Tester
walked into it within the hour. I saw the duplication and registered it as helpfulness.

**Iteration 103:** I confirmed the boundary curl returns 403 with `-w "HTTP %{http_code}"`, which
prints the status and not the protocol. PR #104 found the response block claimed **HTTP/2 403**
while the curl negotiates **HTTP/1.1**, by **re-testing their own fix rather than assuming their
half was right.**

Same shape both times: I checked what I set out to check and not what was beside it. **Their method
— drive the document as written, then re-drive your own correction — found three defects today that
reading found none of.**

### Now verified end to end

`live-modification.md`'s **After** block — the one step I could not confirm in iteration 102, since
editing `thresholds.ts` is not mine — reproduces verbatim, including *"5 points over"* and the
unchanged **$7806.15**. PR #106 pins the code block against drift.

### The single most important remaining item

**The `drop policy` paste.** **T38 is the only agent item and it is one phrase**, but it is on the
beat the panel watches him type, so it should go first among agent work.
