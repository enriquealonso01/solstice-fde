# Changing a threshold live

**The ask:** *"Drop Phoenix's discount ceiling from 15% to 12%."*

Every per-property number the group engine uses (rooms cap, discount ceiling, meeting capacity,
blackout dates, room inventory, rates) has one hand-edited home: `data/solstice-properties.csv`.
`src/lib/rules/thresholds.ts` derives its table from the build output and holds no numbers. The few
rules that exist only in the CSV's free-text notes are the exception, covered at the end.

**1. Edit the cell.** In `data/solstice-properties.csv`, row `SOL-PHX`, column
`max_discount_auto_approve_pct`: `15` becomes `12`.

**2. Rebuild.** `npm run data:build` rewrites `data/generated/properties.json`. The runtime reads
that bundled file, not Supabase: the chat tools, the group engine in the Netlify functions and the
admin inbox all import it. So skip `db:seed`: the Supabase `properties` table is a mirror nothing
reads at runtime, and the seed also rewrites the live inquiries table.

**3. Show the verdict.** No network and no model; it takes 1 to 2 s, so do not promise it is instant.
`--as-of` evaluates the inquiry before its 2026-07-28 arrival, which is now past.

```bash
npm run verdict -- INQ-2009 --as-of 2026-07-01
```

Before:

```
  FLAG  GRP-DISCOUNT-CEILING
        asked 17, allowed 15
        "The customer asked for 17% off. We can approve up to 15% on our own, so this is 2 points over what we can authorise ourselves, and it needs a named approver to sign it off before it goes out."

  at the discount the customer asked for (17%): $7806.15
```

After:

```
  FLAG  GRP-DISCOUNT-CEILING
        asked 17, allowed 12
        "The customer asked for 17% off. We can approve up to 12% on our own, so this is 5 points over what we can authorise ourselves, and it needs a named approver to sign it off before it goes out."

  at the discount the customer asked for (17%): $7806.15
```

The price does not move. What moves is whether a rep may agree to it alone, and what the rep says.

**4. Run the suite.** `npx vitest run` stays green: tests read thresholds from the data.

**5. Deploy.** The functions and the browser bundle carry the JSON, so production changes on the next
deploy (`netlify deploy --build --prod`); every Phoenix verdict evaluated after it uses 12%.

## Another safe live edit

*"Make Providence route blocks over 13 rooms, not 15."* This rule exists only in the CSV `notes`, so
it is hand-coded as `PROVIDENCE_OVERFLOW` in `src/lib/rules/seasonal.ts`. Change `over_rooms`, its
`source_note` and the SOL-PVD CSV note together (`over 15 rooms` becomes `over 13 rooms`);
`single-source.test.ts` fails if they disagree. Then run steps 2 to 5 with `npm run verdict -- INQ-2007`
(20 rooms): the referral reads "anything over 13 rooms", and `get_property_info` tells chat and voice
the same. Keep it at 12 or above: INQ-2006 is a 12-room Providence block the suite expects to approve.
