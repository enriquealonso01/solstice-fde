# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 219 — 2026-09-26 06:39 EST

**The plan is accurate and correctly ordered.** **T59 is the only open agent task. Nothing new filed.**

### What I checked

It150 swept the `indexOf`-judges-by-the-first-occurrence defect across eight guards and fixed two more, one of
them **`doc-paths.test.ts`**, which I run over my own file every iteration. Verified in place: its gitignore
exemption now walks **every** mention, with the measurement recorded — *"SUBMISSION.md names `DEMO_LOGINS.md`
three times and only the first two say it is gitignored."* 28 green; unchanged in what it does for me.

Its dropped hypothesis was worth generalising: could the suite be **red for anyone who cloned the repository**?
`README.md` invites a reviewer to run it, and the brief says they dig into the code.

**It cannot, and I checked rather than assumed:**

- `.gitignore` hides exactly two files the tests name — `DEMO_LOGINS.md` and `FDE_Project_Challenge.pdf` — and
  both are asserted **absent from tracking** and **present in `.gitignore`**, never asserted to exist on disk.
- `vitest.setup.ts` strips credentials from the environment, so nothing depends on a local `.env`.
- `data/generated/*.json`, which several tests read, is tracked rather than ignored.

**And the harder version was already solved at iteration 137**, before I thought to ask: `shipped-files.test.ts`
exists because the invitation broke for **Download ZIP** rather than `git clone` — three files that
*"did not fail an assertion; they failed to collect"*, reporting a git error in place of twelve credential
assertions. `shippedFiles` prefers git and falls back to walking the tree with `.gitignore` applied, with a
subset case proving the fallback faithful. **6 green.** With iteration 112's fresh LF clone run, both directions
are covered by guards that run on every pass.

> **The lesson is about sequence, not content.** I had a real submission-risk hypothesis and the right move was
> to look for the existing answer before writing the task. Three times in a few iterations the gap I found
> already had a name elsewhere in the package — *Escalation queue* when I grepped for *notif*,
> `integration-recommendation.md` for the jobs bonus, now this. **Search the package for the answer before
> filing the question.**

### Open

| # | Item | Owner |
|---|---|---|
| **T59** | The net-new tool has no behavioural test — and it produces the opening beat's refusal | any agent |
| 1 | **`drop policy` ×3** — **only Enrique can.** SQL at **609**, ***"### What to run"***. **Breaks nothing; verified three ways** | Enrique — **do** |
| 2 | **Top up Telnyx** — $3.03, no credit line, ~6 calls, hard stop at zero | Enrique — **do** |
| 3 | **T21** — **delegable**: an agent has the key and declined on judgement | Enrique — **do** |
| 4 | **T34** — SIP credential. **Accept; no action** | Enrique — decide |
| 5 | **Brief PDF** — absent from the public tree. **Leave it; no action** | Enrique — decide |
| 6 | **Your own address in this file.** Removing it breaks nothing. **No recommendation** | Enrique — decide |

Suite green at **872 / 61 files**. Tester silent since 20:26 (**10h13m**); no open findings. Inbox and In
progress empty. No lock held; I took none. Plan guards re-run after my edits: **104 green**.

### The single most important remaining item

**The `drop policy` paste.** Unchanged, and everything around it is now verified: the demo path end to end, the
group gate across every proposal, the brief's deliverable list against the PDF text, and the suite from a clone
or a ZIP.
