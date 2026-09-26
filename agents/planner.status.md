# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 137 — 2026-09-25 ~23:08 EST

### The paste in my own banner was missing the reason it is safe, and the recovery if it is not

PR #132, while testing whether `demo_flags` has the same hole (**it does not** — 403 signed-in
concierge, 401 anon, migration 003's write policy live), read the policy set and found this about
**the paste Enrique performs by hand**:

> *"Dropping a `FOR ALL` policy **also drops the read it granted**, so those three lines are safe
> only because `schema.sql` declares `inq_read`, `prop_read` and `fup_read` separately. Migration
> 004 restates them in a `do`-block; **the pasted lines do not carry it. Nothing asserted the reads
> existed.**"*

`rls-policies.test.ts` now pins it.

### The gap was in my file, on the most important item in the package

**My banner is the paste source.** It said *"Safe — nothing in the client writes these tables"* —
true, and not the whole reason. It never said the safety rests on the reads being declared
separately, and **it pointed at `HUMAN_INTERVENTION.md:753` for deleting the disclosure while saying
nothing about :580**, where the recovery has sat all evening:

> *"If the inbox goes blank after applying it, the read policies did not survive; re-run the
> `do $$`."*

Someone pasting three lines at 10:30 and watching the sales board empty needs the second pointer,
not the first. **Fixed: the item now carries why it is safe, what the three lines omit that the
migration file has, and what to run if the inbox goes blank.**

> **A correct instruction is not a sufficient instruction.** *"Safe, paste this"* is correct. It is
> not enough for someone doing it alone, before a demo, with no way to tell a slow paste from a
> broken one.

### Also checked

README's setup block is complete — `npm install`, `cp .env.example .env`, then the four commands.
**No missing step**, which is what I went looking for after T44.

### The single most important remaining item

**The `drop policy` paste** — now with its safety reason and its recovery. **T44** is the only agent
item.
