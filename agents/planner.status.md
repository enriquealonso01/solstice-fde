# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 81 — 2026-09-25 ~18:48 EST

### Inbox empty. No lock held. Deploy current with HEAD. PR #74 live.

### I was wrong about `chat.ts:146`, twice, and it was telling guests something false

In iterations 75 and 77 I recommended leaving the chat channel note as assumption 16: *"one hop,
not a fabrication"*, *"a guest cannot tell the two sentences apart"*, and — the part I should have
distrusted — *"and not merely because it is the cautious option."*

PR #74 measured it against production. **Four runs out of four:**

> *"I've logged this and it's going to our Sales team today. They'll reach out to dana.reyes@… with
> a quote."*

**A named destination and a promised day, both false**, while the tool result in the model's own
context read `Escalation … to agm`. The model was not drifting — it was obeying the note.

Both my reasons were wrong on the facts. It *was* a fabrication. And *"a manager has it"* versus
*"our Sales team will reach out today with a quote"* are not the same sentence: the second is a
commitment a guest waits on and finds broken, which is the exact failure the `honest-handoff`
transcript exists to say this system does not commit.

### The mechanism I missed, having already read it

```ts
cachedPrompt = `${readPromptFromMarkdown() ?? SOL_SYSTEM_PROMPT}\n${CHAT_CHANNEL_NOTE}`
```

The note is appended **last**, so it is the most salient instruction and **outranked the `sol.md`
correction above it**. I quoted this exact line in iteration 75 while establishing which prompt the
chat runtime serves, and drew nothing from the order. I treated the two texts as peers whose
claims a reader would weigh. They are not peers — position decides.

### The shape of the error

All three of my reasons were **assertions about what the model would say to a guest**, and I never
ran it. One production conversation would have settled it; the harness existed all day.

Fourth time wrong with this instinct — and this time I told myself it was not mere caution before
giving three untested reasons. **That is the tell: I dressed an untested assumption in the
vocabulary of a risk assessment.** A risk assessment prices a measured outcome. I declined to
measure and argued from the guess. *"Verify claims against reality"* applies to my own
recommendations, not only to other agents' status files.

### The fix is well-built, and an hour-old guard paid for itself

The note keeps the true part — a group block is priced by Sales — and forbids naming who will make
contact or promising when. Three `file:line` citations moved in the edit and
**`doc-citations.test.ts`, from PR #70 about twenty minutes earlier, caught them**, with substrings
unchanged so the guard was not weakened to let the change through.

### T31 closed. T32 re-ranked and stays lowest

`README.md:89` now reads *"over 400 tests across 32 test files."*

T32 is **not** the same mistake: that sentence is read by a reviewer, not spoken to a guest. I
checked the analogous risk, since `sol.md:81-99` *is* the voice prompt — the phone agent already
says *"a manager has it and will follow up"*, and iteration 76 confirmed `"reaches Sales"` is
absent from the live voice instructions. **Guest-facing path is clean on both channels.**

### The plan is accurate and correctly ordered

**Enrique, in order:** the SQL paste · Telnyx top-up · **T21** two rows.
**Agents:** re-export the Telnyx JSON · **T32** lowest priority.

### The single most important remaining item

**The `drop policy` paste.** It closes a live hole *and* restores `agent/sol.md` §13 exactly as
written. It is now the only open item with a live security consequence.
