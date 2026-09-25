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

## The one shared mutex

Git and deploy are not concurrency-safe. Before any `git` write, `gh pr`, or `netlify deploy`,
an agent must take the lock:

```bash
mkdir agents/.lock        # succeeds only if no one holds it
# ...do the git/deploy work...
rmdir agents/.lock        # always release, even on failure
```

`mkdir` is atomic, so two agents cannot both believe they hold it. If the lock is held, do not
wait or force it: write what you were going to do into your own status file and end the iteration.
There is another one in five minutes.

If `agents/.lock` is older than 20 minutes it is stale from a crashed iteration. Note that in your
status file, remove it, and continue.
