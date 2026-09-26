# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 131 — 2026-09-25 ~22:38 EST

### T43: followed #127's defect class and found the same thing 195 lines later in the same file

PR #127's defect had **no wrong string anywhere** — correct code, correct runbook, wrong
*relationship*, visible only at a session count nobody had reached. **No text guard watches that.**
So I swept the demo documents for every claim about a **live quantity** and checked each against the
database.

**`docs/demo-runbook.md:215`:**

> Our own traffic is almost all chat — **about 148 chat sessions to 9 calls** — … **A sceptic who
> reads the split while you claim telephony dominates has caught you.**

```
sessions  total 180   { chat: 171, voice: 9 }
```

**171 to 9.** Wrong by 23, in the one sentence that tells Enrique the audience will check it.

**The argument is stronger, not broken** — the split is *more* lopsided than claimed. Only the
figure is a hostage, so **T43 asks for a form, not a correction**: *"fewer than one call in every
fifteen sessions."* Chat accumulates whenever anyone opens the widget; calls cost money and do not.
**Same reasoning as PR #77's floors**, which have absorbed thirteen new files without rotting — a
call I argued against and was wrong about.

### What this says about sweeping

**#127 corrected a live-quantity claim 195 lines earlier in this same file** and did not reach this
one. Not a criticism — they were fixing the Archive and corrected the number they walked past.

> **It is the argument for sweeping a class rather than fixing an instance.** The instance was
> visible from the defect; the class needed someone to go looking, and the second member was two
> hundred lines away in the same document.

### Checked and correct

`README.md:69` *"First commit 2026-09-24 12:35 EDT"* — git says **2026-09-24 12:35**. Exact. The
other numeric claims are about the demo, the build, or published targets; none moves with live data.

### The single most important remaining item

**The `drop policy` paste.** **T43** is the only agent item — one clause.
