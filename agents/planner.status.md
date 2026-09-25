# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 94 — 2026-09-25 ~19:44 EST

### Inbox empty. No lock held. Suite 473 passed, 37 files.

### T36 CLOSED, and live rather than merely merged

PR #90 put the rule where the voice leg reads it. Verified against the **live assistant**:

```
live warm_transfer_instructions : 457 chars
  requires create_escalation first                 : true
  forbids describing a handoff that did not happen : true
```

The escalation is raised **before** the hand over, so a record exists whether or not the transfer
connects — and if nobody picks up, Sol says plainly it could not reach a colleague instead of
narrating a handoff that did not occur.

### The near-miss, which is the real content of this iteration

My first read showed **89 iterations, newest 92**, T36 still on its original heading — and PR #88
had just documented a reverted tree in which my file was **−327 lines**. I concluded my
iteration-93 work was destroyed. **I drafted a restoration and tried to apply it.**

The `assert` in my own throwaway script failed, because the heading I was "restoring" was already
there. Re-reading: **90 iterations, 6,028 lines, iteration 93 present, file clean and committed in
PR #90.** Nothing was ever lost.

**Had that assertion not fired, I would have written sixty duplicated lines into the file I was
trying to protect.**

Third time this session a read has raced another agent's write. The first two cost nothing because
I only reported them. **This time I was about to act on the stale read.**

> **Before declaring that something was lost, read it again.** A missing-data conclusion is the case
> where the observation is most likely a timing artefact *and* where acting on it does the most
> damage. What saved this was defensive coding in a disposable script, not judgement.

### PR #88's incident, worth Enrique knowing

Three failures in one ship, none of them the change: **`git pull --ff-only` failed and the chain
continued**, so the deploy ran from a tree that was not `origin/main`; the working tree had been
**reverted** (`SUBMISSION.md` back to *"Two things"*, `list-counts.test.ts` deleted, my plan
−327 lines) and was *"one `git add -A` away from being committed as a deletion"*; and they restored
six files while **deliberately leaving `agents/planner.status.md` alone** as the one file with new
content that was not theirs — which is why my status survived.

### The Tester caught the second casualty: a guard that was not running

`list-counts.test.ts` was **in HEAD and absent from the working tree**, so the suite ran 36 files
and the guard — the one added to stop `SUBMISSION.md` miscounting — **never executed**. Restored;
37 files, confirmed by my own run.

> **"A test in the commit is not a test that runs."** The merged / deployed / working distinction,
> one level down, and the sharpest formulation of it in this project.

### The plan is accurate and correctly ordered

**Enrique:** the SQL paste · Telnyx top-up · T34 rotation · T21.
**Agents:** **T35** is the only item left — two lines pointing at `agents/tested.log.md`.

### The single most important remaining item

**The `drop policy` paste** — still the only open item with a live security consequence.
