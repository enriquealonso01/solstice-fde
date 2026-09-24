# `data/generated/` — the compiled dataset

**Do not hand-edit anything in this folder.** Every file is produced from the four provided
files in `data/` by:

```bash
node scripts/data/build.mjs           # write
node scripts/data/build.mjs --check   # non-zero exit if the output is stale
```

Output is **deterministic**: no timestamps in the payloads, stable key order, stable sort. A
diff here therefore means the source data or a parser changed, which is exactly what you want
to see in review. Provenance is a sha256 of every input file in `manifest.json`.

Read it through `netlify/functions/_lib/data.ts`, never with `fs`. That module is where the
two house rules are enforced: a quarantined value is never returned as a price, and raw
contact details never leave the layer except through `getInquiryDeliveryTarget()`.

| File | Shape | Notes |
|---|---|---|
| `properties.json` | `Property[]` | Exactly the shared interface. |
| `guests.json` | `Guest[]` + 3 fields | Masked at rest. |
| `reservations.json` | `Reservation[]` | Masked at rest. |
| `policies.json` | `PolicySection[]` | The 15 numbered sections. |
| `policy-document.json` | `{title, preamble, ...}` | The document header, incl. the "don't guess, loop in your Manager" line. |
| `inquiries.json` | `GroupInquiry[]` + extras | Superset; see below. |
| `rules.json` | `Ruleset` | The parsed business rules. Documented in full below. |
| `data-quality.json` | validation report | What was quarantined and why. |
| `manifest.json` | sha256 + row counts | Provenance. |

---

## Conventions that apply everywhere

- **Money is whole US dollars**, as in the source CSVs (`nightly_rate: 219`). Convert with
  `toCents()` from `_lib/data.ts` before any arithmetic. Per `AGENTS.md`, arithmetic happens
  in integer cents.
- **Dates are ISO `YYYY-MM-DD` strings.** Ranges are `{ start, end }`, both **inclusive**.
- **Room types** use the display labels, not the CSV column names, so that
  `property.inventory[reservation.room_type]` is a direct lookup. The canon and the
  normaliser live in `netlify/functions/_lib/roomTypes.ts`.
  - *Assumption:* the CSV's generic `accessible_rooms` column is surfaced as
    **`Accessible King`**, because that is the only accessible room type that appears
    anywhere in the reservation data (R55016). `Accessible King` is priced off
    `base_rate_standard`; the source carries no separate accessible rate.
- **`null` means "we do not have this"**, and it is never quietly replaced with a default.

---

## `properties.json` — `Property[]`

Exactly the `Property` interface from `shared/types.ts`. Two fields deserve attention.

**`inventory`** is the five CSV room columns keyed by display label:

```json
"inventory": { "Standard King": 45, "Standard Double": 35, "Deluxe King": 20, "Suite": 15, "Accessible King": 5 }
```

The build checks that this sums to `total_rooms` and flags `inventory_sum_mismatch` if not.
It currently balances for all ten properties.

**`data_quality_flags`** is a list of stable snake_case ids:

| Flag | Meaning |
|---|---|
| `base_rate_<class>_negative` / `_zero` / `_missing` | The rate failed validation and is **quarantined**. |
| `inventory_<column>_unparsed` | A room-count cell was not a number. |
| `inventory_sum_mismatch` | Room classes do not add up to `total_rooms`. |
| `blackout_dates_unparsed` | A blackout segment could not be read as a date range. |
| `max_discount_auto_approve_pct_out_of_range` | Ceiling outside 0–100. |
| `notes_reference_unresolved_property` | The free text points at a property that is not in the directory. |

### The `-395` quarantine

`SOL-PVD.base_rate_suite` is `-395` in the source export. A negative nightly rate multiplies
into a negative line total and a proposal that pays the guest to stay.

The raw value **is preserved** in `properties.json` so the error stays auditable and visible
in the admin UI. It is quarantined at the **access** layer instead:

```ts
getPropertyRate('SOL-PVD', 'Suite')
// { ok: false, flag: 'base_rate_suite_negative',
//   reason: 'The suite rate for Solstice Providence Waterplace failed validation ... Route to
//            Sales or GM Owen Fitzgerald for a rate rather than estimating one.' }
```

`getPropertyRate()` is the **only** sanctioned way to obtain a nightly rate. Reading
`property.base_rate_suite` directly anywhere else is a bug. An `ok: false` lookup must become
a `grounded: false` `ToolResult`, which obliges the agent to escalate rather than improvise.
Pinned by `scripts/data/__tests__/quarantine.test.ts`.

