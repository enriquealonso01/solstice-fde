# Changing something live, on the call

The panel will ask you to modify the system while they watch. This is the change to reach for,
rehearsed end to end, with the real output captured from an actual run.

**The ask:** *"Drop Phoenix's discount ceiling from 15% to 12%."*

---

## The edit

`src/lib/rules/thresholds.ts`, one line:

```ts
'SOL-PHX': {
  property_code: 'SOL-PHX',
  property_name: 'Solstice Phoenix Camelback',
  group_block_auto_approve_max_rooms: 35,
  max_discount_auto_approve_pct: 15,   // <- change to 12
```

**Edit the `SOL-PHX` entry, not the first match.** The header comment at the top of that file quotes
this same snippet to explain why the threshold lives here, and two other properties share the same
15% ceiling, so a search for `max_discount_auto_approve_pct: 15` finds **three wrong lines before the
right one** — the comment near line 10, Austin at 54, Tampa at 93. **Search for `property_code: 'SOL-PHX',`
instead — that string occurs exactly once in the file** — and then change the **`max_discount_auto_approve_pct`
line inside that same object**, which is the only one of its name there. Searching for `'SOL-PHX'` on its own
still lands on the header comment first, which is the mistake this paragraph is about.

**Find that line by its name, not by counting down from the anchor.** An earlier revision of this paragraph
said "two lines below", which was wrong by one: two lands on `group_block_auto_approve_max_rooms`, and editing
the rooms cap leaves *"allowed 15"* reading 15 — the same false signal as editing the comment. A distance is
also the wrong shape even when it is right, because adding any field to that object silently moves it. Editing the comment changes nothing and the script's output does not move,
which is a confusing thirty seconds in front of an audience. The tell is that "allowed 15" stays
15. This is the one mistake to rehearse away, and it is easy to make: the testing agent made it on
its first attempt at this exact edit.

## Showing the result

```bash
npx vite-node scripts/show-verdict.ts -- INQ-2009
```

No network, no model, under a second. Run it before and after.

**Before** — real output, captured 2026-09-25:

```
INQ-2009 — Camelback Fitness Retreat at Solstice Phoenix Camelback
asked for 15 rooms at 17% off

  FLAG  GRP-DISCOUNT-CEILING
        asked 17, allowed 15
        "The customer asked for 17% off. We can approve up to 15% on our own, so this is 2 points over what we can authorise ourselves, and it needs a named approver to sign it off before it goes out."

  at the discount the customer asked for (17%): $7806.15
  (what they may actually be offered depends on the verdicts above)
```

**After** — same command, after changing one number:

```
INQ-2009 — Camelback Fitness Retreat at Solstice Phoenix Camelback
asked for 15 rooms at 17% off

  FLAG  GRP-DISCOUNT-CEILING
        asked 17, allowed 12
        "The customer asked for 17% off. We can approve up to 12% on our own, so this is 5 points over what we can authorise ourselves, and it needs a named approver to sign it off before it goes out."

  at the discount the customer asked for (17%): $7806.15
  (what they may actually be offered depends on the verdicts above)
```

Three things moved together and none of them is a prompt: the ceiling, the gap the rep is told
about (2 points becomes 5), and the sentence itself. **The price did not move**, and that is worth
saying out loud — $7806.15 is what the customer *asked for* either way. What changed is whether a
rep may agree to it alone.

## What to say while you do it

> "The threshold moved, and so did the sentence a sales rep reads to the customer. Nothing
> regenerated a prompt, because no threshold was ever in one. It is one number in one table, the
> verdict is derived from it, and the explanation is derived from the verdict."

Then, if they push on why that matters:

> "If the ceiling lived in the system prompt, this change would be a text edit with no test, no
> audit trail, and no way to prove afterwards which quotes were priced under which rule."

## If they want to see it in the product rather than a script

Reload the inquiry in the group sales dashboard after the edit and a redeploy. Say plainly that
the deploy takes a minute, and use the script for the live moment. Do not make an audience watch a
build.

## Two other edits that are safe to do live

| They ask | Where | Effect |
|---|---|---|
| "Make Providence route blocks over 10 rooms, not 15" | `thresholds.ts`, `SOL-PVD` overflow rule | INQ-2007's referral triggers earlier |
| "Have Sol stop narrating before tool calls on the phone" | `agent/sol.md`, the `SPEAKING AROUND A TOOL CALL` block | Voice stops saying "let me look that up"; needs a re-provision, so describe rather than run it |

## Do not offer to change

- **The masking layer.** Live-editing PII handling in front of a client reads badly even when it
  is safe.
- **The approval gate.** It is the guarantee the whole group workflow rests on; loosening it on a
  call, even temporarily, undermines the thing you just spent ten minutes explaining.
- **Anything in `netlify/functions/_delivery/`.** A mistake there sends something to a customer.
