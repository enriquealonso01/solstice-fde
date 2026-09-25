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
