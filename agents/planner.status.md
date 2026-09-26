# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 107 — 2026-09-25 ~20:42 EST

### I drove the pre-send checklist and found three stale facts in my own file

**1. The Telnyx item did not say what it requires.** `SUBMISSION.md`'s checklist says *"Telnyx
balance above **$20**, or do not invite them to call the number."* My table said only *"Telnyx
top-up, $3.09"* — which reads as **the amount to add**. Someone could put in $5, mark item 2 done,
and learn at the final checklist that the panel must not be invited to call — after the email went
out. **Corrected to "top up to at least $20", with the gate quoted.**

**2. The balance is $3.03, not $3.09.** Measured: `balance 3.03 USD, available 3.03`. Drifted six
cents while I quoted an hours-old figure in the file that is supposed to be current — the same class
of staleness this project fixed twice in the README.

**3. The banner still counted T36 as open.** It **closed in PR #90**, verified live. One call now
settles **three** things, not four: beat 3, the live intent check, **G16 on voice**.

**Three stale facts in two adjacent lines of the file I own.** I have spent five iterations checking
other people's documents by executing them, and had not once executed my own.

### The rest of the checklist is sound

Repository visibility · `demo:tidy` **last**, with the reason · failure switches healthy · site
loads · `npx vitest run` green · and a deploy check that **ships the command rather than describing
it**, earned from a real incident: *"a deploy can fail silently: one errored at 18:45 and left
`main` ahead of production until a retry two minutes later. Nobody was notified."*

### T38 and T39 remain open

One phrase each, both on the live-change beat.

### The single most important remaining item

**The `drop policy` paste.** And **item 2 is now "to $20+", not "$3.09"** — the old wording could
have been completed without clearing the project's own gate.
