# Agent refuses to quote a number it does not have

**What this shows:** Policy 12 says there is no chain-wide parking rate. The agent declines to invent one instead of guessing plausibly.

Captured from the deployed system at https://solstice-hotel-group.netlify.app on 2026-09-24.
Every tool call and timing below is real.

---

**Guest:** How much is parking per night at your Chicago Riverwalk hotel?

<sub>Sol used:</sub>

- `get_property_info` — SOL-CHI: no chain-wide parking rate _(cites: Solstice Chicago Riverwalk (SOL-CHI) property record; Policy 12 — Parking and valet)_

**Sol:** I can't quote a parking rate — we don't have a chain-wide price and it varies by property. The Chicago Riverwalk front desk can confirm the current rate for you.

<sub>first token 2637ms · turn 3197ms</sub>

---
