# `data/generated/`

Generated from the four provided files in `data/`. Never hand-edit: change the source and rebuild.

```bash
npm run data:build   # write
npm run data:check   # exit 1 if anything here is stale
```

Built by `scripts/data/build.mjs` (properties in `scripts/data/lib/properties.mjs`), deterministically:
a diff here means the source data or the build changed.

| File | Built from | What it is |
|---|---|---|
| `properties.json` | `solstice-properties.csv` | `Property[]`. Every per-property number; `src/lib/rules/thresholds.ts` derives the group rule table from it. |
| `guests.json` | `solstice-guest-profiles.csv` | Guests, email and phone masked at rest, plus one-way caller-ID lookup keys. |
| `reservations.json` | `solstice-guest-profiles.csv` | Stays; card reduced to its last four digits. |
| `policies.json` | the policy reference `.md` | The 15 numbered sections. |
| `policy-document.json` | the policy reference `.md` | The document title and preamble. |
| `inquiries.json` | `solstice-group-inquiries.csv` | `GroupInquiry[]` plus completeness fields (`missing_fields` blocks pricing, `incomplete_fields` does not). |
| `data-quality.json` | the properties | Quarantined values and why. |
| `manifest.json` | all four | sha256 of each input and row counts. |

Read at runtime through `netlify/functions/_lib/data.ts`, and by `thresholds.ts` for
`properties.json`. `npm run db:seed` upserts them into Supabase, where the sales inbox reads
inquiries.

Two rules the data layer enforces:

- **SOL-PVD's `base_rate_suite` is `-395`.** The raw value is kept for audit and flagged
  `base_rate_suite_negative`; `getPropertyRate()` and the group engine refuse to price from it.
- **`inquiries.json` keeps raw contact details** so a proposal can be delivered, plus the
  challenge's `dataset_notes` answer key. `data.ts` strips both from everything except the send
  path, and `db:seed` drops `dataset_notes`.

Conventions: money is whole dollars as in the CSVs (convert to integer cents before arithmetic);
dates are ISO `YYYY-MM-DD` and ranges are inclusive; `null` means not supplied, never a default.
