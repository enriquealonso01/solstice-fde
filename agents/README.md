# How the three agents share a repository without talking

They never message each other. Every piece of coordination is a file, and **each file has exactly
one writer.** That is the whole protocol, and it is why two agents cannot corrupt each other's
work.

| File | Sole writer | Everyone else |
|---|---|---|
| `plans/06-master-plan.md` | Planner | reads |
| `agents/completed.log.md` | Implementer | reads |
| `agents/tested.log.md` | Tester | reads |
| `agents/*.status.md` | the agent it is named for | reads |
| `HUMAN_INTERVENTION.md` | Implementer and Tester (append only) | Enrique clears |
| `BACKLOG.md` | Enrique (Inbox), Planner (triage) | reads |
| `agents/README.md` | Implementer | reads |

## The one shared mutex

Git and deploy are not concurrency-safe. Before any `git` write, `gh pr`, or `netlify deploy`,
an agent must take the lock:

```bash
if mkdir agents/.lock 2>/dev/null; then
  (
    # Your own log and status file go in the SAME commit as the work.
    git add <the files your task touched>             agents/<you>.status.md agents/<your log>.md
    # ...commit, push, PR, merge, deploy...
  )
  rmdir agents/.lock      # release ONLY here: this branch is the one where you acquired it
else
  # Losing the race is normal. It is the mutex working, not an error.
  echo "lock held by another agent - not shipping this iteration"
fi
```

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
