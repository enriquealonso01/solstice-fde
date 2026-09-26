# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 211 — 2026-09-26 06:00 EST

**Open, in order: T60, the two one-line items inside T58, then T59.**

### T58's instruction is fixed, and I red-checked its guard without touching the repo

`docs/live-modification.md` at 05:56 now says *"change the `max_discount_auto_approve_pct` **line inside that
same object**, which is the only one of its name there"* — the field, not a distance — plus a paragraph on why
*"a distance is the wrong shape even when it is right."* It148 has not logged yet, so I verified rather than
waited.

`walkthrough-quotes.test.ts:218` fails on any `\w+ lines? (below|down|under|after)` in that document, with a
filter that lets the paragraph **describe** the old mistake without **issuing** it. **64 green.**

A guard nobody has seen fail is what this project keeps punishing, and I cannot mutate the repo — so I
reproduced its regex and filter in memory over a copy with the instruction restored:

```
live doc     matches ['two lines below']   survivors []                      -> passes, correctly
mutated doc  instruction restored          survivors ['two lines below', ...] -> fails, correctly
```

**Not vacuous.** It fires on exactly the regression it was written for.

### The red-check found a latent hole in that same guard

Its filter does `flatDoc.indexOf(phrase)` and reads the context around **that** index, not around the match. When
a phrase occurs twice, **both matches are judged by the first occurrence's context.** Today the instruction is at
line 26 and the retrospective at 31, so nothing slips through. **Reverse the order and the exemption swallows a
live instruction.** One character: use `m.index`.

> **Third appearance tonight of the same shape** — T55's boundary matched the heading inside the task describing
> it, T57's anchor matched the header comment, now the guard written to fix T57 matches at the wrong occurrence.
> **`indexOf` answers "where is this string", never "where is this instance".**

Plus the item I filed at iteration 208 and is still outstanding: `:175` asserts the slice `not.toContain('SOL-TPA')`
on the grounds that it would otherwise *"have run past the end of the object"* — **Tampa is line 89, before
Phoenix at 102.** An over-long slice runs forward into `SOL-CLT`. Assert **exactly one `property_code:`** and both
directions are covered. T58 now lists both rather than reading as closed.

### Unchanged

`src/lib/rules/engine.ts` was last modified **15:08 yesterday** — **T60 is untouched**, and
`show-verdict.ts INQ-2002` still prints *"needs the general manager, the general manager at Solstice Tampa
Bayshore, to approve it."* **T59** is untouched: the brief's net-new tool still has no behavioural test.

### Open

| # | Item | Owner |
|---|---|---|
| **T60** | *"the general manager, the general manager at…"* on the group screen; the guard covers the sibling verdict only | any agent — **first** |
| **T58** | Two one-line items in the guard: the message names the wrong neighbour; `indexOf` judges by the first occurrence | any agent |
| **T59** | The net-new tool has no behavioural test; `sold_out` is the stage control for the Platinum refusal | any agent |
| 1 | **`drop policy` ×3** — **only Enrique can.** SQL at **609**, ***"### What to run"***. **Breaks nothing; verified three ways** | Enrique — **do** |
| 2 | **Top up Telnyx** — $3.03, no credit line, ~6 calls, hard stop at zero | Enrique — **do** |
| 3 | **T21** — **delegable**: an agent has the key and declined on judgement | Enrique — **do** |
| 4 | **T34** — SIP credential. **Accept; no action** | Enrique — decide |
| 5 | **Brief PDF** — absent from the public tree. **Leave it; no action** | Enrique — decide |
| 6 | **Your own address in this file.** Removing it breaks nothing. **No recommendation** | Enrique — decide |

Tester silent since 20:26 (**9h34m**); its ledger has no open findings. Inbox and In progress empty. No lock held;
I took none. Guards re-run after my edits — `intervention-routing`, `doc-paths`, `list-counts`: **104 green**.

### The single most important remaining item

**The `drop policy` paste** — back to being the only item nobody else can do for him, now that the instruction he
reads on stage is correct. **T60 is the best remaining agent task**: it is text a panel member reads on screen in
the group beat, and it is one line.
