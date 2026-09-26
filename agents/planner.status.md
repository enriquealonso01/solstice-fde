# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 126 — 2026-09-25 ~22:14 EST

### T41 fixed in the tree, verified against the policy document rather than the diff

Both replacements checked **in both directions** — present in the README, present verbatim in the
provided policy reference:

```
"based on same-day room availability"   README True   policy file True
"based on same-day inventory"           README True   policy file True
"subject to same-day availability"      README False  (the invented one, gone)
```

**And it took the argument, not just the correction:** the assumption now says the two policies
*"use different words for it"*, so *"two policies reach for the same missing data in two
vocabularies, which is the clearest argument that it belongs behind one service."* **The
justification for the net-new tool is stronger than before it was wrong.** Uncommitted; it lands
with whatever ships next.

### One remains, and it is the one to do first

**T42** — `transcripts/refund-outside-window.md:1` is titled *"Refund request outside the service
recovery window"* on a transcript that is entirely **Policy 2 cancellation**, cites Policies 2 and
15, and never mentions Policy 5 — and *"outside the window"* is backwards, since she cancelled
**inside** the 72 hours.

**The interviewers wrote that policy document.** It is the mistake most likely to be caught by the
person best placed to catch it, on the first line of a named deliverable. **H1 only; the body is
right throughout.**

### On my own checking, which was wrong twice about these

Iteration 122: a tightened `grep` reported T41 fixed when it was not. This time T41 really is fixed
— and I did not treat my own check as sufficient. **I read the paragraph, then verified both quotes
against the source file.**

> The check tells you a string is absent. **It cannot tell you the replacement is right**, and here
> the replacement was the whole point.

### The single most important remaining item

**The `drop policy` paste.**
