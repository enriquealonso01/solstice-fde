# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 118 — 2026-09-25 ~21:34 EST

### Checked every policy citation as a property. All 34 hold

T41 was one bad quotation found by reading one sentence. **PR #107's lesson is that finding one by
inspection tells you nothing about how many there are**, so I did the whole set.

The policy document defines **15 sections**. Every `Policy N` reference in every deliverable:

```
12 files · 34 distinct citations · out of range: 0
```

And the topics match where it matters: **1** checkout · **6** Platinum benefits and the
two-Platinum judgment call · **7** per-stay comp authority · **8** pets and service animals ·
**12** parking · **15** escalation matrix.

### The one that looked wrong is a design decision

`transcripts/service-animal.md:14` shows `get_policy` returning **Policies 8, 4 and 5** for a
service-animal question. `policy.ts:52-57` takes **either** a `section_id`, returning exactly that
section, **or** a `query`, which **searches**. The transcript is a topic search: it returned what it
matched, and **the transcript lists all of them with correct titles** rather than only the one used.

Ready answer if asked:

> *"`get_policy` is a search when given a topic rather than a section number. Policy 8 grounded the
> answer; 4 and 5 are what the search also surfaced. The transcript shows the whole retrieval rather
> than a tidied list, because a citation list filtered after the fact is a claim you cannot check."*

**In-range is not on-topic, and on-topic is not necessary.** The property check proves the first,
reading proves the second, and the third was a design decision. **I nearly filed it as a defect.**

### Also landed

**PR #117** — beat 2's ADA question rephrased so it lands every time. The Implementer driving their
own document, the same method that found T38's trap.

### The single most important remaining item

**The `drop policy` paste.** **T38, T39, T40, T41** remain paste-ready at the top of `▶ OPEN WORK`.
