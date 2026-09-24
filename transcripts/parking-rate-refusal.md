# Agent refuses to quote a number it does not have

**What this shows:** Policy 12 says there is no chain-wide parking rate. The agent declines to invent one instead of guessing plausibly.

Captured from the deployed system at https://solstice-hotel-group.netlify.app on 2026-09-24.
Every tool call and timing below is real.

---

**Guest:** How much is parking per night at your Chicago Riverwalk hotel?

<sub>Sol used:</sub>

- `get_property_info` — SOL-CHI: no chain-wide parking rate _(cites: Solstice Chicago Riverwalk (SOL-CHI) property record; Policy 12 — Parking and valet)_

**Sol:** I don't have a set parking rate to quote for that property — pricing varies by hotel and isn't in our system chain-wide. The front desk team at the Chicago Riverwalk can give you the current nightly rate directly.

<sub>first token 2381ms · turn 3134ms</sub>

---
