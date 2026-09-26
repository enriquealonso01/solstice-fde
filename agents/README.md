# How the three agents share a repository without talking

They never message each other. Every piece of coordination is a file, and **each file has exactly
one writer.**

That covers the coordination files, and only those. **The source tree has no single writer, and all
three agents share one working directory and one git HEAD.** Single-writer ownership is not a
guarantee that two agents cannot corrupt each other's work — it is a guarantee about these seven
files. Everything below follows from that distinction.

| File | Sole writer | Everyone else |
|---|---|---|
| `plans/06-master-plan.md` | Planner | reads |
| `agents/completed.log.md` | Implementer | reads |
| `agents/tested.log.md` | Tester | reads |
| `agents/*.status.md` | the agent it is named for | reads |
| `HUMAN_INTERVENTION.md` | Implementer and Tester (append only) | Enrique clears |
| `BACKLOG.md` | Enrique (Inbox), Planner (triage) | reads |
| `agents/README.md` | Implementer | reads |

## The mutex does not cover the filesystem

`agents/.lock` protects `git`, `gh` and `netlify`. It does **not** protect editing. Three agents
share one checkout, so while you hold nothing at all you can still:

- edit a source file another agent is midway through changing,
- find yourself on **their** branch, because `git checkout` moves the HEAD you both use,
- have your uncommitted work sitting in the tree they are committing from.

That happened on 2026-09-25. The Tester's status file named the defect, the file and the lines they
were fixing. The Implementer read it, took the same defect, and edited the same files while blocked
on the lock; the Tester shipped their version as PR #41 with the Implementer's edits sitting in the
same tree. Nothing was lost, and that was luck rather than design.

**So: before editing, read the other agents' status files and pick something disjoint.** They say
what each agent is touching, which is what they are for. If the only useful work overlaps with
somebody's declared file, the honest move is to do something else and say why — there is another
iteration in five minutes. And when the lock frees, `git checkout main && git pull` **first**: you
may be standing on a branch someone else created and already merged.

## The one shared mutex

Git and deploy are not concurrency-safe. Before any `git` write, `gh pr`, or `netlify deploy`,
an agent must take the lock:

```bash
if mkdir agents/.lock 2>/dev/null; then
  (
    # Your own log and status file go in the SAME commit as the work,
    # and so do the Planner's, because nobody else can commit them.
    git add <the files your task touched>  agents/<you>.status.md  agents/<your log>.md \
            plans/06-master-plan.md  agents/planner.status.md  BACKLOG.md
    # ...commit, push, PR, merge, deploy...
  )
  rmdir agents/.lock      # release ONLY here: this branch is the one where you acquired it
else
  # Losing the race is normal. It is the mutex working, not an error.
  echo "lock held by another agent - not shipping this iteration"
fi
```

**Do not background anything inside the lock.** If the deploy takes minutes, wait for it. The
`rmdir` must run in the same iteration as the `mkdir`. A backgrounded command that outlives your
iteration leaves the lock held with nobody holding it, and the 20-minute stale rule is then the only
thing that will free it — which is exactly what happened at 15:59 on 2026-09-25: `mkdir` succeeded,
the deploy was backgrounded, the iteration ended, `rmdir` never ran, and the next three iterations
were blocked for the full twenty minutes.

**If you see a held lock, do not infer the holder from another agent's status file.** On 2026-09-25
an agent read a "TAKING NOW" line, concluded the lock must be that agent's, and twice declined to
act on a lock it was holding itself. The twenty-minute cost came less from the orphaned lock than
from **two iterations of confident reasoning about who held it.** Check your own previous iteration
first. The lock directory carries no owner, so it cannot tell you whose it is — and a status file
records what an agent *intended*, which is not evidence about what it *did*.

What the lock does support is waiting. `stat -c %Y agents/.lock` gives you its age; under twenty
minutes, someone is mid-ship and the answer is to wait and retry, not to reason about identity.
Waiting costs one iteration. Guessing wrong costs a lock.

**Do not put anything inside `agents/.lock`.** The obvious fix to the paragraph above is to write an
owner file into the lock directory so that "whose is it" stops being guesswork. It is a trap: every
agent releases with `rmdir`, and `rmdir` removes only *empty* directories. One owner file turns every
release into a silent failure and the mutex into a permanent block on all three agents. If the lock
ever needs an owner, it needs a different release verb first, agreed with the other two agents —
not a file added by whoever thought of it.

**Whoever ships carries the Planner's files too.** The Planner has no lock and no git by its own
brief, so `plans/06-master-plan.md`, `agents/planner.status.md` and `BACKLOG.md` are not covered
by the rule below — and the largest record in the repo was therefore the one still orphaned,
running about 66 uncommitted lines per iteration. Committing someone else's file is already
sanctioned here: ownership governs who **writes** a file, not who commits it, and preserving
text verbatim is not authorship.

`agents/planner.status.md` is **overwritten rather than appended**, so a stale committed copy is
not obviously stale — it is simply a different, older status with nothing marking it as old.
That is worse than a gap, because it reads as current.

**Stage your own log and status file every time you ship.** They are the first line of the `git
add`, not an afterthought, because a file that is never anyone's *task* otherwise becomes a file
that is never anyone's *commit*. That is not hypothetical: on 2026-09-25 the entire coordination
record — both logs, the plan, all three status files, `BACKLOG.md` and `HUMAN_INTERVENTION.md`,
about **7,000 lines** — was found living only in one working directory, weeks of reasoning a single
`git checkout .` from gone. `completed.log.md` was 6 lines committed against 2,241 in the tree. It
had been sitting in `git status` as ` M` in front of every agent, every iteration, and ` M` reads
like a normal working state rather than "has never been saved".

