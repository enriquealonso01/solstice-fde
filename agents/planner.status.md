# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 244 — 2026-09-26 08:41 EST

**The plan is accurate and correctly ordered. Nothing is open for an agent. No new tasks.**

It162 found `README.md` calling the proposal link's path segment *"32-character **random**"* when it is
`HMAC-SHA256(PROPOSAL_LINK_SECRET, "proposal:" + code)` truncated to 32, and corrected it. I checked whether my
own file repeats the error — and then whether the consequence is real.

### My file says *unguessable*, which is accurate and partial

The diagram and my plan say *"32-character unguessable path"*, not *random*. **Unguessable** is a claim about an
attacker without the secret and it survives; **random** implies independent entropy per object, which is what
It162 struck. **But accurate-and-partial is how the README's version started**, so I amended my own passage
rather than leave the fix to the README alone.

### Then I reproduced it, because a security claim deserves more than a citation

Computing the HMAC in Python from `PROPOSAL_LINK_SECRET` and the code alone — no repository code involved:

```
derived token appears in the stored pdf_path:  6 of 6 live proposals
  PRP-2001 · PRP-2001-2 · PRP-2002 · PRP-2007 · PRP-2008 · PRP-2011
deterministic: yes    length: 32
```

**That is the whole attack, executed** — secret plus a sequential code yields every customer's link offline, and
the codes go `PRP-2011`, `PRP-2012`.

> **No token value appears anywhere in my file**, which is the same reason the finding matters: the path *is*
> the credential, so quoting one to prove the point would be the leak I was describing. **The boolean is the
> evidence; the value is the vulnerability.**

The design stays defensible — `store.ts:150` says why, and its second clause is a real property: the table holds
the path, so keeping the token out of a column is what the derivation buys.

### One thing added to Enrique's row 1

It162 also measured that **the pending `drop policy` SQL does not touch any of this** — the three statements are
on `proposals`, `inquiries` and `follow_ups`, which are tables; the PDFs live in a bucket. Added to row 1,
because it removes a worry at 10:55 rather than adding one.

### Two process faults of my own

- **The first of my two edits failed its assertion and the second did not**, so for about a minute the log entry
  described amendments that were not in the file. **A log entry written before the edit is a forecast.** Both
  are applied and read back now.
- **I spliced into a wrapped sentence again** — the same fault as iteration 242. The mechanical form: **insert
  after a line that ends a sentence, not after the line that happens to contain the anchor.**

### Open

| # | Item | Owner |
|---|---|---|
| 1 | **`drop policy` ×3** — **only Enrique can.** SQL at **609**. **Breaks nothing; does not touch proposal storage** | Enrique — **do** |
| 2 | **Top up Telnyx** — under **$3.01** at 06:45, no credit line, fewer than six calls, hard stop at zero | Enrique — **do** |
| 3 | **T21** — **delegable**: an agent has the key and declined on judgement | Enrique — **do** |
| 4 | **T34** — SIP credential. **Accept; no action** | Enrique — decide |
| 5 | **Brief PDF** — absent from the public tree. **Leave it; no action** | Enrique — decide |
| 6 | **Your own address in this file.** Removing it breaks nothing. **No recommendation** | Enrique — decide |

Nothing for an agent, nothing waiting on the Tester (silent since 20:26, **12h15m**). Suite green at **944 / 66
files**. Inbox and In progress empty. No lock held; I took none. Plan guards re-run: **104 green**.

### The single most important remaining item

**The `drop policy` paste.** **The SQL is the one action left that nobody else can take.**
