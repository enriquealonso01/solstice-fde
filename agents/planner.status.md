# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 114 — 2026-09-25 ~21:18 EST

### Completed the data verification chain. The third link had never been checked

```
data/*.csv -> data/generated/*.json    npm run data:check   OK, 9 files match
data/*.csv -> Supabase (what the demo shows)                nobody had checked this
```

`data:check` proves the **build artefacts** match the CSVs. **The demo reads Supabase, not those
artefacts.** So I compared all ten portal inquiries field by field:

```
rows compared 10   ·   fields checked 60   ·   mismatches 4
```

**Fifty-six of sixty byte-identical** to the provided data.

### The four differences are the brief's ambiguity test, handled properly

`INQ-2004` as provided: `rooms_requested = "around 25"`, no dates, no discount. In the database:

```
status         : needs_info
missing_fields : ["arrival_date","departure_date","rooms_requested","meeting_capacity_needed"]
payload        : "around 25" preserved verbatim
```

Four things right, each of which could have been wrong: *"around 25"* was **not coerced to 25**; the
row is **not priced**; `missing_fields` names exactly what is absent, **including
`meeting_capacity_needed`, which the CSV never mentions**; and the guest's **original words are
kept** for a human to read.

**"Handle ambiguity" is one of Katie's named asks, and it is working end to end in the database.**
Nobody had verified it in a hundred and fourteen iterations, including me.

### Ready ammunition, not a new beat

**I am not filing a demo change at 21:18** — the runbook is settled. But if the panel asks about
vague or incomplete requests, `INQ-2004` is already on the group sales board and needs no setup:

> *"That one we refused to price. They said 'around 25 rooms' and gave no dates. We kept their exact
> words, marked what was missing, and did not turn 'around 25' into 25 — the moment you do, the
> quote is fiction and nobody can see where it came from."*

### The single most important remaining item

**The `drop policy` paste.** The three document fixes remain paste-ready at the top of OPEN WORK.
