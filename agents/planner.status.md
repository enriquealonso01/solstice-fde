# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 160 — 2026-09-26 01:12 EST

**The plan is accurate and correctly ordered.** This iteration was verification, one new task, and one
alternative I killed by measuring it.

### Verified clean — four deliverables nobody had checked. No task needed.

- **Guardrail evidence, and it used a floor.** `SUBMISSION.md:38` and `README.md:90` point at
  `agents/tested.log.md` for **18 of 19 guardrails verified against production**, naming **G16's voice half**
  as the exception, and say *"over 4,900 lines"*. The file is at **5,436 and climbing** — so the claim stays
  true as the log grows. PR #77's floors-not-counts lesson, applied by someone who was not told to.
- **Architecture diagram:** `diagram-guide.test.ts` green (6 tests), and it asserts the `.drawio` is still
  plain XML *first*, so a compressed save cannot silently pass every later check.
- **The SVG against the drawio, which nothing guards.** drawio has three pages, SVG has one — and
  `README-diagram.md:6` says so: *"a hand-authored render of the Future state page, sized for a projector."*
  **22 of 31 Future-state labels are in the SVG; all 9 absent ones are edge annotations** (`miss`,
  `phone only`, `primary failed`…). A projector render with *"nothing under 12px"* dropping 8px arrow labels
  is the stated design.
- **The net-new tool is deterministic by construction, not by test.** `availability.ts` has **zero**
  `Math.random`, `Date.now`, `new Date()`, `crypto`, `performance.now` — the figure is `hash32` over
  `property|date|roomClass`. And the identity gate is **code-backed**: `check_late_checkout` with a bare
  `reservation_code` returns *"Identify the guest first."*

Suite green at **674 / 52**, up 15 with T46's guards.

### Filed T48: the third sibling of the `SOL_THINKING` fix

It120 fixed `chat.ts:62` **and** `.env.example`, where T46 only asked about one. **`agent/sol.md:458` is the
third** and still says *"`SOL_THINKING=adaptive` **(default)** or `disabled`. Measured: disabling it does not
speed up the first token, it improves tool selection"* — presenting `adaptive` as operative when **production
ships `disabled`**, with an ambiguous antecedent on the benefit. **T41's shape exactly:** a phrase in three
places, two fixed, the third in the file that is both a named deliverable and the live voice prompt.

### And I killed my own clever alternative by measuring it

The obvious budget win is *"wrap §7 `Changing a rule live` in `voice:exclude` and get 2.6KB back."*

```
row fix only                    29,784   margin  216   truncated: false
row fix + §7 wrapped            30,033   margin  -33   truncated: TRUE
```

**Cause, verified: §7 contains an opening `<!-- voice:exclude -->` at +1863 whose closing marker is outside
the section.** `STRIP_BLOCK` pairs markers non-greedily in document order, so a new opener at the boundary
pairs with the existing block's closer. **General hazard, worth more than the task: `voice:exclude` blocks in
`agent/sol.md` span section boundaries**, so *"is this in the voice prompt?"* can only be answered by running
`compileInstructions`. Third time in four iterations that calling the real instrument overturned my reasoning
about it.

### One judgment call, stated rather than filed

`AVAILABILITY_MODE` / `AVAILABILITY_OVERRIDES` are a **second live-modification lever** (runtime env, no code
edit) and appear in **no** demo document — `docs/live-modification.md` is built entirely around the
discount-threshold code edit. **But they are in `agent/sol.md` §7's own "what you can change live" table**,
which a reviewer reads. So it is differently documented, not undocumented. Adding a rehearsed demo beat nine
hours out is starting something new. **Recommendation: leave it.** One sentence in `live-modification.md`
pointing at §7 is the whole opportunity if anyone has spare minutes.

### Open

| # | Item | Owner |
|---|---|---|
| 1 | **`drop policy` ×3** — `HUMAN_INTERVENTION.md:63`, SQL at **596** | Enrique — **do** |
| 2 | **Top up Telnyx** — under $4 and falling; Billing, ~$30 | Enrique — **do** |
| 3 | **T21** — delete `INQ-2012`/`INQ-2013`, cascade count first | Enrique — **do** |
| 4 | **T34** — SIP credential. **Accept; no action** | Enrique — decide |
| 5 | **Brief PDF in history.** Fixed and guarded. **Leave it; no action** | Enrique — decide |
| T47 | One index item in `HUMAN_INTERVENTION.md` + the guard that tests a snapshot | any agent |
| T48 | One row in `agent/sol.md`. **+129 chars measured; needs `--refresh` and a re-export** | any agent |

**T44 closed (It118), T46 closed (It120) — both corrected a premise of mine while shipping.** T46's
unverifiable half, whether production really runs `disabled`, is the half they took on.

**Tester silent 4h46m** — last write 2026-09-25 20:26:34 EDT. Inbox empty. No lock held.

### The single most important remaining item

**The `drop policy` paste.** Still the only open item with a live security consequence, still three lines.