---

## `guests.json` / `reservations.json` — masked at rest

Masked by `netlify/functions/_lib/mask.ts`, which the build script imports **directly** (Node
strips the types), so the masking applied at rest is literally the same code the runtime uses.

```json
{ "guest_id": "G10001", "email_masked": "l***@example.com", "phone_masked": "***-***-0148",
  "phone_lookup": "02f8c145...", "email_lookup": "f925a4ac...", "marketing_opt_in": true }
```

Beyond the `Guest` interface: `marketing_opt_in`, plus two **one-way lookup keys**.

Masking destroys the join key: once a phone is stored as `***-***-0148` you can no longer
match an inbound caller ID against it, and the last four digits alone are **ambiguous in this
very dataset** — G10001 and G10020 both end `0148`, G10007 and G10015 both end `0177`. So
`lookup.ts` stores a salted one-way hash of the normalised number. Caller ID comes in, gets
normalised and hashed, matches exactly, and no phone number is ever stored.

`getGuestByPhone()` returns `found` / `ambiguous` / `not_found`. With only four digits it
returns **`ambiguous`** and the agent must ask a second question. Guessing there would attach
the wrong reservation to a caller, which is the worst failure mode this system has.

`reservations.json` carries `payment_last4` only — four digits, never spoken aloud.

---

## `policies.json` — the 15 sections

```json
{ "section_id": "policy:5", "number": 5, "title": "Service Recovery Window",
  "title_source": "SERVICE RECOVERY WINDOW", "body": "A guest who had a real problem ..." }
```

`section_id` is the `Citation.ref` format, so a tool can cite `policy:5` precisely.
`searchPolicies(query, limit)` does scored keyword retrieval over title + body with a synonym
table — small enough that a full scan beats any index, and unlike an embedding the score is
fully explainable on stage ("how many of your words, and their synonyms, are in this section").

The document header lives in `policy-document.json`, including the line the agent's guardrails
should inherit: *if a situation doesn't clearly fit one of these, don't guess, loop in your
Manager or AGM.*

---

## `inquiries.json` — `GroupInquiry[]` plus extras

A **superset** of `GroupInquiry`: the interface does not model every CSV column, and the
extras are load-bearing (`date_received` is what the Chicago lead-time rule measures against).

| Extra field | Why |
|---|---|
| `contact_email_masked` / `contact_phone_masked` | What the rep and the agent see. |
| `date_received` | Lead-time arithmetic. |
| `nights`, `stated_budget_per_night`, `meeting_space_needed` | CSV columns the interface omits. |
| `rooms_requested_raw`, `rooms_requested_approx` | See below. |
| `incomplete_fields` | Non-blocking gaps worth asking about. |
| `is_actionable` | `missing_fields.length === 0`. |
| `dataset_notes` | **The challenge author's answer key. Never send this to the agent.** |

`listInquiries()` strips `dataset_notes` and nulls `contact_email` / `contact_phone`.
`listInquiriesWithDatasetNotes()` exists for our own evaluation harness only. The raw address
is resolved solely by `getInquiryDeliveryTarget()`, on the send path, which must write to
`audit_log`. `scripts/data/seed.mjs` strips `dataset_notes` before writing to Supabase, because
the group-sales side chat reads that table.

### `missing_fields` vs `incomplete_fields`

**`missing_fields` is blocking.** Without these we cannot price, date, or place the block:
`company_name`, `contact_name`, `preferred_property_code`, `arrival_date`, `departure_date`,
`rooms_requested`; plus `contact_channel` when *both* email and phone are absent; plus
`meeting_capacity_needed` when `meeting_space_needed` is true.

**`incomplete_fields` is worth asking about** but a proposal can still be drafted.

`MISSING_FIELD_PROMPTS` in `_lib/data.ts` maps each field to the question to ask, so clarifying
questions read identically from chat, voice, and the group-sales side chat.

**INQ-2004** is the only non-actionable row:

```json
"missing_fields": ["arrival_date", "departure_date", "rooms_requested", "meeting_capacity_needed"],
"rooms_requested": null, "rooms_requested_raw": "around 25", "rooms_requested_approx": 25
```

`"around 25"` is **not** parsed into `rooms_requested`. We do not price off an approximation,
but we keep the signal so the agent can ask *"you mentioned around 25 — can you confirm?"*
The missing phone is **not** blocking, because an email is on file.

