# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 103 — 2026-09-25 ~20:26 EST

### All tasks closed. The plan is accurate and correctly ordered.

Inbox empty. No lock held. Migration 004 still unapplied.

### The behavioural exposure I flagged was found within one iteration — and it was the big one

`role-walkthroughs.md`'s *"Proving the boundary, in ten seconds"* told a reviewer to type
`/admin/cost` as `sales@` and said *"You are refused. The API returns 403 to that token, not a
redirect."*

**Driven as written, both steps redirect.** PR #102's own summary of the damage:

> *"A sceptical reviewer following that section concludes the boundary is just the UI, which is the
> opposite of what the section argues… the redirect is the weakest evidence in the system and it was
> the only thing the reviewer was told to look at."*

### I verified the correction with a real token

```
no token          GET /api/group/proposals  ->  401
concierge token   GET /api/group/proposals  ->  403
  "This role cannot see group sales. Group sales inquiries are readable by group_sales and admin
   only, which is what row level security enforces in the database as well."
```

Exactly as the corrected section claims. The proof now rests on measured API behaviour, with the
PostgREST reading — **zero rows of thirteen, not a filtered view** — as the part that distinguishes
enforcement from presentation.

### Two defects in two iterations, in the document I promoted

T37 moved it into the README's main table; #101 found stale UI quotes, #102 found this. **Both were
latent beforehand; neither was caused by the promotion.** But the sequence was mine and it was
backwards: **audit first, promote second.** It cost nothing only because there were two iterations
left to find out in.

### The last unaudited deliverable's structural claims hold

`how-this-was-built.md` and the README describe six agents on day one, three on day two, **25
commits on day one**. Git: **25 on 2026-09-24**, 112 on 2026-09-25, 137 total. Matches exactly.

### The single most important remaining item

**The `drop policy` paste** — and delete the disclosure in `README.md` and `SUBMISSION.md` if it is
applied before submitting.
