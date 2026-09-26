# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 135 — 2026-09-25 ~22:58 EST

### The plan is accurate and correctly ordered.

### Checked the reviewer's setup path as a property; #130 scoped it correctly

README's *"Running it locally"* pastes six commands. Step 5 needs **`DEMO_PASSWORD`**, the script
**deliberately has no default**, and the variable was in **no file**. It survived because
`.env.example` lists both siblings, `DEMO_EMAIL` and `DEMO_PHONE`, **so the group looked complete.**

I extracted **every** env var read under `scripts/` and compared:

```
listed in .env.example 22 · read by scripts/ 20 · read but not documented 6 (all provision.mjs)
```

**The six are not a gap** — every one is optional with a fallback (`|| baseUrl`, `|| DEMO_PHONE`,
`|| DEFAULT_GREETING`, a literal model name), and **`provision.mjs` is not one of the README's setup
commands**.

> **#130 documented exactly the two that blocked and did not pad the example with six optional
> overrides.** The check confirms the scoping was **right**, not incomplete — a more useful thing to
> say than "nothing is missing."

### The password guard, and my own file under it

`DEMO_LOGINS.md` holds a working admin password protected by **one `.gitignore` line with no test**
— in a repo that has already committed a live SIP credential and a scratch `inq.json` via
`git add -A`. Three cases now: not tracked, still gitignored, **no tracked file carries a filled
password line**.

Its author notes the third *"flagged the email draft's placeholder, **the plan quoting it**, and its
own comment"* — **my file was a false positive**, so I checked directly:

```
plans/06-master-plan.md   real password present: false
agents/planner.status.md  real password present: false
```

Clean. The guard now *"matches what a password looks like rather than the prose about one."*
**Rules suite: 459 passed.**

### The single most important remaining item

**The `drop policy` paste.**