---

## `rules.json` — the parsed business rules

The seasonal and special rules are buried in a free-text `notes` column. Hoping the model
notices them at runtime is not a plan, so they are parsed into structured rules at build time
by `scripts/data/lib/rules.mjs`.

**The parsers read the numbers out of the text.** Change `8%` to `7%` in the CSV, re-run the
build, and the ceiling moves; nothing is hardcoded. `scripts/data/__tests__/rules.test.ts`
proves this by feeding the parser a property it has never seen, with different numbers in the
prose, and checking the output follows the text. That is the "change a threshold live" answer.

### Top level

```jsonc
{
  "schema_version": 1,
  "generator": "scripts/data/build.mjs -> lib/rules.mjs",
  "resolution": {
    "discount_ceiling": "most_restrictive_wins",
    "note": "When several discount_ceiling rules match the same stay, the LOWEST
             constraint.value is the effective ceiling. Report the winning rule_id in
             RuleVerdict.rule_id so the rep can see which rule bit."
  },
  "predicate_semantics": { /* how to read applies_when, see below */ },
  "evaluation_context_fields": [ /* what the engine must supply, see below */ ],
  "counts": { "total": 65, "by_kind": { ... }, "parsed_from_notes": 7 },
  "rules": [ /* Rule[] */ ],
  "notes_coverage": [ /* one row per clause of every property note */ ]
}
```

### A `Rule`

```jsonc
{
  "rule_id": "SOL-DEN.discount_ceiling.ski_season_weekends",  // stable, <PROPERTY>.<kind>.<slug>
  "property_code": "SOL-DEN",        // null would mean portfolio-wide
  "kind": "discount_ceiling",
  "label": "Ski-season weekends discount ceiling",
  "on_violation": "flag",            // 'flag' | 'fail' | null (advisory)
  "applies_when": {                  // ALL present predicates must hold; ABSENT = always
    "match": "any_night",            // predicate fires if ANY night of the stay is in-window
    "months": [12, 1, 2],            // calendar months, 1-12
    "weekdays": ["Thu","Fri","Sat","Sun"]
  },
  "constraint": {
    "field": "requested_discount_pct",
    "op": "lte",
    "value": 8,
    "unit": "percent"
  },
  "human_reason": "Ski-season weekends at Solstice Denver Union Station run at a reduced group discount ceiling of 8%.",
  "violation_template": "The requested {actual}% discount is above the seasonal ceiling of {threshold}% ...",
  "recommended_action": "Counter at 8% for these dates, or route to Priya Nair for an exception.",
  "citation": { "source": "property", "ref": "property:SOL-DEN", "label": "Solstice Denver Union Station (property record)" },
  "provenance": {
    "source_field": "notes",
    "extraction": "parsed_from_notes",   // | "structured_column" | "unparsed_clause"
    "source_text": "Ski-season weekends (Dec-Feb, Thu-Sun) run at reduced group discount ceiling of 8%"
  }
}
```

`rule_id`, `constraint.value` and `violation_template` map straight onto `RuleVerdict` from
`shared/types.ts`: `{ rule_id, status, actual, threshold, human_reason }`. Substitute
`{actual}` and `{threshold}` into the template to get `human_reason` for that evaluation.

### `applies_when` predicates

| Key | Meaning |
|---|---|
| *(absent)* | Does not constrain. The rule applies. |
| `match: "any_night"` | The date predicate fires if **any** night of the stay is in-window. |
| `months: number[]` | Calendar months, **1–12**. Wrapping ranges are expanded (`Dec-Feb` → `[12,1,2]`). |
| `weekdays: string[]` | Three-letter names. `WEEKDAYS.indexOf(name)` equals JS `Date#getDay()`. |
| `min_rooms` / `max_rooms` | **Inclusive.** `min_rooms: 26` is the CSV phrase *"over 25"*. |
| `text_match: {fields, any_of}` | Case-insensitive substring match of any `any_of` term against any of `fields`. |

### `kind` values, and what each `constraint` means

