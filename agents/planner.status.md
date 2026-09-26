# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 115 — 2026-09-25 ~21:22 EST

### Mapped where the demo's data comes from. "Is it the provided data" has three answers

`netlify/functions/_lib/data.ts:26-30` imports `data/generated/*.json` directly. **The concierge
tools never touch Supabase** — guests, reservations, properties and policies are compiled into the
deployed bundle.

| What | Source | Reaches the demo via | Verified by |
|---|---|---|---|
| guests, reservations, properties, policies | `data/*.csv` | generated JSON **imported into the functions** | `data:check` + current deploy |
| the ten portal inquiries | `data/*.csv` | **Supabase** | my field comparison, It114 — 56/60 exact, 4 deliberate |
| proposals, sessions, escalations | runtime | **Supabase** | Tester's PDF sweep, session counts |

**Two things worth having in the room:**

1. **`data:check` passing + a current deploy is a complete proof for the concierge path** — every
   guest, reservation, property and policy the agent can reach is the provided file, compiled in.
   Two commands, and it answers *"how do we know it is not making up rates."*
2. **The inquiry path is the only one where CSV and database can disagree**, which is why It114's
   comparison mattered and why it is the one to re-run if anything is touched before 11:00.

### Beat 5's fixture confirmed through the path it travels

```
R55004 in data/generated/reservations.json : true
  G10004 · SOL-DEN · Loyalty Redemption · Michael Chen · Platinum
```

**Platinum** — the point of that beat, since the guarantee is unconditional and the contrast under
failure injection survives. Verified in the bundle the deployed function reads, not only the CSV.

### Part of T39 landed

**PR #115** gave the runbook the tidy preview command it was missing — the half I folded in at
iteration 110. **Three fixes remain**, all paste-ready at the top of `▶ OPEN WORK`.

### The single most important remaining item

**The `drop policy` paste.**
