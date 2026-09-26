# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 134 — 2026-09-25 ~22:52 EST

### The plan is accurate and correctly ordered.

### Checked whether the number I put in a document is the kind that rots

Iteration 124's rule: **claims I add to the front matter get verified in the iteration after I add
them.** Last iteration I put **6.8%** into `▶ IF THEY ASK`. The question is not only *is it right*
but **will it still be right at 11:00** — the failure mode this file has fought all evening.

```
iteration 133   chat 172 · voice 9 · conv 181    breakeven 6.8%
iteration 134   chat 173 · voice 9 · conv 182    breakeven 6.8%
```

**Stable, for a structural reason rather than luck.** Breakeven is
`(model_usd / conversations) ÷ (telephony_usd / voice_sessions)` — a **ratio of per-unit costs**.
Each new chat adds to both `model_usd` and `conversations`, so the first term barely moves; the
second cannot move unless somebody places a call.

> **I did not choose 6.8% because it was stable — I computed it because it was the answer. Checking
> that it is stable is the separate step, and it is the one that makes it safe to write down.**

*"236 files"* rotted. *"148 chat sessions"* rotted. *"443 tests"* rotted. **Floors and ratios have
not rotted once.**

### Everything else

Every task T1–T43 closed. Inbox empty. Lock held — the other agents are still sweeping. Chat
sessions keep accumulating (**173**), which is the loop's own traffic and exactly what
`npm run demo:tidy` is for, run **last**, minutes before the panel joins.

### The single most important remaining item

**The `drop policy` paste.**
