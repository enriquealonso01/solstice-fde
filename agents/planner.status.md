# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 228 — 2026-09-26 07:21 EST

**The plan is accurate and correctly ordered. Nothing is open for an agent. No new tasks.**

I swept `docs/demo-runbook.md` — the document he reads *during* the demo, 307 lines, last touched **07:18**
(It155 is mid-flight; this is the current text). I had checked fragments before and never its numbers.

### The three prices he says out loud, to the cent

Runbook §4 scripts: *"approve at **15% for $7,994.25** today, escalate for a sign-off at **17%, $7,806.15**, or
counter at **16%, $7,900.20**"* — noted as *"verified against `priceBlock` at iteration 108"*, a hundred
iterations ago.

I did not reconstruct the pricing inputs — that is the shape that produced the `audit_log.target` and
`check_comp_authority` mistakes earlier tonight. **I took one figure from a live run and closed the arithmetic
around it.**

```
show-verdict.ts INQ-2009  ->  "at the discount the customer asked for (17%): $7806.15"

implied gross = 7806.15 / 0.83 = 9405.00 exactly
  15% off -> 7994.25   runbook 7994.25   MATCH
  16% off -> 7900.20   runbook 7900.20   MATCH
  17% off -> 7806.15   runbook 7806.15   MATCH (the anchor)
9405.00 / (15 rooms x 3 nights) = 209.00 per room-night, exactly
counterPct(15, 17) = 16, matching the script's counter point
```

**All three correct, and the implied nightly rate lands on a round $209.00** — a wrong figure anywhere would
have left the arithmetic ragged instead of closing.

> **Method worth keeping: when a set of numbers shares a derivation, check the derivation, not each number.**
> One measured anchor plus arithmetic verified three figures with nothing assembled from memory.

### Also confirmed in the same pass

- **`/admin/inquiries/INQ-2009` really does not work**, as the runbook warns — the table carries both `id`
  (uuid) and `inquiry_code`, and INQ-2009's row id is `c9661623-…`. *"Click it from the inbox list"* is the
  right instruction, and it is the kind of thing that eats thirty seconds if discovered live.
- The support number in §3, **+1 (305) 786-6217**, matches the landing page HTML and the live Telnyx assistant.

### Open

| # | Item | Owner |
|---|---|---|
| 1 | **`drop policy` ×3** — **only Enrique can.** SQL at **609**, ***"### What to run"***. **Breaks nothing; verified three ways** | Enrique — **do** |
| 2 | **Top up Telnyx** — under **$3.01** at 06:45, no credit line, fewer than six calls, hard stop at zero | Enrique — **do** |
| 3 | **T21** — **delegable**: an agent has the key and declined on judgement | Enrique — **do** |
| 4 | **T34** — SIP credential. **Accept; no action** | Enrique — decide |
| 5 | **Brief PDF** — absent from the public tree. **Leave it; no action** | Enrique — decide |
| 6 | **Your own address in this file.** Removing it breaks nothing. **No recommendation** | Enrique — decide |

Nothing for an agent. Tester silent since 20:26 (**10h55m**); no open findings. Inbox and In progress empty. No
lock held; I took none. Plan guards re-run: **104 green**.

### The single most important remaining item

**The `drop policy` paste.** The runbook's spoken figures are now verified against a live run, not a
hundred-iteration-old check. **The SQL is the one action left that nobody else can take.**
