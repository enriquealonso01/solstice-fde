# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 203 — 2026-09-26 05:00 EST

**One agent task is open: T56.** Filed this iteration, because a brief deliverable publishes a number that is
wrong against the data production has been collecting all along — and wrong **in our favour**.

### A named deliverable measured six turns when the population was one query away

`docs/latency-target.md` concludes:

> **First token p50 3301ms, inside the 4s target. First signal p50 1545ms, 45ms over the 1.5s target.**

The arithmetic on those six rows is correct; I re-derived both medians. Then I asked production for **every**
turn it has served — `tool_invocations` where `tool = 'turn_metrics'`, **351 rows**, 2026-09-24T17:30Z →
2026-09-26T08:45Z, of which **338** are the production configuration exactly (`thinking: disabled`,
`narration: off`, `claude-sonnet-5`):

```
first_event_ms  n=338  p50 1079   p90 1488   p95 1780
first_token_ms  n=338  p50 2608   p90 4290   p95 5155
total_ms        n=338  p50 3494   p90 7638   p95 9164
```

**The 1.5s first-signal target is met at p50 and at p90.** It is not missed by 45ms. And the population is the
*harder* test: the doc's table is warm, these 338 include cold starts, and only **6 of 338** exceed 3s.

Both framings hold, which matters because the doc prints *"none"* for a turn that called no tool: 33 of the 338
called none and for **all 33** `first_event_ms == first_token_ms`; across the 305 that did call a tool, p50 is
**1102ms**.

**The contradiction was already in the repo.** `doc-citations.test.ts:297` records an iteration-109 measurement
*"for the record rather than as an assertion"* — first signal 905/1009ms, first token 2589/2246ms. Within 80ms
and 20ms of the population, nowhere near 1545/3301. **A measurement filed as a note is a measurement nobody
will act on.**

T56 says what to change, what not to touch (the three published target strings that `doc-citations.test.ts`
pins, and the Sonnet-vs-Haiku argument, which rests on the violation column, not these medians), and how to
re-derive every figure.

### The 29,784 triple, upgraded from equal-length to byte-identical

The banner has claimed since 01:25 that `agent/sol.md`, the committed export and the live phone agent all sit
at 29,784. Re-checked at **04:52**, comparing **content** this time:

```
compileInstructions(agent/sol.md)   29,784   truncated: false   margin 216 of 30,000
exports/telnyx-assistant.json       29,784   byte-identical: true
LIVE Telnyx assistant (GET)         29,784   byte-identical: true
```

**Equal length is not equal content**, and until now the claim rested only on the first. The native-export
deliverable *is* the live agent, character for character. The Haiku/Sonnet split re-checked across four places;
no drift.

### The Tester's last open finding is closed in the file

Iteration 60 left FIXED-PENDING: *"the walkthrough's boundary proof shows a redirect, not the 403 it promises."*
`docs/role-walkthroughs.md:278` now calls the redirect *"the router being tidy, and on its own it proves
nothing"*, says **"do not stop here"**, and routes the reviewer to the API 403 and the bare 401. Fixed in the
file, not only in the log.

**T55 closed** — shipped by the Implementer at It142, and I ran it at 04:44 (17 tests green) rather than
believing the entry.

### Open

| # | Item | Owner |
|---|---|---|
| 1 | **`drop policy` ×3** — **only Enrique can.** SQL at **609**, heading ***"### What to run"*** | Enrique — **do** |
| 2 | **Top up Telnyx** — $3.03, no credit line, ~6 calls, hard stop at zero | Enrique — **do** |
| 3 | **T21** — **delegable**: an agent has the key and declined on judgement | Enrique — **do** |
| 4 | **T34** — SIP credential. **Accept; no action** | Enrique — decide |
| 5 | **Brief PDF** — absent from the public tree. **Leave it; no action** | Enrique — decide |
| 6 | **Your own address in this file.** Removing it breaks nothing. **No recommendation** | Enrique — decide |
| T56 | Correct the latency deliverable to the 338-turn population | any agent |

Tester silent since 20:26 (**8h34m**). Inbox and In progress empty. No lock held; I took none.
Guards re-run after my edits: `intervention-routing`, `doc-paths`, `doc-citations`, `list-counts` — **123 green**.

### The single most important remaining item

**The `drop policy` paste** — still the only item nobody else could do for him. T56 is the best remaining
*agent* task: it is a panel-facing number, it is currently pessimistic, and the fix is a query plus a paragraph.
