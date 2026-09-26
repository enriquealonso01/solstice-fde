# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 221 — 2026-09-26 06:48 EST

**The plan is accurate and correctly ordered. Nothing is open for an agent.** So I re-measured the live numbers
in Enrique's own table, starting with the oldest — and found one of my own claims false.

### The correction: the balance is not flat, and I had told him it was

Row 2 carried **$3.03 from 02:46** and explained: *"It has been flat at $3.03 for hours because nobody has
called — it only falls when someone does."*

```
live at 06:45   balance 3.01   credit_limit 0.00   available_credit 3.01
last voice activity in the audit log:  2026-09-25T15:29Z
```

**Both halves are wrong.** It fell two cents in four hours with no voice call for nineteen — the number's
rental, about half a cent an hour. **I asserted a behaviour from two readings that happened to match, and the
third contradicted it.**

It changes nothing about the action — top up to $20, another two cents before 11:00 is irrelevant. It changes
how to read the figure: **a ceiling that drifts down, not a balance that waits for you.** The row now says
*"under $3.01"* and *"fewer than six calls."* Same lesson as the latency p90: a number quoted without its
behaviour invites the wrong inference.

### The cost widget, checked from outside

`/api/cost` is **401 anonymously** — correct, staff-only, the same refusal every protected endpoint gives, and I
did not try to get around it. What I could check is the failure shape from both sides: `cost.ts:55` returns
`null` when the provider does not answer and `CostPage.tsx:156` renders `'—'`. **A dead provider shows an em
dash, not a broken widget in front of the panel.** The upstream API answers with our key right now.

### Smoke test of the deployed interface

```
/            HTTP 200   1053B   0.35s
/admin       HTTP 200   1053B   0.15s     <- SPA rewrite, router handles it client-side
/api/chat    HTTP 405   40B               <- POST-only, and it says so rather than 500ing
```

The landing HTML carries the support number, the mount point and the hashed bundle. **405 is the detail worth
noticing**: a reviewer poking the API with a GET gets the correct method error, not a stack trace.

### Open

| # | Item | Owner |
|---|---|---|
| 1 | **`drop policy` ×3** — **only Enrique can.** SQL at **609**, ***"### What to run"***. **Breaks nothing; verified three ways** | Enrique — **do** |
| 2 | **Top up Telnyx** — **under $3.01 at 06:45**, no credit line, fewer than six calls, hard stop at zero | Enrique — **do** |
| 3 | **T21** — **delegable**: an agent has the key and declined on judgement | Enrique — **do** |
| 4 | **T34** — SIP credential. **Accept; no action** | Enrique — decide |
| 5 | **Brief PDF** — absent from the public tree. **Leave it; no action** | Enrique — decide |
| 6 | **Your own address in this file.** Removing it breaks nothing. **No recommendation** | Enrique — decide |

Nothing for an agent. Suite green at **898**. Tester silent since 20:26 (**10h22m**); no open findings. Inbox and
In progress empty. No lock held; I took none. Plan guards re-run: **104 green**.

### The single most important remaining item

**The `drop policy` paste.** Everything measurable around it has now been measured; the SQL is the one action
left that nobody else can take.
