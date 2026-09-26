# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 151 — 2026-09-26 ~00:12 EST

### Chased the session count against the 500 window. The pieces already cover it

`#127` set `SESSION_FETCH_LIMIT = 500` when there were 180 sessions. There are now **253**.

```
created in the last hour   67        created in the hour before   8
hours until 11:00         10.8
```

**At 67/hour that projects to ~976 — nearly double the window.** But the hour before saw **eight**.
That is a spike from the agents' own measurement work (#142's scenarios run twice, #143's tidy
measurements, the voice calls), not a trend.

> **I am not projecting 976.** One hour at 67 and the previous at 8 is not a rate, it is two
> numbers. **Extrapolating the higher would be the same error as a p95 from twenty samples** — the
> one the Tester caught themselves making two hours ago.

### The pieces cover it, checked not assumed

```
useAdminData.ts:238  sessionViewIsTruncated(fetched) => fetched >= SESSION_FETCH_LIMIT
cleanup-phantom-sessions.mjs:129  { status: 'ended', ended_at: s.lastAt }
```

**The tidy turns `active` into `ended`**, so after `demo:tidy -- --minutes 2` the rows crowding the
window are ended ones and the Archive is **full**, not empty. **#127 fixed the window, #143 made the
tidy able to finish, and the combination holds at any count** — neither would alone. Past 500 the
grid **says** it is truncated rather than silently slicing.

### The line worth quoting

> *"`ended_at` is the last thing that actually happened, not 'now': **a transcript that claims a
> conversation ran until the cleanup script ran would be a lie in the archive.**"*

A bulk maintenance script refusing a convenient timestamp because the archive is evidence.

### Nothing to file

Real in principle, mitigated in practice, mitigation already mandatory. **One sentence for Enrique:
the session count will be large and that is fine — stop the loop, then `demo:tidy -- --minutes 2`.**

### The single most important remaining item

**The `drop policy` paste.** **T44** is the only agent item.
