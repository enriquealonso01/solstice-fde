# Requirements audit: what the brief asked for, what exists, what is left

> ## Update, 2026-09-26 — nine verdicts below have moved, all in the same direction
>
> **Nothing below is edited.** It is an honest snapshot of 2026-09-24 and reads as one. But an audit states
> *verdicts*, and a stale verdict about coverage is read as a claim about completeness — so here is what
> changed, each re-measured today rather than remembered.
>
> *This table said **eight** until iteration 139. **D1** was missed by the pass that wrote it, and D1 covers
> one of the brief's six evaluation criteria — so the sweep that corrected understatements understated its
> own coverage. Worth leaving visible: a list of corrections is exactly the kind of list that gets read as
> complete.*
>
> | Row | Then | Now |
> |---|---|---|
> | **A5** net-new tool | *"`availability_service`"* | that name no longer exists in the code; a test bans it. The service is `netlify/functions/tools/availability.ts`, consumed by `check_late_checkout` and `check_upgrade_eligibility` |
> | **B6** latency | *"missed the first target"* | **met**, on two passes: first-signal p50 905ms and 1009ms against the committed 1500ms. `docs/latency-target.md` carries the re-measurement, and the original confession with it |
> | **C6** transcripts | *"4 chat transcripts plus a voice one"* | **six** files in `transcripts/`, the sixth being the honest-handoff capture |
> | **C8 / D3** live modification | **PARTIAL**, *"never been rehearsed"* | rehearsed end to end by the Tester and written up in `docs/live-modification.md`, including the mistake they made on the first attempt |
> | **D1** explain to both audiences | **PARTIAL**, *"no rehearsed narrative tying them together"* | the narrative exists and names those two audiences in its own first sentence: `docs/demo-runbook.md` is *"written for two audiences in one room: a director of engineering and a non-technical product owner"*, with **11** scripted `Say:` lines and a beat titled *"Cost, for the product owner"*. `docs/role-walkthroughs.md` walks all three roles click by click — *"what each click proves"*. The technical half is more than the Backend map: `docs/how-this-was-built.md` and `docs/integration-recommendation.md` are both written for the engineer in the room. **DONE** |
> | **D2** ambiguity | *"7 stated assumptions"* | **9** |
> | **D5** surprise and delight | *"missing the live failure-injection demo; supervisor takeover unverified"* | failure injection was run on production, and the supervisor ladder was verified on a live call — with its one real limit, Sol's own audio, stated in the README rather than glossed |
> | **D6 / P1 item 7** future capabilities | *"no roadmap framed in business outcomes"* | `docs/where-this-goes.md`, written in outcomes and opening on exactly that distinction |
> | **E** flaky tests | *"a run showed 8 failures then 0 with unchanged code"* | closed by `vitest.setup.ts`, which strips every credential before any test file loads. **681 tests in 2.0s**, and green in a fresh clone of the public repo with no `.env` at all |
>
> **What has not moved:** the SMS/10DLC gap is still open and still disclosed, and the follow-ups table is
> still unexercised. Both are in `README.md`'s limits section in the package's own words.
>
> The list in **F** should be read the same way: P1 items 5, 6, 7 and 8 are done. What is left at submission
> is four things only Enrique can do, and they are in `HUMAN_INTERVENTION.md`, not here.


Written 2026-09-24 against the challenge PDF and Katie's email. The point of this file is to stop
drift: everything below is either a stated requirement or a stated evaluation criterion. Anything
not on this list is optional polish, however good it looks.

Legend: **DONE** verified working · **PARTIAL** exists, not finished or not verified · **MISSING**

---

## A. The three things the brief says to build

| # | Requirement | Status | Evidence |
|---|---|---|---|
| A1 | Guest and Staff Concierge Agent, conversational, grounded in the provided data | **DONE** | Live on chat and on +1 305 786 6217. Refuses ungrounded answers, cites policy sections |
| A2 | Knows what it cannot do and escalates with full context | **DONE** | Escalation packet with reservation, rate plan, policy citations, attempted resolutions. 4 escalations recorded |
| A3 | Group Booking Workflow, agentic: gather, check availability and rates, apply rules, generate proposal or flag | **DONE** | All 10 inquiries produce correct verdicts; proposals with PDFs; approval gate |
| A4 | Custom fit-for-purpose UI, not a Claude or ChatGPT window | **DONE** | Hotel landing page with chat bubble, plus three scoped staff dashboards |
| A5 | At least one net-new tool not handed to us in the data | **DONE** | `availability_service`, plus `check_comp_authority`. Documented as assumptions |

## B. Requirements and guardrails, as listed

| # | Requirement | Status | Evidence |
|---|---|---|---|
| B1 | Resolve most routine questions without a human | **DONE** | Policy, reservation, tier, late checkout, amenities all self-serve |
| B2 | Handoff carries full context, not a restart | **DONE** | Escalation packet schema |
| B3 | Never invent a policy, rate or availability | **DONE** | `grounded: false` forces escalation; parking refusal is the demo case |
| B4 | Group proposals outside the rules are flagged, never auto-approved | **DONE** | `canSend` gate refuses on every path including the agent's own send tool |
| B5 | Guest PII, especially payment, never unmasked | **DONE** | Masked at the data layer, enforced in tests, card digits never returned to the model |
| B6 | Set a latency target and justify it | **DONE** | `docs/latency-target.md`: measured, missed the first target, explains why and what we traded |

