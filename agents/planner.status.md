# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 205 — 2026-09-26 05:19 EST

**One agent task is open: T57.** **T56 shipped at It144 — and it caught an error in the numbers I handed it.**

### I corrected a sampling error by committing a convention error, in the same direction

I filed T56 accusing `docs/latency-target.md` of publishing a percentile from six turns that landed on the side
it wanted with no `n` beside it. I then handed the Implementer a census **first-signal p90 of 1488ms** and wrote,
in the task and in the banner, that the 1.5s target *"is met."* It144 refused to copy my figures — *"I do not
copy a figure from a task description"* — recomputed from the 351 rows, and found it wrong. Re-derived here from
a fresh pull:

```
first_event_ms  n=338  target 1500ms
  p50  nearest-rank 1079   interpolated 1081   [mine 1079]  agree
  p90  nearest-rank 1502   interpolated 1492   [mine 1488]  index 304 vs my 303
  p95  nearest-rank 1792   interpolated 1782   [mine 1780]
  over target: 34 of 338 = 10.1%
```

**My helper took `a[floor(q*(n-1))]` — index 303 of 338 — where nearest-rank takes 304.** One position, and
because **10.1% of turns exceed 1500ms the p90 sits exactly on the boundary**, that one position was the whole
difference between *"met"* and *"2ms over."* Every tail figure I filed was low the same way: first-token p90
**4321/4299** not 4290, p95 **5276** not 5155, total p90 **7869** not 7638.

**Stating `n` is not stating your method.** I named the sample size and not the convention, and the error ran in
the direction of the conclusion I already wanted — which is the direction errors run when you know what you want
the answer to be. The p50s were right under either convention (1079ms / 2608ms), and that is the half the
headline rests on.

### What the deliverable says now, which is better than what I asked for

*"Met at p50 (1079ms), level at p90"*, both conventions printed, **34 of 338 — 10.1%** beside them; first prose
token *"over at p90 either way"* — 4321/4299ms, ~300ms past a 4s target, 52 of 338 beyond it. **In our favour on
the headline, against us on the tail**, which is the shape an honest re-measurement usually has. Read in place at
`docs/latency-target.md:83-138`; the supersession of the old six-turn conclusion is stated at line 71, so a
top-down reader meets it before the stale number.

### It declined one instruction and was right to

T56 said the *"45ms over"* sentence should be **gone**. It144 left it standing — the doc supersedes it in the next
section, and *"deleting an honest superseded admission would contradict the pattern this project has used for
every other correction."* **50 insertions, 0 deletions.** I accept it, and applied the same rule to myself: the
T56 section and the iteration-203 entry keep their wrong p90 with a correction block at the head rather than a
quiet rewrite. The **banner** is the exception, because it is rewritten every iteration and is what Enrique reads
— it now carries the straddle and says whose error it was.

### The error is now guarded in code

`latency-claims.test.ts` — new, **5 tests, run green this iteration** — requires a sample size beside any
*measured* percentile, keeps the census window and its re-derivable query, and in its last case forbids the
document from claiming the first-signal target is met at p90: *"picking the convention that clears the target is
the same error as picking the sample that misses it."* **A guard written against my mistake by the agent that
caught it.** It deliberately does not pin the measurements.

### Open

| # | Item | Owner |
|---|---|---|
| 1 | **`drop policy` ×3** — **only Enrique can.** SQL at **609**, heading ***"### What to run"*** | Enrique — **do** |
| 2 | **Top up Telnyx** — $3.03, no credit line, ~6 calls, hard stop at zero | Enrique — **do** |
| 3 | **T21** — **delegable**: an agent has the key and declined on judgement | Enrique — **do** |
| 4 | **T34** — SIP credential. **Accept; no action** | Enrique — decide |
| 5 | **Brief PDF** — absent from the public tree. **Leave it; no action** | Enrique — decide |
| 6 | **Your own address in this file.** Removing it breaks nothing. **No recommendation** | Enrique — decide |
| T57 | Scope the live-modification guard to the SOL-PHX object | any agent |

Tester silent since 20:26 (**8h53m**); its ledger has no open findings. Inbox and In progress empty. No lock
held; I took none. Guards re-run after my edits — `intervention-routing`, `doc-paths`, `list-counts`,
`latency-claims`: **109 green**.

### The single most important remaining item

**The `drop policy` paste** — still the only item nobody else could do for him. **T57** is the only open agent
task, and it is hardening rather than repair: every pointer in that document is correct today.