Committing someone else's file is fine when it needs rescuing: single-writer ownership governs who
**writes** a file, not who commits it, and preserving text verbatim is not authorship. But do not
rely on that — it only happens when somebody notices, and for thirty-nine iterations nobody did.

**Before you deploy, assert the tree — do not infer it from the pull not erroring.** The last two
steps of the sequence are `git checkout main && git pull`, and both can fail while the chain carries
on to `netlify deploy`:

```bash
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" || { echo "NOT ON origin/main - do not deploy"; exit 1; }
test -z "$(git status --porcelain)" || echo "tree is dirty - check whose work that is before deploying"
```

Both halves have now fired for real, one iteration apart. On 2026-09-25 a `git pull --ff-only` hit
*"Not possible to fast-forward"* on a diverged local main and **the deploy ran from a tree that was
not `origin/main`**. The next iteration `git checkout main` was refused outright — *"Your local
changes to `plans/06-master-plan.md` would be overwritten"*, because another agent was editing the
plan at that moment — and the deploy ran **from the feature branch**. Neither was caught by the
sequence; both were caught by reading the output afterwards.

**The dirty check is a prompt, not a failure.** Three agents share this directory, so a dirty tree is
normal — `plans/06-master-plan.md` being modified usually means the Planner is writing. What is not
normal is deploying without knowing. If the diff is someone else's work in progress, `git stash push
-- <their files>`, do the checkout, then `git stash pop`: it preserves their edits and gets you onto
`main`. Do **not** `git checkout -- <their file>` to clear the blockage; that is how 327 lines of the
plan were nearly lost.

**Release only what you acquired.** The release must live inside the success branch. If it sits
after the whole sequence — `mkdir ... ; rmdir ...`, or bolted onto the end of an `&&` chain — then
when your `mkdir` *loses* the race the `rmdir` still runs and deletes **the winner's** lock, while
they are mid-ship. That is not hypothetical: it happened at 14:28 on 2026-09-25, when this file
still said "always release, even on failure". The Implementer removed the Tester's lock, noticed,
recreated it within seconds, shipped nothing, and disclosed it. No work was lost, and the wording
here was the cause.

`mkdir` is atomic, so two agents cannot both believe they hold it. If the lock is held, do not
wait or force it: write what you were going to do into your own status file and end the iteration.
There is another one in five minutes. **Expect to lose this race** — two of the three agents hit it
within three iterations of each other.

**If your own `rmdir` fails**, do not retry and do not delete anything. It means the directory you
created is no longer the one that is there — most likely someone removed yours and recreated it, so
the lock you would be deleting now belongs to them. Note it in your status file and stop.

If `agents/.lock` is older than 20 minutes it is stale from a crashed iteration. Note that in your
status file, remove it, and continue. **Twenty minutes is the threshold; do not shorten it because
a lock looks abandoned to you.** A holder that has merged but not yet deployed still needs it.

## When another agent writes to their own files during your ship

They do not take the lock to edit `plans/06-master-plan.md` or `agents/planner.status.md`, and they
should not have to. So those files can change under you between your `git add` and your
`git checkout main`, and then `checkout` or `pull` refuses:

```
error: Your local changes to the following files would be overwritten by checkout:
        plans/06-master-plan.md
```

This is not a failure of the lock and it is not corruption. It happened during iteration 100, after
the merge and before the deploy, with the lock held the whole time.

**Do this, in this order.**

1. **Copy both files somewhere outside the repo first** — your scratchpad. Do that before any git
   command. Everything after this is recoverable only because that copy exists.
2. `git stash push <their files>`, then `git checkout main` and `git pull`.
3. `git stash pop`. If it conflicts, **stop and compare** rather than picking a side by reflex. In
   iteration 100 neither side was a superset: `origin/main` held their iteration-135 log entry and
   the working copy held a 136 entry that had replaced it, so "take the newer one" would have
   deleted a committed entry.
4. **Resolve to `origin/main`.** It is the shared, committed truth, and their file is not yours to
   merge by judgement. Write it back with `git show origin/main:<file> > <file>` and `git add` it —
   a plain file write, not `git checkout --`, so nothing is destroyed if you have misread the state.
5. **Leave the stash in place** and say in your log which entry it is and where the scratchpad copy
   is. Do not `git stash drop`. The owner may need to re-add work that never reached origin, and
   they cannot do that from a stash you deleted.
6. Say in your completed log exactly what of theirs is not on `origin/main`. They will usually
   rewrite it in seconds — but only if they know.

**One thing the iteration-100 version of this note missed.** If *your own* work is also uncommitted when
the checkout refuses — a status line you fixed after staging, say — stash that separately and pop it once
you are on `main`. Same three commands, one level down. Do not fold it into their stash: you will not be
able to tell whose change is whose when you come back to it.

**Untracking a file the agents still read: check it is on disk afterwards.** `git rm --cached` leaves the
working copy, but the branch commits the deletion — so the `checkout main` at the end of the ship removes
it, and the file the Planner reads as ground truth is gone. It happened at iteration 117 with
`FDE_Project_Challenge.pdf`. Recovery is one command against the commit that still has it:

```bash
git show <commit-before-the-removal>:<path> > <path>
```

So the last step of untracking something is `test -f <path>`, not the merge.

**Never resolve another agent's file by merging the two versions yourself.** You cannot tell an
edit they abandoned from one they are mid-way through, and a plausible merge of a 9,000-line plan is
the worst of the three outcomes: it looks finished.
