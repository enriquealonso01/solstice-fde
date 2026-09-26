# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 233 — 2026-09-26 07:46 EST

**The plan is accurate and correctly ordered. Nothing is open for an agent. No new tasks.**

`data:check` proves the generated JSON matches the CSVs the interviewers sent. **Nothing proved the seeded
database does** — and that is the copy the group beat reads from. I checked it field by field.

### Ten inquiries, a hundred field comparisons, ninety-nine exact

```
csv 10 rows · live 13 rows
MISMATCH  INQ-2004.rooms_requested:  csv='around 25'  live=''
extra live codes: INQ-2011, INQ-2012, INQ-2013
```

**The one mismatch is the ambiguity beat working**, and the live row states it better than any document:

```
INQ-2004  status: needs_info
  rooms_requested:        None           <- not coerced
  rooms_requested_raw:    'around 25'    <- their words, kept
  rooms_requested_approx: 25             <- the parse, named so it cannot be read as a fact
  missing_fields: [arrival_date, departure_date, rooms_requested, meeting_capacity_needed]
```

**The one field where a faithful copy would have been wrong is the one field that is not a copy.** The three
extra rows are accounted for: INQ-2011 is the runbook's demo row (line 293); INQ-2012/2013 are T21's DELETE-ME
rows.

### The guest side closes on an arithmetic that only works because of a documented quirk

```
solstice-guest-profiles.csv  25 rows
live                         25 reservations, 24 distinct guests
more than one stay: {G10004: 2} -> R55004, R55015
```

25 rows → 25 reservations and **24** guests, the missing one being **Michael Chen**, the only guest with two
stays — the thing the cheat sheet's first row warns about. A count that failed to close would look like a
dropped row; this one closes *because* of the quirk the demo is built around. Properties: 10 and 10.

### So the chain has three links, and all three are now checked

```
their CSVs -> data/generated/*.json   "OK - 9 generated files match their sources"
           -> the deployed bundle      the concierge path is compiled from those files
           -> Postgres                 10/10 inquiries, 99/100 fields, 25/24/10 rows
```

### My instrument was wrong first, and it failed silently

My first count asked `select=id` on tables keyed `guest_id`, `reservation_id` and `property_code`. It returned
nothing countable and I was one sentence from concluding *"guest data is not in Postgres at all"* — a story I
already half-believed, which is what made it dangerous.

> **Third query of mine tonight naming a column that does not exist.** `select=*&limit=1` before
> `select=<field>` costs one call and has now saved three wrong conclusions.

### Open

| # | Item | Owner |
|---|---|---|
| 1 | **`drop policy` ×3** — **only Enrique can.** SQL at **609**, ***"### What to run"***. **Breaks nothing; verified three ways** | Enrique — **do** |
| 2 | **Top up Telnyx** — under **$3.01** at 06:45, no credit line, fewer than six calls, hard stop at zero | Enrique — **do** |
| 3 | **T21** — **delegable**: an agent has the key and declined on judgement. *Its two rows confirmed live again this iteration* | Enrique — **do** |
| 4 | **T34** — SIP credential. **Accept; no action** | Enrique — decide |
| 5 | **Brief PDF** — absent from the public tree. **Leave it; no action** | Enrique — decide |
| 6 | **Your own address in this file.** Removing it breaks nothing. **No recommendation** | Enrique — decide |

Nothing for an agent. Suite green at **923 / 65 files**. Tester silent since 20:26 (**11h20m**); no open
findings. Inbox and In progress empty. No lock held; I took none. Plan guards re-run: **104 green**.

### The single most important remaining item

**The `drop policy` paste.** The grounding chain from their CSVs to the live database is now checked end to end.
**The SQL is the one action left that nobody else can take.**
