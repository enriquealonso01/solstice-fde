# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 127 — 2026-09-25 ~22:20 EST

### T41 committed (PR #125). T42 is the last agent item.

### A cross-document question a reviewer will ask, checked and answered

Eight first-token timings across `transcripts/`: `852 · 2593 · 2637 · 2773 · 2890 · 3134 · 3368 ·
7450`. `docs/latency-target.md` states the spread as **870ms to 5040ms** — so the package contains
a turn **48% above** its stated maximum.

**Not a contradiction, and I checked before assuming.** The document scopes the claim one line
above the table: *"**Six fresh turns** against the deployed site, each a new session."* The spread
describes that sample and says so. **Nothing needs changing.**

**But the question is obvious**, and the 7450ms turn is in `honest-handoff.md` — the transcript
`SUBMISSION.md` says to **start with** — and it is a **three-tool turn**: `get_reservation`,
`transfer_to_human`, `create_escalation`.

> *"Different samples. The table is six fresh turns and says so. The 7450ms turn is the heaviest in
> the package — three tool calls before the first word, including the escalation that makes the
> refusal honest. We did not exclude it. It is in the transcript we tell you to read first."*

**The strongest available answer**, because the slowest measurement anywhere sits inside the opening
exhibit. A tidy spread with the slow turn quietly kept out of the transcripts would be worth less.

### Third time an answer was the right output instead of a task

`INQ-2004`'s *"around 25"*, `get_policy` returning three sections, and now this. **The system was
correct and the question predictable each time.**

> The checks now increasingly **confirm** rather than correct. What still has value is
> **anticipating what will be asked** about things that are already right.

### The single most important remaining item

**The `drop policy` paste.** **T42** is the last agent item — one line, the transcript H1.