| `kind` | `constraint` | `on_violation` | Count |
|---|---|---|---|
| `discount_ceiling` | `requested_discount_pct lte <pct>` | `flag` | 12 |
| `auto_approve_rooms` | `rooms_requested lte <n>` | `flag` | 10 |
| `meeting_capacity` | `meeting_capacity_needed lte <n>` | `fail` | 10 |
| `inventory_capacity` | `rooms_requested lte_inventory_for_room_type <inventory map>` | `fail` | 10 |
| `blackout` | `stay_dates not_overlaps <DateRange[]>` | `fail` | 8 |
| `hard_blackout` | `stay_dates not_overlaps <DateRange[]>` + `negotiable: false` | `fail` | 1 |
| `lead_time` | `lead_time_days gte <days>` | `fail` | 1 |
| `required_document` | `documents_on_file includes <doc>` | `flag` | 1 |
| `routing` | `rooms_requested lte <n>` + `referral{}` | `flag` | 1 |
| `advisory` | `null` + `pricing_safe: false` | `null` | 11 |

`flag` means *a human decides*; `fail` means *the answer is no*. `inventory_capacity` is an
upper bound on the **building**, not an availability check for the dates — that is the
`check_availability` tool's job.

### Evaluation context the engine must supply

`rooms_requested`, `requested_discount_pct`, `arrival_date`, `departure_date`, `stay_dates`,
`lead_time_days` (arrival minus `date_received`, in days), `meeting_capacity_needed`,
`room_type_preference` (canonical), `documents_on_file`, and `event_type` /
`special_requests` / `company_name` for `text_match`.

### The six rules the brief cares about

| Rule id | What it does |
|---|---|
| `SOL-DEN.discount_ceiling.ski_season_weekends` | 8% ceiling, Dec–Feb, Thu–Sun. |
| `SOL-SAC.discount_ceiling.state_legislature_session_weeks` | 8% ceiling, Jan–May weekdays. Binds **INQ-2010**, whose 10% is inside the property's standing 10% ceiling but over the seasonal one. |
| `SOL-AUS.hard_blackout.sxsw` | `negotiable: false`, `fail`. Catches **INQ-2003**. No discount changes the answer. |
| `SOL-CHI.lead_time.over_25_rooms` | `min_rooms: 26`, 14 days. |
| `SOL-CMH.required_document.youth_groups_insurance_certificate` | `flag`, matches on `youth`. A required follow-up for **INQ-2008**, not a rejection. |
| `SOL-PVD.routing.overflow_block` | `min_rooms: 16`. Catches **INQ-2007** at 20 rooms. |

### `referral` — the sister property that does not exist

```jsonc
"referral": {
  "target_description": "Boston-area sister property",
  "target_property_code": null,
  "resolved": false,
  "resolution_note": "UNRESOLVED. \"Boston-area sister property\" does not correspond to any
                      property in the Solstice directory (10 properties, none matching). The
                      agent may mention that a referral exists; it must NOT quote rooms,
                      rates, dates or availability for it, and must hand the inquiry to Group
                      Sales to confirm the property is real."
}
```

The build resolves the referral target against the real directory. It does not resolve, so the
property also gets `notes_reference_unresolved_property` and `data-quality.json` records it as
a blocker. Surface the referral; never invent the inventory. (The parser *does* resolve targets
that exist — tested.)

### `notes_coverage` — proof that nothing was dropped

One row per clause of every property note:

```json
{ "property_code": "SOL-DEN", "clause": "Ski-season weekends (Dec-Feb, ...) ...",
  "rule_ids": ["SOL-DEN.discount_ceiling.ski_season_weekends"], "parsed": true }
```

`parsed: false` means no parser understood that sentence; it survives as an `advisory` rule
with `constraint: null` and `pricing_safe: false`, so the agent may cite it as context but it
grants no discount and imposes no threshold. This is how we can say on stage that no sentence
of the source data was silently ignored.

**Phoenix is the case that matters here.** *"Rate drops ~20% June-Aug (off-peak)"* is parsed
into `SOL-PHX.advisory.off_peak_rates` with `months: [6,7,8]`, `approximate: true` and
`pricing_safe: false`. It is negotiating context, **not** a 20% discount the agent may hand
out — which is exactly the distinction **INQ-2009** (17% requested vs a 15% ceiling, in July)
turns on.

---

## `data-quality.json`

```jsonc
{
  "checks_run": [ /* the five validators */ ],
  "quarantined_values": [ { "ref": "property:SOL-PVD", "field": "base_rate_suite",
                            "raw_value": -395, "flag": "base_rate_suite_negative",
                            "severity": "blocker", "effect": "...", "remediation": "..." } ],
  "unresolved_references": [ /* the Boston sister property */ ],
  "properties_with_flags": [ /* code -> flags */ ]
}
```

Good material for the Super Admin "Backend" page: it is the honest answer to *"what happens
when the source data is wrong?"*