## C. What else the brief asks for

| # | Requirement | Status | Gap |
|---|---|---|---|
| C1 | Architecture diagram, future-state production | **DONE** | `docs/architecture.drawio` (3 pages) + `.svg` |
| C2 | Diagram shows data provenance, where the agent runs, monitoring, graceful degradation | **DONE** | Dedicated degradation page with 6 numbered paths |
| C3 | Short integration recommendation, PMS / CRS / loyalty | **DONE** | `docs/integration-recommendation.md` |
| C4 | The "is the AI coming for our jobs" answer | **DONE** | Same file, grounded in Policy 6 admitting its own limit |
| C5 | Source code and agent configuration `.md` | **DONE** | `agent/sol.md`, 19-row guardrail table |
| C6 | A few sample transcripts | **DONE** | 4 chat transcripts recaptured against the current prompt, plus `transcripts/voice-call.md`: a real 5m44s phone call exported from the database with its tool trace |
| C7 | Native export from the platform of choice (.zip, .json) | **DONE** | `exports/telnyx-assistant.json`, 25 tools, secret redacted, regenerate with `npm run telnyx:export` |
| C8 | Be ready to open the hood and change something live | **PARTIAL** | The path exists (`thresholds.ts`, one line, re-runs) but has never been rehearsed |

## D. What Katie's email adds, which the PDF does not

| # | Criterion | Status | Gap |
|---|---|---|---|
| D1 | Explain clearly to BOTH technical and non-technical stakeholders | **PARTIAL** | Backend map for technical, cost page for commercial. No rehearsed narrative tying them together |
| D2 | Handle ambiguity well | **DONE** | 7 stated assumptions in the README; INQ-2010 blackout catch; the phantom Boston property |
| D3 | Modify or explain parts live, under questioning | **PARTIAL** | Same as C8. Needs one rehearsed, known-safe live edit |
| D4 | Demonstrate leveraging AGENTS to build MVP software | **DONE** | `docs/how-this-was-built.md`: the six-agent setup, the five cross-agent bugs they caught, where they were wrong and a human decided |
| D5 | Surprise and delight | **PARTIAL** | Have: live phone call, the -395 quarantine, the blackout their own fixture missed, the cost page. Missing: the live failure-injection demo, and the supervisor takeover is built but unverified |
| D6 | Speak to FUTURE capabilities, sell the vision not just the MVP | **PARTIAL** | Future state is in the diagram, but there is no roadmap framed in business outcomes |

---

## E. Known risks, honestly

| Risk | Detail |
|---|---|
| Supervisor takeover unverified | The browser SIP client was only just built. Two live attempts failed for different reasons, both fixed, never retested. It is a headline moment that may not work |
| Email send never completed end to end | RESOLVED 2026-09-24. PRP-2006 sent successfully. Four fixes needed: TELNYX_EMAIL_FROM unset, shared domain requires onboarding@msgtelnyx.com, sandbox only delivers to the account's verified address, and our payload used html/text instead of html_body/text_body |
| Follow-ups never exercised | Table exists, zero rows. Generate, approve, send has not been run once |
| SMS blocked | 10DLC registration not started on the funded account. Will not clear for submission; may clear before the panel |
| Some tests touch live Supabase | A run showed 8 failures then 0 with unchanged code. Flaky tests in front of a panel are a bad look |
| Conversation thread untested | Endpoint and UI both shipped, never verified together |

---

## F. What to do, in priority order

**P0 — ALL DONE 2026-09-24**
1. ~~Export the Telnyx assistant~~ `exports/telnyx-assistant.json`
2. ~~Prove a proposal email arrives~~ PRP-2006 sent; four bugs fixed on the way
3. ~~Recapture transcripts, export a voice one~~ 5 transcripts, one from a real call
4. ~~"How this was built with agents"~~ `docs/how-this-was-built.md`

Found while exporting the voice transcript, both now fixed:
- The transfer target was Enrique's own number, so Sol tried to transfer him to himself mid-call
  and the caller heard "I'm having trouble connecting you". Now points at the browser supervisor
  SIP URI, so a handoff visibly lands in the staff console.
- The transfer timeout was 5s, shorter than one ring. Now 25s.

**P1, wins the panel**
5. Verify the supervisor ladder on a real call (E, D5)
6. Live failure-injection toggle: flip the PMS off mid-demo and show honest degradation (D5)
7. A future-capabilities section framed as business outcomes, not features (D6)
8. Rehearse one live modification, end to end, and one live explanation of it (C8, D3)

**P2, only if time**
9. Follow-up generate to send, once, for real
10. SMS if 10DLC clears
11. Make the live-service tests hermetic
